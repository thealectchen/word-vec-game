import { hashString, pickPair, seededRandom } from './random';

const DAY_MS = 24 * 60 * 60 * 1000;

function localMidnight(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function parseLocalDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Daily puzzle number for `date` in the player's time zone; the epoch date is #1. */
export function puzzleNumber(date: Date, epoch: string): number {
  // Rounding absorbs the 23/25-hour days around daylight-saving changes.
  const days = Math.round((localMidnight(date) - localMidnight(parseLocalDate(epoch))) / DAY_MS);
  return Math.max(1, days + 1);
}

/** The start/goal pair for a daily puzzle. Everyone gets the same pair for the same number. */
export function dailyPair(puzzle: number, pool: readonly string[]): { start: string; goal: string } {
  return pickPair(pool, seededRandom(hashString(`daily:${puzzle}`)));
}

export function msUntilNextPuzzle(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}
