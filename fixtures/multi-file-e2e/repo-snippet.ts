// Concatenated repo working set for the multi-file-e2e fixture.
// Used by the Phase 1 fixture loader; agents see this verbatim.
//
// Files in this fixture monorepo:
//   src/math.ts        - the file being patched (add, sub primitives)
//   src/index.ts       - re-export barrel of math.ts
//   src/calculator.ts  - direct importer of math.ts
//   src/cli.ts         - imports calculate and add (depth 2)
//   src/report.ts      - imports calculate (depth 2)

// src/math.ts (pre-patch)
export const add = (a: number, b: number): number => a + b;
export const sub = (a: number, b: number): number => a - b;
