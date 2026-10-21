import { afterEach, describe, expect, it, vi } from 'vitest';
import { dailyPair, msUntilNextPuzzle, puzzleNumber } from '../src/game/daily';
import type { Round } from '../src/game/engine';
import { pluralCandidates, singularCandidates, wordForms } from '../src/game/inflection';
import { hashString, pickPair, seededRandom } from '../src/game/random';
import { shareText } from '../src/game/share';
import { dailyStreak, DISTRIBUTION_BUCKETS, emptyStats, recordRound } from '../src/game/stats';
import * as storage from '../src/game/storage';
import { WORD_POOL } from '../src/game/wordPool';

const cold = { score: 10, similarity: 0.1, rank: null, tier: 'cold' } as const;
const goal = { score: 100, similarity: 1, rank: null, tier: 'goal' } as const;

function round(overrides: Partial<Round> = {}): Round {
  return {
    mode: 'daily',
    puzzle: 3,
    start: 'dog',
    goal: 'castle',
    startCloseness: cold,
    steps: [
      { from: 'dog', op: 'add', operand: 'king', result: 'prince', closeness: { ...cold, tier: 'warm', rank: 400 } },
      { from: 'prince', op: 'subtract', operand: 'man', result: 'castle', closeness: goal },
    ],
    status: 'won',
    hints: 0,
    ...overrides,
  };
}

describe('word pool', () => {
  it('has 100 distinct lowercase nouns', () => {
    expect(WORD_POOL).toHaveLength(100);
    expect(new Set(WORD_POOL).size).toBe(100);
    for (const word of WORD_POOL) expect(word).toMatch(/^[a-z]+$/);
  });
});

describe('random', () => {
  it('is deterministic for a seed', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const seqA = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(seqA);
    for (const x of seqA) expect(x).toBeGreaterThanOrEqual(0);
    for (const x of seqA) expect(x).toBeLessThan(1);
    expect(hashString('a')).not.toBe(hashString('b'));
  });

  it('picks two different words', () => {
    for (let i = 0; i < 50; i++) {
      const { start, goal } = pickPair(['a', 'b', 'c']);
      expect(start).not.toBe(goal);
    }
    expect(() => pickPair(['a'])).toThrow();
  });
});

describe('daily', () => {
  it('numbers puzzles from the epoch in local time', () => {
    expect(puzzleNumber(new Date(2026, 9, 20, 0, 0, 1), '2026-10-20')).toBe(1);
    expect(puzzleNumber(new Date(2026, 9, 20, 23, 59), '2026-10-20')).toBe(1);
    expect(puzzleNumber(new Date(2026, 9, 21, 0, 0), '2026-10-20')).toBe(2);
    expect(puzzleNumber(new Date(2027, 9, 20), '2026-10-20')).toBe(366);
    expect(puzzleNumber(new Date(2026, 0, 1), '2026-10-20')).toBe(1); // before the epoch
  });

  it('gives everyone the same distinct pair for a puzzle', () => {
    expect(dailyPair(7, WORD_POOL)).toEqual(dailyPair(7, WORD_POOL));
    const pairs = new Set<string>();
    for (let n = 1; n <= 30; n++) {
      const { start, goal } = dailyPair(n, WORD_POOL);
      expect(start).not.toBe(goal);
      expect(WORD_POOL).toContain(start);
      expect(WORD_POOL).toContain(goal);
      pairs.add(`${start}>${goal}`);
    }
    expect(pairs.size).toBeGreaterThan(25);
  });

  it('counts down to local midnight', () => {
    expect(msUntilNextPuzzle(new Date(2026, 9, 20, 23, 0, 0))).toBe(60 * 60 * 1000);
  });
});

describe('singularCandidates', () => {
  it('suggests likely singular forms', () => {
    expect(singularCandidates('dogs')[0]).toBe('dog');
    expect(singularCandidates('shoes')[0]).toBe('shoe');
    expect(singularCandidates('berries')).toContain('berry');
    expect(singularCandidates('wolves')).toContain('wolf');
    expect(singularCandidates('knives')).toContain('knife');
    expect(singularCandidates('boxes')).toContain('box');
    expect(singularCandidates('churches')).toContain('church');
    expect(singularCandidates('women')[0]).toBe('woman');
    expect(singularCandidates('mice')).toEqual(['mouse']);
    expect(singularCandidates('glass')).toEqual([]);
  });

  it('suggests likely plural forms', () => {
    expect(pluralCandidates('hand')).toContain('hands');
    expect(pluralCandidates('box')).toContain('boxes');
    expect(pluralCandidates('berry')).toContain('berries');
    expect(pluralCandidates('day')).not.toContain('daies');
    expect(pluralCandidates('knife')).toContain('knives');
    expect(pluralCandidates('woman')).toContain('women');
    expect(pluralCandidates('child')).toContain('children');
  });

  it('groups a word with its other forms', () => {
    expect(wordForms('hands')).toEqual(expect.arrayContaining(['hands', 'hand']));
    expect(wordForms('hand')).toEqual(expect.arrayContaining(['hand', 'hands']));
    expect(wordForms('children')).toContain('child');
  });
});

