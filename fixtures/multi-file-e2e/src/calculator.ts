import { add, sub } from './math.js';

/** Calculator built on math.ts. Direct importer (depth 1 of the patched file). */
export function calculate(op: 'add' | 'sub', a: number, b: number): number {
  if (op === 'add') return add(a, b);
  return sub(a, b);
}
