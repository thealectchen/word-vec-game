/** 32-bit FNV-1a hash of a string. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Small seeded PRNG (mulberry32) returning floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Two different words from `pool`. */
export function pickPair(pool: readonly string[], random: () => number = Math.random): { start: string; goal: string } {
  if (pool.length < 2) throw new Error('The word pool needs at least two words');
  const start = pool[Math.floor(random() * pool.length)];
  let goal = start;
  while (goal === start) goal = pool[Math.floor(random() * pool.length)];
  return { start, goal };
}
