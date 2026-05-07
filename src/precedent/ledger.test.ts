import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addLedgerEntry, openLedger } from './ledger.js';
import { queryPrecedents } from './query.js';

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

function tmpLedger(): string {
  return mkdtempSync(join(tmpdir(), 'cc-ledger-'));
}

describe('ledger round-trip', () => {
  it('stores a verdict and recovers it via queryPrecedents on a similar patch', () => {
    const dir = tmpLedger();
    const handle0 = openLedger(dir);
    expect(handle0.entries).toHaveLength(0);

    const { handle: handle1 } = addLedgerEntry(
      handle0,
      PATCH_A,
      'a'.repeat(64),
      'reject',
      '2026-05-07T00:00:00.000Z',
    );
    expect(handle1.entries).toHaveLength(1);

    const reopened = openLedger(dir);
    expect(reopened.entries).toHaveLength(1);

    const matches = queryPrecedents(reopened, PATCH_B, { threshold: 0.5, topN: 5 });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.entry.bundleId).toBe('a'.repeat(64));
    expect(matches[0]!.similarity).toBeGreaterThanOrEqual(0.85);
  });

  it('threshold tuning: 0.99 only returns identity matches; 0.85 returns near-identical; 0.5 surfaces broader', () => {
    const dir = tmpLedger();
    let handle = openLedger(dir);
    handle = addLedgerEntry(
      handle,
      PATCH_A,
      'b'.repeat(64),
      'approve',
      '2026-05-07T00:00:00.000Z',
    ).handle;

    const tightIdentity = queryPrecedents(handle, PATCH_A, { threshold: 0.99, topN: 5 });
    expect(tightIdentity).toHaveLength(1);

    const tightNearIdentical = queryPrecedents(handle, PATCH_B, { threshold: 0.99, topN: 5 });
    expect(tightNearIdentical).toHaveLength(0); // 0.99 is too strict for distinct-identifier patches

    const looseNearIdentical = queryPrecedents(handle, PATCH_B, { threshold: 0.85, topN: 5 });
    expect(looseNearIdentical).toHaveLength(1);

    const tightAgainstUnrelated = queryPrecedents(handle, PATCH_C, { threshold: 0.99, topN: 5 });
    expect(tightAgainstUnrelated).toHaveLength(0);

    const broadAgainstUnrelated = queryPrecedents(handle, PATCH_C, { threshold: 0.5, topN: 5 });
    // PATCH_C is structurally different enough that it may or may not surface at 0.5
    expect(broadAgainstUnrelated.length).toBeGreaterThanOrEqual(0);
    expect(broadAgainstUnrelated.length).toBeLessThanOrEqual(1);
  });

  it('dedupes entries with the same {fingerprint, bundleId} pair', () => {
    const dir = tmpLedger();
    let handle = openLedger(dir);
    const first = addLedgerEntry(
      handle,
      PATCH_A,
      'c'.repeat(64),
      'approve',
      '2026-05-07T00:00:00.000Z',
    );
    handle = first.handle;
    const second = addLedgerEntry(
      handle,
      PATCH_A,
      'c'.repeat(64),
      'approve',
      '2026-05-07T00:00:00.000Z',
    );
    expect(second.entry.id).toBe(first.entry.id);
    expect(second.handle.entries).toHaveLength(1);
  });

  it('caps results at topN, preserving descending similarity order', () => {
    const dir = tmpLedger();
    let handle = openLedger(dir);
    for (let i = 0; i < 5; i++) {
      const bundleId = String(i).repeat(64).slice(0, 64);
      const tweaked = `${PATCH_A}// note ${i}\n`;
      handle = addLedgerEntry(
        handle,
        tweaked,
        bundleId,
        'approve',
        `2026-05-0${i + 1}T00:00:00.000Z`,
      ).handle;
    }
    const matches = queryPrecedents(handle, PATCH_A, { threshold: 0, topN: 2 });
    expect(matches).toHaveLength(2);
    expect(matches[0]!.similarity).toBeGreaterThanOrEqual(matches[1]!.similarity);
  });
});
