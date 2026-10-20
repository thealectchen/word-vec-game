const IRREGULAR_PLURALS: Record<string, string> = {
  children: 'child',
  feet: 'foot',
  geese: 'goose',
  lice: 'louse',
  mice: 'mouse',
  oxen: 'ox',
  teeth: 'tooth',
  people: 'person',
};

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
