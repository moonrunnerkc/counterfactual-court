/**
 * Aggregate `cache/real-entries.json` and `cache/poisoned-entries.json` into
 * the canonical `bench/manifest.json`. Re-validates every entry against the
 * zod schema, recomputes the patch hash from disk, and refuses to write a
 * manifest when any entry is malformed or missing on disk.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, sha256Hex } from '../../src/runtime/canonical.js';
import { Manifest, ManifestEntry, type Manifest as ManifestType } from '../manifest-schema.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const benchRoot = resolve(moduleDir, '..');

function loadEntries(name: string): ManifestEntry[] {
  const path = resolve(benchRoot, 'cache', name);
  if (!existsSync(path)) {
    throw new Error(`bench/build-manifest: missing ${path}; run the upstream script first`);
  }
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(raw)) {
    throw new Error(`bench/build-manifest: ${path} is not an array`);
  }
  return raw.map((entry, idx) => {
    const result = ManifestEntry.safeParse(entry);
    if (!result.success) {
      const issues = result.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ');
      throw new Error(`bench/build-manifest: ${path} entry ${idx} invalid (${issues})`);
    }
    return result.data;
  });
}

function verifyOnDisk(entry: ManifestEntry): void {
  const abs = resolve(benchRoot, entry.patchPath);
  if (!existsSync(abs)) {
    throw new Error(
      `bench/build-manifest: ${entry.patchPath} (${entry.id}) does not exist on disk`,
    );
  }
  const fileBytes = readFileSync(abs, 'utf8');
  const actualHash = sha256Hex(fileBytes);
  if (actualHash !== entry.patchHash) {
    throw new Error(
      `bench/build-manifest: hash mismatch for ${entry.id} (entry=${entry.patchHash}, file=${actualHash}); regenerate the patch`,
    );
  }
}

function main(generatedAtIso: string): void {
  const real = loadEntries('real-entries.json');
  const poisoned = loadEntries('poisoned-entries.json');
  const merged = [...real, ...poisoned];
  for (const entry of merged) verifyOnDisk(entry);

  const manifest: ManifestType = {
    schemaVersion: '1',
    generatedAt: generatedAtIso,
    entries: merged,
  };
  // Final round-trip through the top-level schema as a belt-and-braces check.
  Manifest.parse(manifest);

  const out = canonicalJson(manifest);
  writeFileSync(resolve(benchRoot, 'manifest.json'), `${out}\n`, 'utf8');
  process.stderr.write(
    `wrote bench/manifest.json (${real.length} real, ${poisoned.length} poisoned, ${merged.length} total)\n`,
  );
}

const argTimestamp = process.argv[2];
const ts =
  argTimestamp !== undefined && argTimestamp.length > 0 ? argTimestamp : '2026-05-07T22:00:00.000Z';
main(ts);
