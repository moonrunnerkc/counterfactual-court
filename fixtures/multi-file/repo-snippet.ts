// Concatenated repo working set for the multi-file fixture. Used by the
// Phase 1 fixture loader; agents see this verbatim so prompts stay stable
// across runs.

// src/math.ts
export const add = (a: number, b: number): number => a + b;
export const sub = (a: number, b: number): number => a - b;

// src/index.ts
// export * from './math.js';

// src/calculator.ts
// imports add, sub from './math.js' and exports calculate(op, a, b).

// src/cli.ts
// imports calculate from './calculator.js' and add from './index.js'.

// src/unrelated.ts
// export const unrelated = 'island';
