import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { canonicalJson, contentHash } from '../runtime/canonical.js';
import {
  buildHistogram,
  histogramFromJson,
  histogramToJson,
  patchFingerprint,
  type SyntaxHistogram,
} from './ast-diff.js';

/**
 * One row in the precedent ledger. Stored on disk as
 * `<ledgerDir>/<entry.id>.json`. Two entries with the same patch fingerprint
 * dedupe by id.
 */
export interface LedgerEntry {
  /** Content-addressed entry id: hash of the {patchFingerprint, bundleId} pair. */
  readonly id: string;
  /** AST-fingerprint of the patch this entry indexes. */
  readonly patchFingerprint: string;
  /** Verbatim post-image source the AST was built over (for audit). */
  readonly addedSource: string;
  /** Persisted histogram, keyed by SyntaxKind number. */
  readonly histogramJson: Record<string, number>;
  /** Bundle id (sha-256 hex) of the verdict that backs this precedent. */
  readonly bundleId: string;
  /** Final verdict label this precedent records. */
  readonly verdict: 'approve' | 'reject' | 'request-changes';
  /** ISO instant when the entry was written; supplied by the caller. */
  readonly storedAt: string;
}

/**
 * Opaque handle to an open ledger. Holds the resolved directory, the in-memory
 * snapshot of every entry, and the time the snapshot was taken. Callers treat
 * this as immutable: every write returns a new handle.
 */
export interface LedgerHandle {
  readonly dir: string;
  readonly entries: readonly LedgerEntry[];
}

/**
 * Resolve the ledger directory. Defaults to `~/.gemmacourt/ledger/` when no
 * override is provided. Honors the `GEMMACOURT_LEDGER_DIR` env override only
 * indirectly via the runtime config; callers pass it explicitly so this
 * module never reads `process.env`.
 *
 * @param dir Optional absolute or relative directory path.
 * @returns Absolute directory path.
 */
export function resolveLedgerDir(dir?: string): string {
  if (dir !== undefined && dir.length > 0) {
    return resolve(dir);
  }
  return resolve(homedir(), '.gemmacourt', 'ledger');
}

/**
 * Open the ledger directory: create it if absent, then load every entry on
 * disk into memory. Pure with respect to the in-memory snapshot the handle
 * carries; subsequent writes never mutate this handle.
 *
 * @param dir Ledger directory (resolved via {@link resolveLedgerDir}).
 * @returns A {@link LedgerHandle} with the loaded entries.
 */
export function openLedger(dir: string): LedgerHandle {
  const absDir = resolve(dir);
  if (!existsSync(absDir)) {
    mkdirSync(absDir, { recursive: true });
  }
  const files = readdirSync(absDir).filter((name) => name.endsWith('.json'));
  const entries: LedgerEntry[] = [];
  for (const name of files) {
    const path = join(absDir, name);
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const entry = coerceEntry(parsed);
    if (entry !== null) entries.push(entry);
  }
  entries.sort((a, b) => a.storedAt.localeCompare(b.storedAt));
  return { dir: absDir, entries };
}

/**
 * Add a precedent to the ledger. Returns a new handle whose `entries` array
 * contains the new row plus every previously-loaded row. The on-disk row is
 * written under `<dir>/<entry.id>.json` as canonical JSON.
 *
 * Pure with respect to the input handle: the same handle remains usable after
 * the call but does not reflect the addition; the caller switches to the
 * returned handle.
 *
 * @param handle      Source handle.
 * @param patchText   Unified-diff text of the new patch.
 * @param bundleId    Verdict bundle id (sha-256 hex of canonical body).
 * @param verdict     Final verdict label.
 * @param storedAtIso ISO instant; pass `ctx.clock.nowIso()` to keep the
 *                    timestamp deterministic.
 * @returns A {@link LedgerHandle} with the new entry appended.
 */
export function addLedgerEntry(
  handle: LedgerHandle,
  patchText: string,
  bundleId: string,
  verdict: LedgerEntry['verdict'],
  storedAtIso: string,
): { readonly handle: LedgerHandle; readonly entry: LedgerEntry } {
  const fingerprint = patchFingerprint(patchText);
  const id = contentHash({ patchFingerprint: fingerprint, bundleId });
  const histogram = buildHistogram(patchText);
  const entry: LedgerEntry = {
    id,
    patchFingerprint: fingerprint,
    addedSource: extractAddedSourceForLedger(patchText),
    histogramJson: histogramToJson(histogram),
    bundleId,
    verdict,
    storedAt: storedAtIso,
  };
  const path = join(handle.dir, `${id}.json`);
  writeFileSync(path, canonicalJson(entry), 'utf8');
  const next: LedgerHandle = {
    dir: handle.dir,
    entries: [...handle.entries.filter((e) => e.id !== id), entry].sort((a, b) =>
      a.storedAt.localeCompare(b.storedAt),
    ),
  };
  return { handle: next, entry };
}

/**
 * Reconstruct the in-memory histogram for an entry. Cheap because the
 * histogram is persisted; we never re-parse the source unless the JSON is
 * truncated or absent.
 *
 * @param entry Ledger entry.
 * @returns The deserialized {@link SyntaxHistogram}.
 */
export function entryHistogram(entry: LedgerEntry): SyntaxHistogram {
  return histogramFromJson(entry.histogramJson);
}

function coerceEntry(value: unknown): LedgerEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v['id'] !== 'string' ||
    typeof v['patchFingerprint'] !== 'string' ||
    typeof v['bundleId'] !== 'string' ||
    typeof v['verdict'] !== 'string' ||
    typeof v['storedAt'] !== 'string' ||
    typeof v['addedSource'] !== 'string' ||
    typeof v['histogramJson'] !== 'object' ||
    v['histogramJson'] === null
  ) {
    return null;
  }
  const verdict = v['verdict'];
  if (verdict !== 'approve' && verdict !== 'reject' && verdict !== 'request-changes') return null;
  const histogramJson = v['histogramJson'] as Record<string, unknown>;
  const cleaned: Record<string, number> = {};
  for (const [k, val] of Object.entries(histogramJson)) {
    if (typeof val === 'number') cleaned[k] = val;
  }
  return {
    id: v['id'],
    patchFingerprint: v['patchFingerprint'],
    addedSource: v['addedSource'],
    histogramJson: cleaned,
    bundleId: v['bundleId'],
    verdict,
    storedAt: v['storedAt'],
  };
}

/**
 * Local helper that mirrors {@link extractAddedSource} from `ast-diff.ts`
 * without re-running the parser. Inlined to avoid a circular import when this
 * file imports the AST helpers above.
 */
function extractAddedSourceForLedger(patchText: string): string {
  const lines = patchText.split('\n');
  const added: string[] = [];
  for (const line of lines) {
    if (line.startsWith('+++')) continue;
    if (line.startsWith('+')) added.push(line.slice(1));
  }
  return added.join('\n');
}
