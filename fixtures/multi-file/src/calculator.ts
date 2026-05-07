import { add, sub } from './math.js';

/** Tiny calculator built on top of math.ts. */
export function calculate(op: 'add' | 'sub', a: number, b: number): number {
  if (op === 'add') return add(a, b);
  return sub(a, b);
}
