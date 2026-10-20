import type { Round } from './engine';

/** Step-count histogram buckets: 1, 2, ... (BUCKETS - 1), then "BUCKETS or more". */
export const DISTRIBUTION_BUCKETS = 7;

export interface ModeStats {
  played: number;
  won: number;
  currentStreak: number;
  maxStreak: number;
  /** distribution[i] = wins that took i + 1 steps (last bucket is "or more"). */
  distribution: number[];
}

export interface Stats {
  daily: ModeStats & { lastPuzzle: number | null; lastWonPuzzle: number | null };
  unlimited: ModeStats;
}

function emptyMode(): ModeStats {
  return { played: 0, won: 0, currentStreak: 0, maxStreak: 0, distribution: Array(DISTRIBUTION_BUCKETS).fill(0) };
}

export function emptyStats(): Stats {
  return { daily: { ...emptyMode(), lastPuzzle: null, lastWonPuzzle: null }, unlimited: emptyMode() };
}

function withResult<T extends ModeStats>(stats: T, won: boolean, steps: number, continuesStreak: boolean): T {
  const next = { ...stats, distribution: [...stats.distribution], played: stats.played + 1 };
  if (won) {
    next.won += 1;
    next.distribution[Math.min(steps, DISTRIBUTION_BUCKETS) - 1] += 1;
    next.currentStreak = continuesStreak ? stats.currentStreak + 1 : 1;
    next.maxStreak = Math.max(next.maxStreak, next.currentStreak);
  } else {
    next.currentStreak = 0;
  }
  return next;
}

/** Stats after a finished round. Recording the same daily puzzle twice is a no-op. */
export function recordRound(stats: Stats, round: Round): Stats {
  if (round.status === 'playing') return stats;
  const won = round.status === 'won';
  const steps = round.steps.length;

  if (round.mode === 'daily' && round.puzzle !== null) {
    const daily = stats.daily;
    if (daily.lastPuzzle !== null && round.puzzle <= daily.lastPuzzle) return stats;
    const next = withResult(daily, won, steps, daily.lastWonPuzzle === round.puzzle - 1);
    return {
      ...stats,
      daily: { ...next, lastPuzzle: round.puzzle, lastWonPuzzle: won ? round.puzzle : daily.lastWonPuzzle },
    };
  }
  return { ...stats, unlimited: withResult(stats.unlimited, won, steps, true) };
}

/** A daily streak only counts if the last win was today's or yesterday's puzzle. */
export function dailyStreak(stats: Stats, todayPuzzle: number): number {
  const last = stats.daily.lastWonPuzzle;
  return last !== null && last >= todayPuzzle - 1 ? stats.daily.currentStreak : 0;
}
