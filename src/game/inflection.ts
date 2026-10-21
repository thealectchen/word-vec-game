const IRREGULAR_PLURALS: Record<string, string> = {
  brethren: 'brother',
  cacti: 'cactus',
  children: 'child',
  criteria: 'criterion',
  feet: 'foot',
  fungi: 'fungus',
  geese: 'goose',
  lice: 'louse',
  mice: 'mouse',
  oxen: 'ox',
  people: 'person',
  phenomena: 'phenomenon',
  teeth: 'tooth',
};
const IRREGULAR_SINGULARS = Object.fromEntries(Object.entries(IRREGULAR_PLURALS).map(([p, s]) => [s, p]));

/**
 * Possible singular forms of `word`, most likely first. Used when a player
 * types a plural that isn't in the vocabulary ("wolves" -> "wolf").
 */
export function singularCandidates(word: string): string[] {
  const candidates: string[] = [];
  const add = (w: string) => {
    if (w.length >= 2 && w !== word && !candidates.includes(w)) candidates.push(w);
  };
  if (IRREGULAR_PLURALS[word]) add(IRREGULAR_PLURALS[word]);
  if (word.endsWith('men')) add(`${word.slice(0, -3)}man`);
  // Callers try candidates in order and keep the first known word, so the
  // plain "-s" rule goes first: "shoes" -> "shoe" before "sho".
  if (word.endsWith('s') && !word.endsWith('ss')) add(word.slice(0, -1));
  if (word.endsWith('ies')) add(`${word.slice(0, -3)}y`);
  if (word.endsWith('ves')) {
    add(`${word.slice(0, -3)}f`);
    add(`${word.slice(0, -3)}fe`);
  }
  if (/(s|x|z|ch|sh|o)es$/.test(word)) add(word.slice(0, -2));
  return candidates;
}

/** Possible plural forms of `word` ("hand" -> "hands", "knife" -> "knives"). */
export function pluralCandidates(word: string): string[] {
  const candidates = [`${word}s`];
  if (IRREGULAR_SINGULARS[word]) candidates.push(IRREGULAR_SINGULARS[word]);
  if (word.endsWith('man')) candidates.push(`${word.slice(0, -3)}men`);
  if (/[^aeiou]y$/.test(word)) candidates.push(`${word.slice(0, -1)}ies`);
  if (word.endsWith('f')) candidates.push(`${word.slice(0, -1)}ves`);
  if (word.endsWith('fe')) candidates.push(`${word.slice(0, -2)}ves`);
  if (/(s|x|z|ch|sh|o)$/.test(word)) candidates.push(`${word}es`);
  return candidates;
}

/**
 * The word plus its likely singular and plural forms. A step never lands on
 * any form of the current word or the typed word, so typing "hands" can't
 * land on "hand".
 */
export function wordForms(word: string): string[] {
  return [word, ...singularCandidates(word), ...pluralCandidates(word)];
}
