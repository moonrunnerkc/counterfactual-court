import { calculate } from './calculator.js';

/** Depth-2 dependent that consumes calculator. Demonstrates ripple > 2 entries. */
export function report(): string {
  return `sum=${calculate('add', 10, 20)};diff=${calculate('sub', 10, 20)}`;
}
