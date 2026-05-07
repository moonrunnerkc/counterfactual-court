import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffRuntimeLocks, loadRuntimeLock, type RuntimeLock } from './runtime-lock.js';

const VALID: RuntimeLock = {
  ollama: { version: '0.23.1' },
  node: { version: '24.15.0' },
  models: {
    'gemma4:e4b-it-q8_0': {
      digest: 'sha256:9dcc35808b42e8975f1e9dd9d7866925a8d0704b6bb3613525323f355dde3923',
    },
  },
  generatedAt: '2026-05-07T20:16:53.884Z',
};

function writeLock(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-lock-'));
  const path = join(dir, 'runtime.lock.json');
  writeFileSync(path, JSON.stringify(content), 'utf8');
  return path;
}

describe('loadRuntimeLock', () => {
  it('parses a valid lock file', () => {
    const path = writeLock(VALID);
    expect(loadRuntimeLock(path)).toEqual(VALID);
  });

  it('rejects malformed digests', () => {
    const path = writeLock({
      ...VALID,
      models: { 'gemma4:e4b-it-q8_0': { digest: 'not-a-digest' } },
    });
    expect(() => loadRuntimeLock(path)).toThrow(/runtime-lock/);
  });

  it('reports the path on a missing file', () => {
    expect(() => loadRuntimeLock('/no/such/runtime.lock.json')).toThrow(
      /runtime-lock: failed to read/,
    );
  });
});

describe('diffRuntimeLocks', () => {
  it('returns an empty list when locks are identical', () => {
    expect(diffRuntimeLocks(VALID, VALID)).toEqual([]);
  });

  it('flags ollama version drift', () => {
    const drifted: RuntimeLock = { ...VALID, ollama: { version: '0.24.0' } };
    const diffs = diffRuntimeLocks(VALID, drifted);
    expect(diffs).toEqual(['ollama version: bundle 0.23.1 vs current 0.24.0']);
  });

  it('flags model digest drift', () => {
    const drifted: RuntimeLock = {
      ...VALID,
      models: {
        'gemma4:e4b-it-q8_0': {
          digest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        },
      },
    };
    const diffs = diffRuntimeLocks(VALID, drifted);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain('gemma4:e4b-it-q8_0');
  });
});
