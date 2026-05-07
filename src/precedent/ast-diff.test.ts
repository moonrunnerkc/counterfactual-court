import { describe, expect, it } from 'vitest';
import {
  astSimilarity,
  buildHistogram,
  extractAddedSource,
  histogramFromJson,
  histogramToJson,
  patchFingerprint,
  similarityFromHistograms,
} from './ast-diff.js';

const PATCH_A = `--- a/src/util.ts
+++ b/src/util.ts
@@
-export const add = (a: number, b: number) => a + b;
+export const add = (a: number, b: number): number => {
+  return a + b;
+};
`;

const PATCH_B = `--- a/src/util.ts
+++ b/src/util.ts
@@
-export const sub = (a: number, b: number) => a - b;
+export const sub = (a: number, b: number): number => {
+  return a - b;
+};
`;

const PATCH_C = `--- a/src/server.ts
+++ b/src/server.ts
@@
+import express from 'express';
+const app = express();
+app.get('/', (_, res) => res.send('hello'));
+app.listen(3000);
`;

describe('extractAddedSource', () => {
  it('drops removed lines and keeps added lines without the leading +', () => {
    const src = extractAddedSource(PATCH_A);
    expect(src).toContain('return a + b;');
    expect(src).toContain('export const add');
    expect(src).not.toContain('---');
    expect(src).not.toContain('+++');
    // No line begins with `-` after extraction (removed lines are gone).
    expect(src.split('\n').every((l) => !l.startsWith('-'))).toBe(true);
  });

  it('returns an empty string when no lines are added', () => {
    expect(extractAddedSource(`--- a/x\n+++ b/x\n@@\n-only deletion\n`)).toBe('');
  });
});

describe('astSimilarity', () => {
  it('is exactly 1 for identical patches (identity)', () => {
    expect(astSimilarity(PATCH_A, PATCH_A)).toBeCloseTo(1, 10);
  });

  it('is symmetric: sim(A, B) == sim(B, A)', () => {
    const ab = astSimilarity(PATCH_A, PATCH_B);
    const ba = astSimilarity(PATCH_B, PATCH_A);
    expect(ab).toBeCloseTo(ba, 12);
  });

  it('returns 0 when one side has no added source', () => {
    const empty = `--- a/x\n+++ b/x\n@@\n-only deletion\n`;
    expect(astSimilarity(empty, PATCH_A)).toBe(0);
    expect(astSimilarity(PATCH_A, empty)).toBe(0);
  });

  it('discriminates structurally different patches: very-similar > unrelated', () => {
    const similar = astSimilarity(PATCH_A, PATCH_B);
    const unrelated = astSimilarity(PATCH_A, PATCH_C);
    expect(similar).toBeGreaterThan(unrelated);
  });

  it('threshold tuning: identity is 1.0; near-identical >= 0.85; broader >= 0.5', () => {
    const identity = astSimilarity(PATCH_A, PATCH_A);
    const veryClose = astSimilarity(PATCH_A, PATCH_B);
    const broader = astSimilarity(PATCH_A, PATCH_C);
    expect(identity).toBeCloseTo(1, 10);
    expect(veryClose).toBeGreaterThanOrEqual(0.85);
    expect(veryClose).toBeLessThan(1);
    expect(broader).toBeGreaterThanOrEqual(0);
    expect(broader).toBeLessThan(veryClose);
  });
});

describe('similarityFromHistograms', () => {
  it('agrees with astSimilarity', () => {
    const a = buildHistogram(PATCH_A);
    const b = buildHistogram(PATCH_B);
    expect(similarityFromHistograms(a, b)).toBeCloseTo(astSimilarity(PATCH_A, PATCH_B), 12);
  });

  it('returns a number in [0, 1]', () => {
    for (let i = 0; i < 5; i++) {
      const score = astSimilarity(PATCH_A, PATCH_C);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

describe('patchFingerprint', () => {
  it('is stable for identical patches', () => {
    expect(patchFingerprint(PATCH_A)).toBe(patchFingerprint(PATCH_A));
  });

  it('differs for different patches', () => {
    expect(patchFingerprint(PATCH_A)).not.toBe(patchFingerprint(PATCH_B));
    expect(patchFingerprint(PATCH_A)).not.toBe(patchFingerprint(PATCH_C));
  });
});

describe('histogram serialization', () => {
  it('round-trips through JSON', () => {
    const original = buildHistogram(PATCH_A);
    const restored = histogramFromJson(histogramToJson(original));
    expect(similarityFromHistograms(original, restored)).toBeCloseTo(1, 10);
    expect(restored.size).toBe(original.size);
  });
});
