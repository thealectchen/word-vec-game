import { describe, expect, it } from 'vitest';
import { currentCloseness, currentWord, Engine, MoveError } from '../src/game/engine';
import { cosine } from '../src/embeddings/vectorMath';
import { toyProvider } from './helpers';

const engine = () => new Engine(toyProvider(), { rankDepth: 5, hotRank: 2, warmRank: 5 });

describe('Engine.parseMove', () => {
  it('accepts known nouns, case-insensitively', async () => {
    expect(await engine().parseMove('  King ')).toEqual({ ok: true, word: 'king', op: null, corrected: false });
  });

  it('reads a leading + or - as the operation', async () => {
    expect(await engine().parseMove('-man')).toMatchObject({ ok: true, word: 'man', op: 'subtract' });
    expect(await engine().parseMove('− man')).toMatchObject({ ok: true, word: 'man', op: 'subtract' });
    expect(await engine().parseMove('+woman')).toMatchObject({ ok: true, word: 'woman', op: 'add' });
  });

  it('maps unknown plurals to known singulars', async () => {
    expect(await engine().parseMove('kings')).toEqual({ ok: true, word: 'king', op: null, corrected: true });
    // A plural that is itself in the vocabulary is kept as typed.
    expect(await engine().parseMove('wolves')).toMatchObject({ ok: true, word: 'wolves', corrected: false });
  });

  it('rejects empty, malformed and unknown input', async () => {
    expect(await engine().parseMove('  ')).toMatchObject({ ok: false, reason: 'empty' });
    expect(await engine().parseMove('-')).toMatchObject({ ok: false, reason: 'empty' });
    expect(await engine().parseMove('ice cream')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await engine().parseMove('r2d2')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await engine().parseMove('unicorn')).toMatchObject({ ok: false, reason: 'unknown' });
  });
});

describe('Engine rounds', () => {
  it('starts a round at the start word', async () => {
    const round = await engine().newRound('unlimited', 'king', 'queen');
    expect(round).toMatchObject({ mode: 'unlimited', puzzle: null, start: 'king', goal: 'queen', status: 'playing', hints: 0 });
    expect(currentWord(round)).toBe('king');
    expect(round.startCloseness.tier).not.toBe('goal');
  });

  it('refuses words outside the vocabulary', async () => {
    await expect(engine().newRound('daily', 'king', 'unicorn', 1)).rejects.toThrow(/unicorn/);
  });

  it('lands on the nearest noun, excluding the current word and the operand', async () => {
    const e = engine();
    let round = await e.newRound('unlimited', 'king', 'queen');
    // king - man points mostly along "royalty"; king and man themselves are excluded.
    round = await e.play(round, 'subtract', 'man');
    expect(round.steps[0]).toMatchObject({ from: 'king', op: 'subtract', operand: 'man', result: 'crown' });
    expect(round.status).toBe('playing');

    round = await e.play(round, 'add', 'woman');
    expect(currentWord(round)).toBe('queen');
    expect(round.status).toBe('won');
    expect(currentCloseness(round)).toMatchObject({ score: 100, tier: 'goal' });
    await expect(e.play(round, 'add', 'dog')).rejects.toThrow(/over/);
  });

  it('can never land on the operand, so adding the goal itself does not win', async () => {
    const e = engine();
    const round = await e.play(await e.newRound('unlimited', 'king', 'queen'), 'add', 'queen');
    expect(currentWord(round)).not.toBe('queen');
  });

  it('never lands on another form of the typed word', async () => {
    const e = engine();
    // "queens" points straight at "queen", but plural and singular count as the same word.
    const round = await e.play(await e.newRound('unlimited', 'crown', 'queen'), 'add', 'queens');
    expect(currentWord(round)).not.toBe('queen');
    expect(round.status).toBe('playing');
  });

  it('refuses to subtract the current word from itself', async () => {
    const e = engine();
    const round = await e.newRound('unlimited', 'dog', 'sea');
    await expect(e.play(round, 'subtract', 'dog')).rejects.toBeInstanceOf(MoveError);
    // Adding it is fine: same direction, so it moves to the nearest neighbour.
    expect(currentWord(await e.play(round, 'add', 'dog'))).toBe('cat');
  });

  it('gives up only while playing', async () => {
    const e = engine();
    const round = await e.newRound('unlimited', 'dog', 'sea');
    const gaveUp = e.giveUp(round);
    expect(gaveUp.status).toBe('gave-up');
    expect(e.giveUp(gaveUp)).toBe(gaveUp);
  });

  it('does not mutate the previous round', async () => {
    const e = engine();
    const round = await e.newRound('unlimited', 'dog', 'sea');
    const next = await e.play(round, 'add', 'sea');
    expect(round.steps).toHaveLength(0);
    expect(next.steps).toHaveLength(1);
  });
});

describe('Engine.hint', () => {
  it('finds a move that reaches the goal when one exists', async () => {
    const e = engine();
    const round = await e.newRound('unlimited', 'crown', 'queen');
    const hint = await e.hint(round);
    expect(hint).toMatchObject({ op: 'add', word: 'woman', result: 'queen', improves: true });
    expect(hint!.closeness.tier).toBe('goal');
    expect((await e.play(round, hint!.op, hint!.word)).status).toBe('won');
  });

  it('predicts exactly where the suggested move lands', async () => {
    const e = engine();
    for (const [start, goal] of [['dog', 'sea'], ['king', 'fish'], ['cat', 'crown']]) {
      const round = await e.newRound('unlimited', start, goal);
      const hint = (await e.hint(round))!;
      expect(hint.word).not.toBe(start);
      const played = await e.play(round, hint.op, hint.word);
      expect(currentWord(played)).toBe(hint.result);
    }
  });

  it('says whether the suggestion actually gets closer', async () => {
    const e = engine();
    const p = e.provider;
    const round = await e.newRound('unlimited', 'dog', 'sea');
    const hint = (await e.hint(round))!;
    const [dog, sea, result] = await Promise.all([p.getVector('dog'), p.getVector('sea'), p.getVector(hint.result)]);
    expect(hint.improves).toBe(hint.result === 'sea' || cosine(result!, sea!) > cosine(dog!, sea!));
  });

  it('gives no hint once the round is over', async () => {
    const e = engine();
    expect(await e.hint(e.giveUp(await e.newRound('unlimited', 'dog', 'sea')))).toBeNull();
  });
});

describe('Engine.closeness', () => {
  it('ranks words by how close they are to the goal', async () => {
    const e = engine();
    const prince = await e.closeness('prince', 'king'); // nearest neighbour of king
    const sea = await e.closeness('sea', 'king'); // unrelated
    expect(prince.rank).toBe(1);
    expect(prince.tier).toBe('hot');
    expect(prince.score).toBe(99);
    expect(sea.rank).toBeNull();
    expect(sea.tier).toBe('cold');
    expect(sea.score).toBeLessThan(40);
    expect(prince.similarity).toBeGreaterThan(sea.similarity);
  });

  it('scores 100 only for the goal itself', async () => {
    expect(await engine().closeness('king', 'king')).toMatchObject({ score: 100, tier: 'goal' });
  });

  it('places warm words between hot and cold', async () => {
    const e = engine();
    const ranked = await Promise.all(['prince', 'crown', 'man', 'queen', 'cat'].map((w) => e.closeness(w, 'king')));
    const warm = ranked.find((c) => c.tier === 'warm');
    expect(warm).toBeDefined();
    expect(warm!.score).toBeGreaterThanOrEqual(40);
    expect(warm!.score).toBeLessThan(99);
  });
});
