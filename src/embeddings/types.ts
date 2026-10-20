/**
 * The game only talks to word vectors through `EmbeddingProvider`, so where
 * the vectors come from (a static file, your own server, an embeddings API...)
 * can be swapped without touching game logic. Providers are created from an
 * `EmbeddingConfig` in ./index.ts.
 *
 * Methods are async so remote providers fit the same shape.
 */

export interface EmbeddingInfo {
  id: string;
  name: string;
  /** Credit line for the vector source, shown in the help dialog. */
  attribution?: string;
  dimensions: number;
}

export interface Neighbor {
  word: string;
  /** Cosine similarity to the query vector, in [-1, 1]. */
  similarity: number;
}

export interface NearestOptions {
  /** How many neighbours to return. Defaults to 1. */
  k?: number;
  /** Words that must not appear in the results. */
  exclude?: Iterable<string>;
}

export interface EmbeddingProvider {
  readonly info: EmbeddingInfo;

  /** Whether `word` (lowercase) is a noun players may type. */
  hasWord(word: string): Promise<boolean>;

  /** Unit-length vector for `word`, or null if it is not in the vocabulary. */
  getVector(word: string): Promise<Float32Array | null>;

  /**
   * The words closest to `vector` by cosine similarity, best first. Only words
   * that a step is allowed to land on (the "answer" vocabulary) are returned.
   */
  nearest(vector: Float32Array, options?: NearestOptions): Promise<Neighbor[]>;
}
