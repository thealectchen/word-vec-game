import type { EmbeddingInfo, EmbeddingProvider, NearestOptions, Neighbor } from './types';

/**
 * Loads a dataset produced by scripts/build_vectors.py and does
 * nearest-neighbour search in the browser by brute force (about 10k answer
 * words x 300 dims, a few milliseconds per query).
 */

export const DATASET_FORMAT = 'word-vectors/int8-v1';

export interface DatasetManifest {
  format: string;
  id: string;
  name: string;
  attribution?: string;
  license?: string;
  dimensions: number;
  wordCount: number;
  /** The first `answerCount` words are the ones a step can land on. */
  answerCount: number;
  /** File names, relative to the manifest. */
  words: string;
  vectors: string;
}

export type ProgressCallback = (loadedBytes: number, totalBytes: number) => void;

export class StaticVectorProvider implements EmbeddingProvider {
  readonly info: EmbeddingInfo;
  private readonly dims: number;
  private readonly answerCount: number;
  private readonly index = new Map<string, number>();
  /** 1 / length of each int8 row, so dot products can be done on raw rows. */
  private readonly invNorms: Float32Array;

  constructor(
    manifest: DatasetManifest,
    private readonly words: readonly string[],
    private readonly rows: Int8Array,
  ) {
    if (manifest.format !== DATASET_FORMAT) {
      throw new Error(`Unsupported dataset format "${manifest.format}" (expected "${DATASET_FORMAT}")`);
    }
    this.dims = manifest.dimensions;
    if (words.length !== manifest.wordCount || rows.length !== manifest.wordCount * this.dims) {
      throw new Error(
        `Dataset "${manifest.id}" is inconsistent: ${words.length} words and ${rows.length} vector values ` +
          `for ${manifest.wordCount} words x ${this.dims} dims`,
      );
    }
    this.answerCount = Math.min(manifest.answerCount, words.length);
    this.info = {
      id: manifest.id,
      name: manifest.name,
      attribution: manifest.attribution,
      dimensions: this.dims,
    };

    words.forEach((word, i) => {
      if (!this.index.has(word)) this.index.set(word, i);
    });
    this.invNorms = new Float32Array(words.length);
    for (let i = 0; i < words.length; i++) {
      let sum = 0;
      for (let j = i * this.dims, end = j + this.dims; j < end; j++) sum += rows[j] * rows[j];
      this.invNorms[i] = sum > 0 ? 1 / Math.sqrt(sum) : 0;
    }
  }

  /** Fetch a dataset from `baseUrl` (the folder containing manifest.json). */
  static async load(baseUrl: string, onProgress?: ProgressCallback): Promise<StaticVectorProvider> {
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const manifest = (await (await fetchOk(`${base}manifest.json`)).json()) as DatasetManifest;
    const expectedBytes = manifest.wordCount * manifest.dimensions;
    const [wordsText, vectorBytes] = await Promise.all([
      fetchOk(`${base}${manifest.words}`).then((r) => r.text()),
      fetchBytes(`${base}${manifest.vectors}`, expectedBytes, onProgress),
    ]);
    const words = wordsText.split('\n').filter((w) => w.length > 0);
    const rows = new Int8Array(vectorBytes.buffer, vectorBytes.byteOffset, vectorBytes.byteLength);
    return new StaticVectorProvider(manifest, words, rows);
  }

  async hasWord(word: string): Promise<boolean> {
    return this.index.has(word);
  }

  async getVector(word: string): Promise<Float32Array | null> {
    const i = this.index.get(word);
    if (i === undefined) return null;
    const out = new Float32Array(this.dims);
    const scale = this.invNorms[i];
    const offset = i * this.dims;
    for (let j = 0; j < this.dims; j++) out[j] = this.rows[offset + j] * scale;
    return out;
  }

  async nearest(vector: Float32Array, options: NearestOptions = {}): Promise<Neighbor[]> {
    const k = Math.max(1, options.k ?? 1);
    const exclude = new Set(options.exclude ?? []);
    let queryNorm = 0;
    for (let j = 0; j < vector.length; j++) queryNorm += vector[j] * vector[j];
    queryNorm = Math.sqrt(queryNorm) || 1;

    // Top-k kept sorted best-first; new entries are insertion-sorted in.
    const topScores: number[] = [];
    const topIndices: number[] = [];
    const { rows, dims } = this;
    const count = options.among === 'all' ? this.words.length : this.answerCount;
    for (let i = 0; i < count; i++) {
      const offset = i * dims;
      let sum = 0;
      for (let j = 0; j < dims; j++) sum += rows[offset + j] * vector[j];
      const score = (sum * this.invNorms[i]) / queryNorm;
      if (topScores.length === k && score <= topScores[k - 1]) continue;
      if (exclude.has(this.words[i])) continue;
      let pos = topScores.length;
      while (pos > 0 && topScores[pos - 1] < score) pos--;
      topScores.splice(pos, 0, score);
      topIndices.splice(pos, 0, i);
      if (topScores.length > k) {
        topScores.pop();
        topIndices.pop();
      }
    }
    return topIndices.map((i, n) => ({ word: this.words[i], similarity: topScores[n] }));
  }
}

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
  return response;
}

/** Fetch a binary file, reporting progress as it streams in. */
async function fetchBytes(url: string, expectedBytes: number, onProgress?: ProgressCallback): Promise<Uint8Array> {
  const response = await fetchOk(url);
  if (!response.body || !onProgress) return new Uint8Array(await response.arrayBuffer());

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  onProgress(0, expectedBytes);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(Math.min(loaded, expectedBytes), expectedBytes);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
