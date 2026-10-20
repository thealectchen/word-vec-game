import type { EmbeddingConfig } from './embeddings';

export const GAME_NAME = 'Vectordle';

/** Local date of daily puzzle #1. */
export const DAILY_EPOCH = '2026-10-20';

/** Static datasets live in public/data/<folder>/ (built by scripts/build_vectors.py). */
export const DEFAULT_DATASET = 'glove-300d-nouns';

/**
 * Which word vectors to use. `?data=<folder>` in the page URL loads another
 * dataset from public/data/, which is handy for comparing datasets.
 */
export function embeddingConfig(search: string = location.search): EmbeddingConfig {
  const requested = new URLSearchParams(search).get('data');
  const folder = requested && /^[a-z0-9][a-z0-9_-]*$/i.test(requested) ? requested : DEFAULT_DATASET;
  return { type: 'static', url: `${import.meta.env.BASE_URL}data/${folder}/` };
}
