import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_DATASET } from '../src/config';
import { StaticVectorProvider, type DatasetManifest } from '../src/embeddings/staticVectorProvider';
import { Engine } from '../src/game/engine';
import { WORD_POOL } from '../src/game/wordPool';

/** Checks the dataset that actually ships in public/data/. */
const dir = resolve(import.meta.dirname, '../public/data', DEFAULT_DATASET);
let provider: StaticVectorProvider;
let manifest: DatasetManifest;
let answers: Set<string>;

beforeAll(() => {
  manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8'));
  const words = readFileSync(resolve(dir, manifest.words), 'utf8').split('\n').filter(Boolean);
  const bytes = readFileSync(resolve(dir, manifest.vectors));
  provider = new StaticVectorProvider(manifest, words, new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  answers = new Set(words.slice(0, manifest.answerCount));
});

describe(`dataset ${DEFAULT_DATASET}`, () => {
  it('can land on every start/goal word', () => {
    expect(WORD_POOL.filter((w) => !answers.has(w))).toEqual([]);
  });

  it('accepts common nouns and rejects function words', async () => {
    for (const word of ['dog', 'pizza', 'smartphone', 'run', 'happiness']) expect(await provider.hasWord(word)).toBe(true);
    for (const word of ['the', 'and', 'because', 'quickly', 'paris']) expect(await provider.hasWord(word)).toBe(false);
    for (const word of ['run', 'years', 'while']) expect(answers.has(word)).toBe(false);
  });

  it('does the classic analogy', async () => {
    const engine = new Engine(provider);
    const round = await engine.play(await engine.newRound('unlimited', 'king', 'queen'), 'subtract', 'man');
    expect(round.steps[0].result).toBe('queen');
  });
});
