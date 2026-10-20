import type { EmbeddingProvider } from '../embeddings';
import { combine, cosine } from '../embeddings/vectorMath';
import { singularCandidates } from './inflection';

export type Operation = 'add' | 'subtract';
export type Mode = 'daily' | 'unlimited';
export type RoundStatus = 'playing' | 'won' | 'gave-up';
/** How close a word is to the goal: cold < warm < hot < goal. */
export type Tier = 'cold' | 'warm' | 'hot' | 'goal';

export interface Closeness {
  /**
   * 0-100, only the goal itself scores 100. Words among the goal's nearest
   * neighbours score by rank (#1 = 99, #10 ~ 80, #100 ~ 60, #1000 = 40);
   * words further out score 0-40 by cosine similarity.
   */
  score: number;
  /** Raw cosine similarity to the goal. */
  similarity: number;
  /** Position among the goal's nearest words (1 = closest), or null if not in the top `rankDepth`. */
  rank: number | null;
  tier: Tier;
}

export interface Step {
  from: string;
  op: Operation;
  operand: string;
  result: string;
  closeness: Closeness;
}

/** Plain data so it can be saved to localStorage as-is. */
export interface Round {
  mode: Mode;
  /** Daily puzzle number; null in unlimited mode. */
  puzzle: number | null;
  start: string;
  goal: string;
  startCloseness: Closeness;
  steps: Step[];
  status: RoundStatus;
}

export type ParsedMove =
  | {
      ok: true;
      word: string;
      /** Set when the input started with "+" or "-". */
      op: Operation | null;
      /** The typed word was a plural that got mapped to this singular. */
      corrected: boolean;
    }
  | { ok: false; reason: 'empty' | 'invalid' | 'unknown'; message: string };

export interface EngineOptions {
  /** How many of the goal's neighbours to rank. */
  rankDepth: number;
  /** Ranks up to this are "hot". */
  hotRank: number;
  /** Ranks up to this are "warm". */
  warmRank: number;
}

const DEFAULT_OPTIONS: EngineOptions = { rankDepth: 1000, hotRank: 100, warmRank: 1000 };

/** A move the rules don't allow; the message is meant for the player. */
export class MoveError extends Error {}

export function currentWord(round: Round): string {
  return round.steps.length ? round.steps[round.steps.length - 1].result : round.start;
}

export function currentCloseness(round: Round): Closeness {
  return round.steps.length ? round.steps[round.steps.length - 1].closeness : round.startCloseness;
}

export class Engine {
  private readonly options: EngineOptions;
  /** The most recent goal's nearest neighbours. */
  private goalNeighbors: { goal: string; info: Promise<GoalNeighbors> } | null = null;

  constructor(
    readonly provider: EmbeddingProvider,
    options: Partial<EngineOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async newRound(mode: Mode, start: string, goal: string, puzzle: number | null = null): Promise<Round> {
    for (const word of [start, goal]) {
      if (!(await this.provider.hasWord(word))) throw new Error(`"${word}" is not in the vocabulary`);
    }
    return {
      mode,
      puzzle,
      start,
      goal,
      startCloseness: await this.closeness(start, goal),
      steps: [],
      status: 'playing',
    };
  }

  /** Validate what the player typed. A leading "+" or "-" picks the operation. */
  async parseMove(raw: string): Promise<ParsedMove> {
    let text = raw.trim().toLowerCase();
    let op: Operation | null = null;
    if (/^[+]/.test(text)) op = 'add';
    else if (/^[-−]/.test(text)) op = 'subtract';
    if (op) text = text.slice(1).trim();

    if (!text) return { ok: false, reason: 'empty', message: 'Type a noun first' };
    if (/\s/.test(text)) return { ok: false, reason: 'invalid', message: 'One word at a time' };
    if (!/^[a-z]+$/.test(text)) return { ok: false, reason: 'invalid', message: 'Letters only, please' };

    if (await this.provider.hasWord(text)) return { ok: true, word: text, op, corrected: false };
    for (const candidate of singularCandidates(text)) {
      if (await this.provider.hasWord(candidate)) return { ok: true, word: candidate, op, corrected: true };
    }
    return { ok: false, reason: 'unknown', message: 'Not in the noun list' };
  }

  /**
   * Apply `current ± operand` and land on the nearest noun. The current word
   * and the operand are excluded from the result, as in classic word-vector
   * analogies (otherwise most steps would land back where they started).
   */
  async play(round: Round, op: Operation, operand: string): Promise<Round> {
    if (round.status !== 'playing') throw new Error('This round is already over');
    const from = currentWord(round);
    if (op === 'subtract' && operand === from) throw new MoveError('A word minus itself is nothing');
    const [a, b] = await Promise.all([this.provider.getVector(from), this.provider.getVector(operand)]);
    if (!a) throw new Error(`No vector for "${from}"`);
    if (!b) throw new Error(`No vector for "${operand}"`);

    const target = combine(a, b, op === 'add' ? 1 : -1);
    const [best] = await this.provider.nearest(target, { k: 1, exclude: [from, operand] });
    if (!best) throw new Error('The vocabulary has no words to land on');

    const step: Step = { from, op, operand, result: best.word, closeness: await this.closeness(best.word, round.goal) };
    return {
      ...round,
      steps: [...round.steps, step],
      status: best.word === round.goal ? 'won' : 'playing',
    };
  }

  giveUp(round: Round): Round {
    return round.status === 'playing' ? { ...round, status: 'gave-up' } : round;
  }

  async closeness(word: string, goal: string): Promise<Closeness> {
    if (word === goal) return { score: 100, similarity: 1, rank: null, tier: 'goal' };
    const [wordVector, goalVector, neighbors] = await Promise.all([
      this.provider.getVector(word),
      this.provider.getVector(goal),
      this.neighborsOf(goal),
    ]);
    const similarity = wordVector && goalVector ? cosine(wordVector, goalVector) : 0;
    const rank = neighbors.ranks.get(word) ?? null;
    const { hotRank, warmRank, rankDepth } = this.options;

    let score: number;
    if (rank !== null) {
      // Log scale: rank 1 -> 99, rank `rankDepth` -> 40.
      score = 40 + 59 * (1 - Math.log10(rank) / Math.log10(Math.max(rankDepth, 10)));
    } else {
      score = neighbors.edge > 0 ? (40 * Math.max(0, similarity)) / neighbors.edge : 0;
    }
    score = Math.round(Math.min(rank === null ? 39 : 99, Math.max(0, score)));
    const tier: Tier = rank === null ? 'cold' : rank <= hotRank ? 'hot' : rank <= warmRank ? 'warm' : 'cold';
    return { score, similarity, rank, tier };
  }

  private neighborsOf(goal: string): Promise<GoalNeighbors> {
    if (this.goalNeighbors?.goal !== goal) {
      const info = (async (): Promise<GoalNeighbors> => {
        const vector = await this.provider.getVector(goal);
        if (!vector) return { ranks: new Map(), edge: 0 };
        const neighbors = await this.provider.nearest(vector, { k: this.options.rankDepth, exclude: [goal] });
        return {
          ranks: new Map(neighbors.map((n, i) => [n.word, i + 1])),
          edge: neighbors.length ? neighbors[neighbors.length - 1].similarity : 0,
        };
      })();
      this.goalNeighbors = { goal, info };
    }
    return this.goalNeighbors.info;
  }
}

interface GoalNeighbors {
  /** Word -> 1-based rank among the goal's nearest words. */
  ranks: Map<string, number>;
  /** Similarity of the furthest ranked neighbour. */
  edge: number;
}
