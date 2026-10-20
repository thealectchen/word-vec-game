# Vectordle

A daily word puzzle built on word vectors. You start at one noun and need to reach a goal noun. Each step, type any noun and **add** or **subtract** it. The game does the vector arithmetic and lands you on the nearest noun. Reach the goal in as few steps as possible.

```
KING − man → QUEEN
```

- **Daily** mode: the same start/goal pair for everyone each day, with streaks and a spoiler-free share card.
- **Unlimited** mode: random pairs, as many rounds as you like.
- **Closeness meter**: after every step you see how near you are to the goal. Cold means outside the goal's 1,000 nearest words, warm means inside them, hot means inside its 100 nearest.
- Works on phones and desktops, follows the system light/dark theme, and saves progress in the browser.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests + checks on the shipped dataset
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ locally
```

The game is a static site with no server and no API keys. Everything, including the nearest-neighbour search, runs in the browser.

### Deploying (GitHub Pages)

`.github/workflows/deploy.yml` builds and publishes the site whenever `main` changes. To enable it once, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. The game will be served at `https://<user>.github.io/word-vec-game/`. The build uses relative paths, so any static host works too: upload `dist/`.

## How it works

1. **Vectors.** Pretrained [GloVe](https://nlp.stanford.edu/projects/glove/) 300-dimensional vectors (Wikipedia + Gigaword).
2. **Nouns only.** `scripts/build_vectors.py` keeps words that [WordNet](https://wordnet.princeton.edu/) lists as nouns. Of those, words that the tagged Brown corpus shows are *usually* nouns can also be landed on. So `run` can be typed, but a step never lands on it. Plurals, proper nouns, function words and a profanity blocklist are excluded.
3. **Vocabulary.** The dataset ships ~18.9k nouns players can type. ~10.1k of them (the most frequent, plus every start/goal word) are possible step results.
4. **A step.** `result = nearest(current ± operand)` by cosine similarity, excluding the current word and the operand. This is the standard rule for word-vector analogies. It also means adding the goal word itself never wins, though a synonym of the goal might.
5. **Size.** Vectors are unit-normalised and stored as int8 (5.7 MB). Results match full precision in over 99% of steps.

## Project layout

```
src/
  config.ts                     game name, daily epoch, which dataset to load
  data/word-pool.json           the 100 start/goal nouns
  embeddings/
    types.ts                    EmbeddingProvider interface (the swap point)
    staticVectorProvider.ts     loads public/data/<dataset>/ and searches in-browser
    index.ts                    createProvider(config) factory
    vectorMath.ts
  game/
    engine.ts                   rounds, steps, input parsing, closeness scoring
    daily.ts, random.ts         daily puzzle numbering and seeded pair selection
    stats.ts, storage.ts        stats/streaks and localStorage persistence
    share.ts, inflection.ts     share text, plural -> singular fallback
  ui/                           DOM rendering (no framework)
public/data/glove-300d-nouns/   the shipped dataset (generated)
scripts/build_vectors.py        builds a dataset from any word2vec/GloVe text file
scripts/data/                   stopwords, blocklist, extra modern nouns
tests/                          Vitest tests
```

## Swapping the word vectors

The game only touches vectors through the `EmbeddingProvider` interface in `src/embeddings/types.ts`:

```ts
interface EmbeddingProvider {
  hasWord(word: string): Promise<boolean>;
  getVector(word: string): Promise<Float32Array | null>;
  nearest(vector: Float32Array, options?: { k?: number; exclude?: Iterable<string> }): Promise<Neighbor[]>;
}
```

### Option 1: a different set of static vectors (no code changes)

The build script accepts any word2vec/GloVe **text** file (`.txt`, `.vec`, optionally `.gz`) whose words are sorted from most to least frequent:

```bash
python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt

# A known source, downloaded automatically (GloVe 50/100/200/300d):
.venv/bin/python scripts/build_vectors.py --source glove-wiki-gigaword-100

# Or your own file, e.g. fastText:
.venv/bin/python scripts/build_vectors.py --vectors wiki-news-300d-1M.vec.gz \
  --id fasttext-nouns --name "fastText wiki-news 300d" --attribution "fastText (Facebook AI)"
```

This writes `public/data/<id>/`. Try it with `?data=<id>` in the URL, e.g. `http://localhost:5173/?data=fasttext-nouns`. To make it the default, set `DEFAULT_DATASET` in `src/config.ts`.

Useful flags:

- `--answers N`: how many frequent nouns a step can land on (default 10,000). Larger means more precise but more obscure results.
- `--max-rank N`: how many of the source's most frequent words to consider (default 100,000). Larger means more typeable words and a bigger file.

Downloads are cached in `scripts/.cache/`.

### Option 2: a different kind of source (server, embeddings API, ...)

Write a class that implements `EmbeddingProvider`, add a variant to `EmbeddingConfig` in `src/embeddings/index.ts`, and handle it in `createProvider()`. The interface is async, so a provider can fetch vectors or run `nearest()` on a server. Nothing in `src/game/` or `src/ui/` needs to change.

## Tuning

- **Start/goal words**: edit `src/data/word-pool.json`, then rerun the build script. Pool words are always added to the possible results, so every goal can be reached. Changing the pool or its order changes the daily puzzles.
- **Closeness tiers**: pass `rankDepth`, `hotRank` and `warmRank` to `new Engine(provider, {...})` in `src/main.ts`.
- **Blocked or extra words**: `scripts/data/blocklist.txt` and `scripts/data/extra_nouns.txt`. Extra nouns are only added if the vector source contains them. The 2014 GloVe vocabulary has `smartphone` but not `selfie`, for example.
- **Name / daily start date**: `GAME_NAME` and `DAILY_EPOCH` in `src/config.ts`.

## Credits

- Word vectors: GloVe, Jeffrey Pennington, Richard Socher and Christopher D. Manning (2014), Public Domain Dedication and License (PDDL).
- Noun filtering at build time: WordNet 3.0 (Princeton University) and the Brown corpus, via NLTK. Neither is shipped with the game.