describe('stats', () => {
  it('records wins, losses and the step distribution', () => {
    let stats = recordRound(emptyStats(), round({ mode: 'unlimited', puzzle: null }));
    stats = recordRound(stats, round({ mode: 'unlimited', puzzle: null, status: 'gave-up' }));
    expect(stats.unlimited).toMatchObject({ played: 2, won: 1, currentStreak: 0, maxStreak: 1 });
    expect(stats.unlimited.distribution[1]).toBe(1);
    expect(stats.daily.played).toBe(0);
  });

  it('puts long solves in the last bucket', () => {
    const steps = Array.from({ length: 12 }, () => round().steps[0]);
    const stats = recordRound(emptyStats(), round({ mode: 'unlimited', puzzle: null, steps }));
    expect(stats.unlimited.distribution[DISTRIBUTION_BUCKETS - 1]).toBe(1);
  });

  it('ignores unfinished rounds and repeated daily puzzles', () => {
    expect(recordRound(emptyStats(), round({ status: 'playing' }))).toEqual(emptyStats());
    const once = recordRound(emptyStats(), round({ puzzle: 3 }));
    expect(recordRound(once, round({ puzzle: 3 }))).toBe(once);
    expect(once.daily).toMatchObject({ played: 1, won: 1, lastPuzzle: 3, lastWonPuzzle: 3 });
  });

  it('tracks daily streaks across consecutive puzzles', () => {
    let stats = emptyStats();
    for (const puzzle of [1, 2, 3]) stats = recordRound(stats, round({ puzzle }));
    expect(stats.daily).toMatchObject({ currentStreak: 3, maxStreak: 3 });
    expect(dailyStreak(stats, 3)).toBe(3);
    expect(dailyStreak(stats, 4)).toBe(3); // today not played yet
    expect(dailyStreak(stats, 5)).toBe(0); // missed a day

    stats = recordRound(stats, round({ puzzle: 5 }));
    expect(stats.daily).toMatchObject({ currentStreak: 1, maxStreak: 3 });
    stats = recordRound(stats, round({ puzzle: 6, status: 'gave-up' }));
    expect(stats.daily.currentStreak).toBe(0);
  });
});

describe('shareText', () => {
  it('summarises a daily win without spoiling the moves', () => {
    const text = shareText(round(), 'Vectordle', 'https://example.com/');
    expect(text).toBe('Vectordle #3 · 2 steps\nDOG → CASTLE\n🟨🟩\nhttps://example.com/');
    expect(text).not.toContain('king');
  });

  it('mentions hints', () => {
    expect(shareText(round({ hints: 1 }), 'V').split('\n')[0]).toBe('V #3 · 2 steps · 1 hint');
    expect(shareText(round({ hints: 3 }), 'V').split('\n')[0]).toBe('V #3 · 2 steps · 3 hints');
  });

  it('marks unlimited rounds and give-ups', () => {
    const text = shareText(round({ mode: 'unlimited', puzzle: null, status: 'gave-up', steps: [round().steps[0]] }), 'V');
    expect(text).toBe('V (unlimited) · gave up after 1 step\nDOG → CASTLE\n🟨❌');
  });
});

describe('storage', () => {
  afterEach(() => vi.unstubAllGlobals());

  function memoryStorage() {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  }

  it('round-trips rounds, stats and preferences', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    expect(storage.loadRound('daily')).toBeNull();
    storage.saveRound(round());
    expect(storage.loadRound('daily')).toEqual(round());
    expect(storage.loadRound('unlimited')).toBeNull();

    const stats = recordRound(emptyStats(), round());
    storage.saveStats(stats);
    expect(storage.loadStats()).toEqual(stats);

    expect(storage.loadMode()).toBe('daily');
    storage.saveMode('unlimited');
    expect(storage.loadMode()).toBe('unlimited');

    expect(storage.hasSeenHelp()).toBe(false);
    storage.markHelpSeen();
    expect(storage.hasSeenHelp()).toBe(true);
  });

  it('gives rounds saved before hints existed a hint count of 0', () => {
    const mem = memoryStorage();
    const { hints: _, ...old } = round();
    mem.setItem('vectordle:v1:round:daily', JSON.stringify(old));
    vi.stubGlobal('localStorage', mem);
    expect(storage.loadRound('daily')).toEqual(round());
  });

  it('survives corrupt data and missing storage', () => {
    const mem = memoryStorage();
    mem.setItem('vectordle:v1:round:daily', '{not json');
    mem.setItem('vectordle:v1:stats', JSON.stringify({ daily: { played: 2 } }));
    vi.stubGlobal('localStorage', mem);
    expect(storage.loadRound('daily')).toBeNull();
    expect(storage.loadStats()).toEqual(emptyStats());

    vi.stubGlobal('localStorage', undefined);
    expect(storage.loadStats()).toEqual(emptyStats());
    expect(() => storage.saveRound(round())).not.toThrow();
  });
});
