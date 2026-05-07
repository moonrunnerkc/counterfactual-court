import { buildHistogram, similarityFromHistograms } from './ast-diff.js';
import { entryHistogram, type LedgerEntry, type LedgerHandle } from './ledger.js';

/** A {@link LedgerEntry} paired with its similarity score against a target patch. */
export interface ScoredPrecedent {
  readonly entry: LedgerEntry;
  readonly similarity: number;
}

/** Options for {@link queryPrecedents}. */
export interface QueryOptions {
  /** Minimum similarity score [0, 1] for an entry to be returned. */
  readonly threshold: number;
  /** Maximum entries to return after sorting by descending score. */
  readonly topN: number;
}

/**
 * Query the ledger for precedents structurally similar to a target patch.
 * Results are sorted by descending similarity. Pure: never mutates the input
 * handle.
 *
 * @param handle   Open ledger handle.
 * @param patchText Unified-diff text of the new patch.
 * @param opts     Threshold and topN.
 * @returns Sorted list of {@link ScoredPrecedent}, length <= `opts.topN`.
 */
export function queryPrecedents(
  handle: LedgerHandle,
  patchText: string,
  opts: QueryOptions,
): readonly ScoredPrecedent[] {
  const target = buildHistogram(patchText);
  if (target.size === 0) return [];
  const scored: ScoredPrecedent[] = [];
  for (const entry of handle.entries) {
    const similarity = similarityFromHistograms(target, entryHistogram(entry));
    if (similarity >= opts.threshold) {
      scored.push({ entry, similarity });
    }
  }
  scored.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    return a.entry.storedAt.localeCompare(b.entry.storedAt);
  });
  return scored.slice(0, Math.max(0, opts.topN));
}
