#!/usr/bin/env python3
"""Build a noun-only word-vector dataset for the game.

Reads word vectors in word2vec/GloVe *text* format (optionally gzipped, with or
without the "<count> <dims>" header line), keeps English nouns, and writes a
dataset the browser can load:

    <out>/manifest.json   metadata (dimensions, counts, attribution, ...)
    <out>/words.txt       one word per line. The first `answerCount` lines are
                          the words a step can land on (most frequent first);
                          the remaining lines are accepted as player input only.
    <out>/vectors.bin     int8 matrix, row i is the vector for line i of
                          words.txt. Each row is unit-normalised and then scaled
                          so its largest component is +-127.

Noun detection uses WordNet (is there a noun sense?) and the POS-tagged Brown
corpus (is the word usually used as a noun?). Inputs only need a noun sense;
answers must mostly be used as nouns, so "run" can be typed but a step never
lands on it.

The source file must list words from most to least frequent (GloVe, word2vec
and fastText releases all do).

Examples:
    python scripts/build_vectors.py --source glove-wiki-gigaword-300
    python scripts/build_vectors.py --vectors my-vectors.txt.gz \\
        --id my-vectors --name "My vectors" --out public/data/my-vectors
"""

from __future__ import annotations

import argparse
import collections
import gzip
import json
import re
import sys
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(__file__).resolve().parent / "data"
DEFAULT_CACHE = Path(__file__).resolve().parent / ".cache"
WORD_POOL = ROOT / "src" / "data" / "word-pool.json"

GENSIM_DATA = "https://github.com/RaRe-Technologies/gensim-data/releases/download"
NLTK_DATA = "https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/corpora"

# Pretrained vectors that can be fetched by name with --source.
SOURCES = {
    f"glove-wiki-gigaword-{d}": {
        "url": f"{GENSIM_DATA}/glove-wiki-gigaword-{d}/glove-wiki-gigaword-{d}.gz",
        "name": f"GloVe {d}d (Wikipedia + Gigaword)",
        "attribution": "GloVe by Pennington, Socher & Manning (2014), nlp.stanford.edu/projects/glove",
        "license": "PDDL-1.0",
    }
    for d in (50, 100, 200, 300)
}

WORD_RE = re.compile(r"[a-z]+")


def read_word_list(path: Path) -> set[str]:
    words = set()
    for line in path.read_text(encoding="utf8").splitlines():
        line = line.split("#", 1)[0]
        words.update(w.lower() for w in line.split())
    return words


def download(url: str, dest: Path) -> Path:
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {url}\n         -> {dest}", file=sys.stderr)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url) as resp, open(tmp, "wb") as out:
        while chunk := resp.read(1 << 20):
            out.write(chunk)
    tmp.rename(dest)
    return dest


def load_nltk(cache: Path):
    """Return (wordnet, brown) corpus readers, fetching the zips if needed.

    The zips are downloaded directly rather than with nltk.download(), which
    refuses to work behind some HTTPS proxies.
    """
    import nltk

    nltk_dir = cache / "nltk_data"
    nltk.data.path.insert(0, str(nltk_dir))
    for corpus in ("wordnet", "brown"):
        try:
            nltk.data.find(f"corpora/{corpus}.zip")
        except LookupError:
            download(f"{NLTK_DATA}/{corpus}.zip", nltk_dir / "corpora" / f"{corpus}.zip")
    from nltk.corpus import brown, wordnet

    return wordnet, brown


class NounFilter:
    def __init__(self, wordnet, brown, stopwords: set[str], blocklist: set[str], extra: set[str]):
        self.wn = wordnet
        self.excluded = stopwords | blocklist
        self.extra = extra
        self.tags: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
        for word, tag in brown.tagged_words():
            # "NN-TL" -> "NN", "NNS$" -> "NNS"
            self.tags[word.lower()][tag.split("-")[0].rstrip("$*")] += 1

    def _noun_synsets(self, word: str):
        # Only senses where the word itself is a lowercase lemma: excludes
        # proper nouns ("Paris") and inflected lookups ("dogs" -> dog).
        return [s for s in self.wn.synsets(word, pos="n") if any(l.name() == word for l in s.lemmas())]

    def is_input(self, word: str) -> bool:
        """Accept as player input: any word with a noun sense."""
        if not WORD_RE.fullmatch(word) or word in self.excluded or len(word) < 2:
            return False
        return word in self.extra or bool(self._noun_synsets(word))

    def is_answer(self, word: str) -> bool:
        """Allow as a step result: a singular word that is mostly used as a noun."""
        if not self.is_input(word) or len(word) < 3:
            return False
        if word in self.extra:
            return True
        if any(base != word for base in self.wn._morphy(word, "n")):
            return False  # plural or other inflected form ("years", "men")

        tags = self.tags.get(word)
        total = sum(tags.values()) if tags else 0
        if total >= 5:
            # NN* = common noun, NR = adverbial noun ("home", "today")
            noun = sum(n for t, n in tags.items() if t.startswith("NN") or t == "NR")
            return noun >= 0.5 * total

        # Too rare for Brown: fall back to WordNet sense-tagged counts.
        counts: collections.Counter = collections.Counter()
        for synset in self.wn.synsets(word):
            pos = "a" if synset.pos() == "s" else synset.pos()
            for lemma in synset.lemmas():
                if lemma.name().lower() == word:
                    counts[(pos, lemma.name() == word)] += lemma.count()
        noun = counts[("n", True)]
        proper = counts[("n", False)]
        other = max([n for (pos, _), n in counts.items() if pos != "n"], default=0)
        if noun or proper or other:
            return noun >= proper and noun >= other
        n_noun = len(self._noun_synsets(word))
        return n_noun >= max(len(self.wn.synsets(word, pos=p)) for p in "var")


