/**
 * MERQO Retail Suite — money primitives.
 *
 * All monetary amounts in the database and on the API wire are INTEGER POISHA
 * (1 taka = 100 poisha). Floating point never touches stored money.
 * Quantities are REAL with 3-decimal-place rounding (kg/litre support).
 */

export const POISHA = 100

/** Taka (float from UI input) → poisha integer. Rounds half-up. */
export function takaToPoisha(taka: number): number {
  if (!Number.isFinite(taka)) return 0
  return Math.round(taka * POISHA)
}

/** Poisha integer → taka float (for display only). */
export function poishaToTaka(poisha: number): number {
  return poisha / POISHA
}

/** Round quantity to 3 decimal places. */
export function roundQty(qty: number): number {
  if (!Number.isFinite(qty)) return 0
  return Math.round(qty * 1000) / 1000
}

/** Distribute `total` poisha across `parts` weights proportionally, remainder-safe (largest remainder). */
export function allocateProportionally(total: number, weights: number[]): number[] {
  const n = weights.length
  if (n === 0) return []
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum <= 0) {
    const each = Math.floor(total / n)
    const out = new Array(n).fill(each)
    out[0] += total - each * n
    return out
  }
  const raw = weights.map((w) => (total * w) / sum)
  const floors = raw.map(Math.floor)
  let remainder = total - floors.reduce((a, b) => a + b, 0)
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)
  const out = floors.slice()
  let k = 0
  while (remainder > 0 && order.length) {
    out[order[k % order.length].i] += 1
    remainder -= 1
    k += 1
  }
  return out
}
