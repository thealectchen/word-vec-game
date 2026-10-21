import type { Mode, Round } from './engine';
import { DISTRIBUTION_BUCKETS, emptyStats, type Stats } from './stats';

/**
 * Persists progress in localStorage. Every access is wrapped because storage
 * can be unavailable (private browsing, blocked cookies); the game still
 * works, it just forgets progress on reload.
 */

const PREFIX = 'vectordle:v1:';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable; nothing useful to do.
  }
}

function looksLikeRound(value: unknown): value is Round {
  const r = value as Round | null;
  return (
    !!r &&
    typeof r.start === 'string' &&
    typeof r.goal === 'string' &&
    Array.isArray(r.steps) &&
    ['playing', 'won', 'gave-up'].includes(r.status)
  );
}

export function loadRound(mode: Mode): Round | null {
  const round = read<unknown>(`round:${mode}`);
  // Rounds saved before hints existed have no hint count.
  return looksLikeRound(round) && round.mode === mode ? { ...round, hints: round.hints ?? 0 } : null;
}

export function saveRound(round: Round): void {
  write(`round:${round.mode}`, round);
}

export function loadStats(): Stats {
  const stats = read<Stats>('stats');
  const empty = emptyStats();
  if (!stats?.daily || !stats?.unlimited) return empty;
  const fix = <T extends { distribution: number[] }>(s: T): T =>
    s.distribution?.length === DISTRIBUTION_BUCKETS ? s : { ...s, distribution: [...empty.daily.distribution] };
  return { daily: fix({ ...empty.daily, ...stats.daily }), unlimited: fix({ ...empty.unlimited, ...stats.unlimited }) };
}

export function saveStats(stats: Stats): void {
  write('stats', stats);
}

export function loadMode(): Mode {
  return read<Mode>('mode') === 'unlimited' ? 'unlimited' : 'daily';
}

export function saveMode(mode: Mode): void {
  write('mode', mode);
}

export function hasSeenHelp(): boolean {
  return read<boolean>('seen-help') === true;
}

export function markHelpSeen(): void {
  write('seen-help', true);
}
