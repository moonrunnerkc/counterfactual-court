import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { changedFilesFromPatch, computeRippleSet, traceImpact } from './impact-trace.js';
import { buildImportGraph } from './import-graph.js';

const FIXTURE_ROOT = resolve(__dirname, '..', '..', 'fixtures', 'multi-file');
const FILES = [
  'src/math.ts',
  'src/index.ts',
  'src/calculator.ts',
  'src/cli.ts',
  'src/unrelated.ts',
];

const MATH_PATCH = `--- a/src/math.ts
+++ b/src/math.ts
@@
-export const add = (a: number, b: number): number => a + b;
-export const sub = (a: number, b: number): number => a - b;
+export const add = (a: number, b: number): number => a - b;
+export const sub = (a: number, b: number): number => a + b;
`;

describe('changedFilesFromPatch', () => {
  it('extracts the +++ b/<path> targets', () => {
    expect(changedFilesFromPatch(MATH_PATCH)).toEqual(['src/math.ts']);
  });

  it('handles a multi-file patch and skips /dev/null', () => {
    const patch = `--- a/src/a.ts\n+++ b/src/a.ts\n@@\n+x\n--- a/src/b.ts\n+++ /dev/null\n--- /dev/null\n+++ b/src/c.ts\n@@\n+y\n`;
    expect(changedFilesFromPatch(patch).sort()).toEqual(['src/a.ts', 'src/c.ts']);
  });
});

describe('computeRippleSet', () => {
  it('surfaces every direct and transitive importer with depth', () => {
    const g = buildImportGraph(FIXTURE_ROOT, FILES);
    const ripple = computeRippleSet(g, MATH_PATCH);
    expect(ripple.changedFiles).toEqual(['src/math.ts']);

    const byFile = new Map(ripple.entries.map((e) => [e.file, e]));
    expect(byFile.get('src/calculator.ts')?.depth).toBe(1);
    expect(byFile.get('src/index.ts')?.depth).toBe(1);
    // cli.ts imports calculator (depth 2) and index (depth 2); both are depth 2 from math.
    expect(byFile.get('src/cli.ts')?.depth).toBe(2);
    // unrelated.ts must not appear.
    expect(byFile.has('src/unrelated.ts')).toBe(false);
  });

  it('returns an empty ripple set when the changed file is outside the graph', () => {
    const g = buildImportGraph(FIXTURE_ROOT, FILES);
    const offGraphPatch = `--- a/src/elsewhere.ts\n+++ b/src/elsewhere.ts\n@@\n+x\n`;
    const ripple = computeRippleSet(g, offGraphPatch);
    expect(ripple.changedFiles).toEqual([]);
    expect(ripple.entries).toEqual([]);
  });

  it('orders entries by ascending depth then file name', () => {
    const g = buildImportGraph(FIXTURE_ROOT, FILES);
    const ripple = computeRippleSet(g, MATH_PATCH);
    for (let i = 1; i < ripple.entries.length; i++) {
      const prev = ripple.entries[i - 1]!;
      const cur = ripple.entries[i]!;
      if (prev.depth === cur.depth) {
        expect(prev.file < cur.file).toBe(true);
      } else {
        expect(prev.depth).toBeLessThan(cur.depth);
      }
    }
  });
});

describe('traceImpact', () => {
  it('builds the graph and computes the ripple set in one call', () => {
    const { graph, rippleSet } = traceImpact(FIXTURE_ROOT, FILES, MATH_PATCH);
    expect(graph.files.length).toBe(FILES.length);
    expect(rippleSet.entries.length).toBeGreaterThan(0);
  });
});
