import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DATASET } from '../src/config';
import { StaticVectorProvider, type DatasetManifest } from '../src/embeddings/staticVectorProvider';
import { Engine } from '../src/game/engine';
import { WORD_POOL } from '../src/game/wordPool';

/** Checks the datasets that actually ship in public/data/. */
const DATA_DIR = resolve(import.meta.dirname, '../public/data');
const DATASETS = readdirSync(DATA_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

function loadDataset(name: string) {
  const dir = resolve(DATA_DIR, name);
  const manifest: DatasetManifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8'));
  const words = readFileSync(resolve(dir, manifest.words), 'utf8').split('\n').filter(Boolean);
  const bytes = readFileSync(resolve(dir, manifest.vectors));
  const provider = new StaticVectorProvider(manifest, words, new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return { manifest, provider, answers: new Set(words.slice(0, manifest.answerCount)) };
}

it('ships the default dataset', () => {
  expect(DATASETS).toContain(DEFAULT_DATASET);
});

describe.each(DATASETS)('dataset %s', (name) => {
  const { manifest, provider, answers } = loadDataset(name);

  it('has a manifest whose id matches its folder', () => {
    expect(manifest.id).toBe(name);
  });

  it('can land on every start/goal word', () => {
    expect(WORD_POOL.filter((w) => !answers.has(w))).toEqual([]);
  });

  it('accepts common nouns and rejects function words', async () => {
    for (const word of ['dog', 'pizza', 'smartphone', 'run', 'happiness']) expect(await provider.hasWord(word)).toBe(true);
    for (const word of ['the', 'and', 'because', 'quickly', 'paris']) expect(await provider.hasWord(word)).toBe(false);
    for (const word of ['run', 'years', 'while']) expect(answers.has(word)).toBe(false);
  });

  it('closes the plural loophole: typing "hands" never lands on "hand"', async () => {
    const engine = new Engine(provider);
    for (const start of ['animal', 'horse', 'computer']) {
      const round = await engine.play(await engine.newRound('unlimited', start, 'hand'), 'add', 'hands');
      expect(round.steps[0].result).not.toBe('hand');
    }
  });
});

describe(`default dataset ${DEFAULT_DATASET}`, () => {
  const { provider } = loadDataset(DEFAULT_DATASET);

  it('finds hints quickly, and they land where they say', async () => {
    const engine = new Engine(provider);
    for (const [start, goal] of [['horse', 'computer'], ['egg', 'cow'], ['fire', 'milk']]) {
      const round = await engine.newRound('unlimited', start, goal);
      const t0 = performance.now();
      const hint = (await engine.hint(round))!;
      const ms = performance.now() - t0;
      const played = await engine.play(round, hint.op, hint.word);
      console.log(`hint ${start} -> ${goal}: ${hint.op} ${hint.word} -> ${hint.result} (${hint.closeness.tier}) in ${ms.toFixed(0)} ms`);
      expect(played.steps[0].result).toBe(hint.result);
      expect(ms).toBeLessThan(5000);
    }
  });

  it('does the classic analogy', async () => {
    const engine = new Engine(provider);
    const round = await engine.play(await engine.newRound('unlimited', 'king', 'queen'), 'subtract', 'man');
    expect(round.steps[0].result).toBe('queen');
  });
});
