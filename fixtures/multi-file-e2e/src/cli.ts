import { calculate } from './calculator.js';
import { add } from './index.js';

/** Imports both directly and via the re-export barrel; depth 2 of the patched file. */
export function runCli(): number {
  return calculate('add', 1, 2) + add(3, 4);
}
