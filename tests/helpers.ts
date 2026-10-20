import { StaticVectorProvider, DATASET_FORMAT } from '../src/embeddings/staticVectorProvider';

/**
 * Build an in-memory dataset from plain vectors. `answers` words come first
 * (a step can land on them); `inputs` are accepted as input only.
 */
export function makeProvider(answers: Record<string, number[]>, inputs: Record<string, number[]> = {}) {
  const entries = [...Object.entries(answers), ...Object.entries(inputs)];
  const dims = entries[0][1].length;
  const rows = new Int8Array(entries.length * dims);
  entries.forEach(([, vec], i) => {
    const max = Math.max(...vec.map(Math.abs)) || 1;
    vec.forEach((v, j) => (rows[i * dims + j] = Math.round((v / max) * 127)));
  });
  return new StaticVectorProvider(
    {
      format: DATASET_FORMAT,
      id: 'test',
      name: 'Test vectors',
      dimensions: dims,
      wordCount: entries.length,
      answerCount: Object.keys(answers).length,
      words: 'words.txt',
      vectors: 'vectors.bin',
    },
    entries.map(([w]) => w),
    rows,
  );
}

/**
 * A toy space with axes (royalty, gender, animal, water) where
 * king - man lands on crown, and crown + woman lands on queen.
 */
export function toyProvider() {
  return makeProvider(
    {
      king: [1, 1, 0, 0],
      queen: [1, -2, 0, 0],
      man: [0, 1, 0, 0.2],
      woman: [0, -1, 0, 0.05],
      prince: [0.9, 1, 0, 0.1],
      dog: [0, 0, 1, 0],
      cat: [0, 0.1, 1, 0.1],
      fish: [0, 0, 1, 1],
      sea: [-0.2, 0, 0.1, 1],
      crown: [1, 0, 0, 0],
    },
    { wolves: [0, 0, 1, -0.2], run: [0.1, 0.1, 0.1, 0.1] },
  );
}
