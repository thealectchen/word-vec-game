import type { Round, Tier } from './engine';

const TIER_EMOJI: Record<Tier, string> = { cold: '⬜', warm: '🟨', hot: '🟧', goal: '🟩' };

/** Spoiler-free summary of a finished round, Wordle style. */
export function shareText(round: Round, gameName: string, url?: string): string {
  const steps = round.steps.length;
  const stepWord = steps === 1 ? 'step' : 'steps';
  const title = round.mode === 'daily' && round.puzzle !== null ? `${gameName} #${round.puzzle}` : `${gameName} (unlimited)`;
  const outcome = round.status === 'won' ? `${steps} ${stepWord}` : `gave up after ${steps} ${stepWord}`;
  const lines = [
    `${title} · ${outcome}`,
    `${round.start.toUpperCase()} → ${round.goal.toUpperCase()}`,
    round.steps.map((s) => TIER_EMOJI[s.closeness.tier]).join('') + (round.status === 'gave-up' ? '❌' : ''),
  ];
  if (url) lines.push(url);
  return lines.filter(Boolean).join('\n');
}
