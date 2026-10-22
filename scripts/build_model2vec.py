#!/usr/bin/env python3
"""Build a dataset from a Model2Vec static embedding model.

A Model2Vec model (such as Minish Lab's "potion" models) is a table of token
embeddings distilled from a sentence-embedding model. A word is tokenized and
its vector is the mean of its tokens' rows, so multi-token words still get a
meaningful vector.

The noun list is copied from an existing dataset (the GloVe one by default),
so two datasets differ only in their vectors and can be compared in the game
with ?data=<id>.

Examples:
    # A model folder with config.json, model.safetensors and tokenizer.json:
    python scripts/build_model2vec.py --model path/to/potion-base-32M \\
        --id potion-base-32m-nouns --name "potion-base-32M (Model2Vec)"

    # Or a Hugging Face model id, downloaded by model2vec:
    python scripts/build_model2vec.py --model minishlab/potion-base-32M --id potion-base-32m-nouns
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from model2vec import StaticModel

from build_vectors import ROOT, write_dataset

MINISH_ATTRIBUTION = "Model2Vec potion models by Minish Lab (MIT), github.com/MinishLab/model2vec"


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--model", required=True, help="Model2Vec model folder or Hugging Face model id")
    p.add_argument("--id", required=True, help="dataset id, also the default output folder name")
    p.add_argument("--name", help="human-readable dataset name (default: the id)")
    p.add_argument("--attribution", default=MINISH_ATTRIBUTION, help="credit line shown in the game")
    p.add_argument("--license", default="MIT", help="license of the model")
    p.add_argument(
        "--words-from",
        type=Path,
        default=ROOT / "public" / "data" / "glove-300d-nouns",
        help="dataset whose noun list (and answer/input split) to reuse",
    )
    p.add_argument("--out", type=Path, help="output directory (default: public/data/<id>)")
    args = p.parse_args()

    source = json.loads((args.words_from / "manifest.json").read_text(encoding="utf8"))
    words = (args.words_from / source["words"]).read_text(encoding="utf8").split()

    model = StaticModel.from_pretrained(args.model)
    vectors = np.asarray(model.encode(words, show_progress_bar=False), dtype=np.float32)
    empty = [w for w, v in zip(words, vectors) if not np.any(v)]
    if empty:
        raise SystemExit(f"The model has no tokens for {len(empty)} words, e.g. {empty[:10]}")

    write_dataset(
        args.out or ROOT / "public" / "data" / args.id,
        words,
        vectors,
        source["answerCount"],
        dataset_id=args.id,
        name=args.name or args.id,
        attribution=args.attribution,
        license_=args.license,
    )


if __name__ == "__main__":
    main()
