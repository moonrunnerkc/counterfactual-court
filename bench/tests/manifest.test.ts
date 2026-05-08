import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Manifest, ManifestEntry, PermissiveLicense } from '../manifest-schema.js';
import { sha256Hex } from '../../src/runtime/canonical.js';

const benchRoot = resolve(__dirname, '..');
const manifestPath = resolve(benchRoot, 'manifest.json');

const manifestExists = existsSync(manifestPath);

describe.skipIf(!manifestExists)('bench manifest validation', () => {
  const raw = manifestExists ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;

  it('parses against the top-level zod schema', () => {
    expect(() => Manifest.parse(raw)).not.toThrow();
  });

  it('declares every entry with all required fields and a permissive license', () => {
    const manifest = Manifest.parse(raw);
    for (const entry of manifest.entries) {
      const result = ManifestEntry.safeParse(entry);
      expect(result.success).toBe(true);
      const lic = PermissiveLicense.safeParse(entry.license);
      expect(lic.success).toBe(true);
    }
  });

  it('every patch file exists on disk and matches its recorded sha-256', () => {
    const manifest = Manifest.parse(raw);
    for (const entry of manifest.entries) {
      const abs = resolve(benchRoot, entry.patchPath);
      expect(existsSync(abs)).toBe(true);
      const fileBytes = readFileSync(abs, 'utf8');
      expect(sha256Hex(fileBytes)).toBe(entry.patchHash);
    }
  });

  it('every poisoned entry has expectedVerdict=reject and a real source attribution', () => {
    const manifest = Manifest.parse(raw);
    const poisoned = manifest.entries.filter((e) => e.category !== 'real-merged');
    expect(poisoned.length).toBeGreaterThan(0);
    for (const entry of poisoned) {
      expect(entry.expectedVerdict).toBe('reject');
      expect(entry.source.kind).toBe('poisoned-from');
      expect(entry.source.reference.length).toBeGreaterThan(0);
    }
  });

  it('every real entry has expectedVerdict=approve and a github URL', () => {
    const manifest = Manifest.parse(raw);
    const real = manifest.entries.filter((e) => e.category === 'real-merged');
    expect(real.length).toBeGreaterThan(0);
    for (const entry of real) {
      expect(entry.expectedVerdict).toBe('approve');
      expect(entry.source.kind).toBe('real-pr');
      expect(entry.source.reference).toContain('github.com');
    }
  });

  it('exactly twenty patches per poisoned category (Phase 2F spec)', () => {
    const manifest = Manifest.parse(raw);
    const counts: Record<string, number> = {};
    for (const entry of manifest.entries) {
      counts[entry.category] = (counts[entry.category] ?? 0) + 1;
    }
    expect(counts['logic-error']).toBe(20);
    expect(counts['security-vulnerability']).toBe(20);
    expect(counts['test-weakening']).toBe(20);
    expect(counts['prompt-injection']).toBe(20);
    expect(counts['license-laundering']).toBe(20);
  });
});
