import { afterEach, describe, expect, it, vi } from 'vitest';
import { DATASET_FORMAT, StaticVectorProvider } from '../src/embeddings/staticVectorProvider';
import { combine, cosine, norm } from '../src/embeddings/vectorMath';
import { makeProvider, toyProvider } from './helpers';

describe('vectorMath', () => {
  it('combines, normalises and compares vectors', () => {
    expect(Array.from(combine([1, 2], [3, 4], 1))).toEqual([4, 6]);
    expect(Array.from(combine([1, 2], [3, 4], -1))).toEqual([-2, -2]);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([2, 0], [5, 0])).toBeCloseTo(1);
    expect(cosine([0, 0], [1, 0])).toBe(0);
    expect(() => combine([1], [1, 2], 1)).toThrow();
  });
});

describe('StaticVectorProvider', () => {
  it('knows answer and input-only words', async () => {
    const p = toyProvider();
    expect(await p.hasWord('king')).toBe(true);
    expect(await p.hasWord('wolves')).toBe(true);
    expect(await p.hasWord('unicorn')).toBe(false);
  });

  it('returns unit-length vectors', async () => {
    const v = await toyProvider().getVector('fish');
    expect(v).not.toBeNull();
    expect(norm(v!)).toBeCloseTo(1, 5);
    expect(await toyProvider().getVector('nope')).toBeNull();
  });

  it('finds nearest answer words best-first, honouring exclusions', async () => {
    const p = toyProvider();
    const king = (await p.getVector('king'))!;
    const results = await p.nearest(king, { k: 3 });
    expect(results.map((r) => r.word)).toEqual(['king', 'prince', 'crown']);
    expect(results[0].similarity).toBeCloseTo(1, 2);
    expect(results[0].similarity).toBeGreaterThanOrEqual(results[1].similarity);

    const excluded = await p.nearest(king, { k: 2, exclude: ['king', 'prince'] });
    expect(excluded.map((r) => r.word)).toEqual(['crown', 'man']);
  });

  it('never lands on input-only words', async () => {
    const p = toyProvider();
    const wolves = (await p.getVector('wolves'))!;
    const [best] = await p.nearest(wolves);
    expect(best.word).toBe('dog');
  });

  it('rejects inconsistent datasets', () => {
    const manifest = {
      format: DATASET_FORMAT,
      id: 'bad',
      name: 'bad',
      dimensions: 2,
      wordCount: 2,
      answerCount: 2,
      words: 'w',
      vectors: 'v',
    };
    expect(() => new StaticVectorProvider(manifest, ['a'], new Int8Array(4))).toThrow(/inconsistent/);
    expect(() => new StaticVectorProvider({ ...manifest, format: 'other' }, ['a', 'b'], new Int8Array(4))).toThrow(
      /format/,
    );
  });

  describe('load', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('fetches manifest, words and vectors relative to the base URL', async () => {
      const files: Record<string, BodyInit> = {
        'data/x/manifest.json': JSON.stringify({
          format: DATASET_FORMAT,
          id: 'x',
          name: 'X',
          dimensions: 2,
          wordCount: 3,
          answerCount: 2,
          words: 'words.txt',
          vectors: 'vectors.bin',
        }),
        'data/x/words.txt': 'north\neast\nsouth\n',
        'data/x/vectors.bin': new Int8Array([0, 127, 127, 0, 0, -127]),
      };
      const fetchMock = vi.fn(async (url: string) =>
        url in files ? new Response(files[url]) : new Response('missing', { status: 404 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const progress: number[] = [];
      const p = await StaticVectorProvider.load('data/x', (loaded) => progress.push(loaded));
      expect(p.info).toMatchObject({ id: 'x', name: 'X', dimensions: 2 });
      expect(await p.hasWord('south')).toBe(true);
      // "south" is input-only, so the nearest answer to it is not "south".
      const [best] = await p.nearest((await p.getVector('south'))!, { k: 1 });
      expect(best.word).not.toBe('south');
      expect(progress.at(-1)).toBe(6);
    });

    it('reports HTTP errors', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
      await expect(StaticVectorProvider.load('data/missing/')).rejects.toThrow(/HTTP 404/);
    });
  });

  it('handles all-zero vectors without NaNs', async () => {
    const p = makeProvider({ a: [0, 0], b: [1, 0] });
    const [best] = await p.nearest(new Float32Array([1, 0]), { k: 2 });
    expect(best.word).toBe('b');
    expect(Number.isNaN(best.similarity)).toBe(false);
  });
});
