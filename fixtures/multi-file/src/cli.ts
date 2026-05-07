import { calculate } from './calculator.js';
import { add } from './index.js';

/** Imports both directly and through the re-export barrel to test traversal. */
export function runCli(): number {
  return calculate('add', 1, 2) + add(3, 4);
}