def read_vectors(path: Path, max_rank: int, also_keep: set[str]):
    """Yield (rank, word, vector) for the first `max_rank` lowercase-alphabetic
    words, plus any word in `also_keep` wherever it appears."""
    opener = gzip.open if path.suffix == ".gz" else open
    dims = None
    with opener(path, "rt", encoding="utf8", errors="replace") as f:
        for rank, line in enumerate(f):
            parts = line.rstrip().split(" ")
            if rank == 0 and len(parts) == 2 and all(p.isdigit() for p in parts):
                continue  # word2vec header
            word = parts[0]
            if rank > max_rank and word not in also_keep:
                continue
            if not WORD_RE.fullmatch(word):
                continue
            vec = np.asarray(parts[1:], dtype=np.float32)
            if dims is None:
                dims = len(vec)
            if len(vec) != dims:
                continue
            yield rank, word, vec


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--source", choices=sorted(SOURCES), help="download a known pretrained source")
    src.add_argument("--vectors", type=Path, help="path to a word2vec/GloVe text file (.txt, .vec or .gz)")
    p.add_argument("--id", help="dataset id (default: <source>-nouns)")
    p.add_argument("--name", help="human-readable dataset name")
    p.add_argument("--attribution", default="", help="credit line shown in the game")
    p.add_argument("--license", default="", help="license of the source vectors")
    p.add_argument("--out", type=Path, help="output directory (default: public/data/<id>)")
    p.add_argument("--max-rank", type=int, default=100_000, help="only consider the N most frequent source words")
    p.add_argument("--answers", type=int, default=10_000, help="how many of the most frequent nouns a step can land on")
    p.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE, help="where downloads are kept")
    args = p.parse_args()

    if args.source:
        meta = SOURCES[args.source]
        vectors_path = download(meta["url"], args.cache_dir / f"{args.source}.gz")
        dataset_id = args.id or f"{args.source}-nouns"
        name = args.name or meta["name"]
        attribution = args.attribution or meta["attribution"]
        license_ = args.license or meta["license"]
    else:
        vectors_path = args.vectors
        dataset_id = args.id or f"{vectors_path.name.split('.')[0]}-nouns"
        name = args.name or dataset_id
        attribution, license_ = args.attribution, args.license
    out_dir = args.out or ROOT / "public" / "data" / dataset_id

    wordnet, brown = load_nltk(args.cache_dir)
    pool = [w.lower() for w in json.loads(WORD_POOL.read_text(encoding="utf8"))["words"]]
    extra = read_word_list(DATA_DIR / "extra_nouns.txt")
    blocklist = read_word_list(DATA_DIR / "blocklist.txt")
    nouns = NounFilter(wordnet, brown, read_word_list(DATA_DIR / "stopwords.txt"), blocklist, extra)

    answers: list[tuple[str, np.ndarray]] = []
    inputs_only: list[tuple[str, np.ndarray]] = []
    pool_vectors: dict[str, np.ndarray] = {}
    seen: set[str] = set()
    for rank, word, vec in read_vectors(vectors_path, args.max_rank, extra | set(pool)):
        if word in seen:
            continue
        seen.add(word)
        if word in pool and word not in blocklist:
            pool_vectors[word] = vec
            continue
        if len(answers) < args.answers and nouns.is_answer(word):
            answers.append((word, vec))
        elif nouns.is_input(word):
            inputs_only.append((word, vec))

    missing = [w for w in pool if w not in pool_vectors]
    if missing:
        print(f"WARNING: start/goal words missing from the source vectors: {missing}", file=sys.stderr)
    # Pool words are always answers, so every start/goal word can be reached.
    answers.extend((w, pool_vectors[w]) for w in pool if w in pool_vectors)

    rows = answers + inputs_only
    words = [w for w, _ in rows]
    matrix = np.stack([v for _, v in rows]).astype(np.float32)
    matrix /= np.linalg.norm(matrix, axis=1, keepdims=True)
    quantized = np.round(matrix / np.abs(matrix).max(axis=1, keepdims=True) * 127).astype(np.int8)

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "words.txt").write_text("\n".join(words) + "\n", encoding="utf8")
    (out_dir / "vectors.bin").write_bytes(quantized.tobytes())
    manifest = {
        "format": "word-vectors/int8-v1",
        "id": dataset_id,
        "name": name,
        "attribution": attribution,
        "license": license_,
        "dimensions": int(matrix.shape[1]),
        "wordCount": len(words),
        "answerCount": len(answers),
        "words": "words.txt",
        "vectors": "vectors.bin",
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
    size_mb = (out_dir / "vectors.bin").stat().st_size / 1e6
    print(
        f"Wrote {out_dir}: {len(words)} words ({len(answers)} answers), "
        f"{matrix.shape[1]} dims, vectors.bin {size_mb:.1f} MB",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
