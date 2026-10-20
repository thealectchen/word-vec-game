export type Vector = ArrayLike<number>;

export function dot(a: Vector, b: Vector): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export function norm(a: Vector): number {
  return Math.sqrt(dot(a, a));
}

/** `a + sign * b` as a new vector. */
export function combine(a: Vector, b: Vector, sign: 1 | -1): Float32Array {
  if (a.length !== b.length) throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + sign * b[i];
  return out;
}

export function normalize(a: Vector): Float32Array {
  const n = norm(a);
  const out = new Float32Array(a.length);
  if (n === 0) return out;
  for (let i = 0; i < a.length; i++) out[i] = a[i] / n;
  return out;
}

export function cosine(a: Vector, b: Vector): number {
  const denom = norm(a) * norm(b);
  return denom === 0 ? 0 : dot(a, b) / denom;
}
