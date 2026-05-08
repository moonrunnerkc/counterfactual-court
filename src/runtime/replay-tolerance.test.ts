import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCourt } from './orchestrator.js';
import { writeSignedBundle } from './bundle-writer.js';
import { loadSignedBundle, renderDigestMismatchError, replayBundle } from './bundle-replayer.js';
import type { RuntimeLock } from './runtime-lock.js';
import type { LlmCallParams } from './llm-client.js';
import { createStubLlmClient } from './llm-client-stub.js';
import { createTestContext } from '../agents/test-context.js';

const RUNTIME_LOCK: RuntimeLock = {
  ollama: { version: '0.23.1' },
  node: { version: '24.15.0' },
  models: {
    'gemma4:e4b-it-q8_0': {
      digest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    },
    'gemma4:26b-a4b-it-q8_0': {
      digest: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    },
    'gemma4:31b-it-q8_0': {
      digest: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
    },
  },
  generatedAt: '2026-05-07T20:00:00.000Z',
};

const PROSECUTION = JSON.stringify({
  exhibits: [
    {
      id: 'p1',
      kind: 'logic-error',
      claim: 'add() now subtracts',
      evidence: 'a - b',
      confidence: 0.9,
    },
  ],
  summary: 'inverted op',
});

const DEFENSE = JSON.stringify({
  rebuttals: [{ exhibitId: 'p1', rebuttal: 'no justification', refutes: false, confidence: 0.2 }],
  summary: 'no defense',
});

const JURY = JSON.stringify({
  verdict: 'reject',
  confidence: 0.95,
  rationale: 'clear regression',
  citedEvidenceIds: ['p1'],
  dissents: [],
});

function baselineHandle(params: LlmCallParams): string {
  const sys = params.system ?? '';
  if (sys.includes('You are the Prosecutor')) return PROSECUTION;
  if (sys.includes('You are the Defender')) return DEFENSE;
  if (sys.includes('You are the Jury')) return JURY;
  throw new Error(`unhandled role for model: ${params.model}`);
}

const INPUTS = {
  fixture: 'tolerance-fixture',
  patch: '--- a\n+++ b\n',
  repoSnippet: 'snippet',
  repoHead: 'snippet',
  styleDocs: '# AGENTS\n',
  attachments: [] as readonly { name: string; base64: string }[],
};

async function buildBaselineBundle(): Promise<string> {
  const llm = createStubLlmClient(baselineHandle);
  const ctx = createTestContext(llm, 'tolerance-seed');
  const { body } = await runCourt(INPUTS, {
    ctx,
    runtimeLock: RUNTIME_LOCK,
    baseSeed: 'tolerance-seed',
  });
  const bundleDir = mkdtempSync(join(tmpdir(), 'cc-tol-'));
  return writeSignedBundle(body, 'tolerance-seed', bundleDir).path;
}

describe('replay tolerance and loud failure (Phase 2G)', () => {
  it('strict replay (tolerance=0) reports bit-identical when nothing diverges', async () => {
    const bundlePath = await buildBaselineBundle();
    const llm = createStubLlmClient(baselineHandle);
    const ctx = createTestContext(llm, 'tolerance-seed');
    const report = await replayBundle({
      bundle: loadSignedBundle(bundlePath),
      ctx,
      currentRuntimeLock: RUNTIME_LOCK,
      tolerance: 0,
    });
    expect(report.fullMatch).toBe(true);
    expect(report.observedDivergenceFraction).toBe(0);
    expect(renderDigestMismatchError(report)).toBe('');
  });

  it('strict replay flips fullMatch=false when one agent diverges', async () => {
    const bundlePath = await buildBaselineBundle();
    const divergent = (params: LlmCallParams): string => {
      if (params.model.startsWith('gemma4:31b')) {
        return JSON.stringify({
          verdict: 'approve',
          confidence: 0.5,
          rationale: 'changed mind',
          citedEvidenceIds: [],
          dissents: [],
        });
      }
      return baselineHandle(params);
    };
    const llm = createStubLlmClient(divergent);
    const ctx = createTestContext(llm, 'tolerance-seed');
    const report = await replayBundle({
      bundle: loadSignedBundle(bundlePath),
      ctx,
      currentRuntimeLock: RUNTIME_LOCK,
      tolerance: 0,
    });
    expect(report.fullMatch).toBe(false);
    expect(report.observedDivergenceFraction).toBeCloseTo(0.25, 6);
  });

  it('numeric tolerance lets the same divergence pass when set above the observed fraction', async () => {
    const bundlePath = await buildBaselineBundle();
    const divergent = (params: LlmCallParams): string => {
      if (params.model.startsWith('gemma4:31b')) {
        return JSON.stringify({
          verdict: 'approve',
          confidence: 0.5,
          rationale: 'changed mind',
          citedEvidenceIds: [],
          dissents: [],
        });
      }
      return baselineHandle(params);
    };
    const llm = createStubLlmClient(divergent);
    const ctx = createTestContext(llm, 'tolerance-seed');
    const report = await replayBundle({
      bundle: loadSignedBundle(bundlePath),
      ctx,
      currentRuntimeLock: RUNTIME_LOCK,
      tolerance: 0.5,
    });
    expect(report.fullMatch).toBe(true);
    expect(report.toleranceApplied).toBe(true);
  });

  it('renderDigestMismatchError produces an actionable error naming the divergent agent and hashes', async () => {
    const bundlePath = await buildBaselineBundle();
    const divergent = (params: LlmCallParams): string => {
      if (params.model.startsWith('gemma4:31b')) {
        return JSON.stringify({
          verdict: 'approve',
          confidence: 0.5,
          rationale: 'changed mind',
          citedEvidenceIds: [],
          dissents: [],
        });
      }
      return baselineHandle(params);
    };
    const llm = createStubLlmClient(divergent);
    const ctx = createTestContext(llm, 'tolerance-seed');
    const report = await replayBundle({
      bundle: loadSignedBundle(bundlePath),
      ctx,
      currentRuntimeLock: RUNTIME_LOCK,
      tolerance: 0,
    });
    const msg = renderDigestMismatchError(report);
    expect(msg).toContain('digest mismatch');
    expect(msg).toContain('jury');
    expect(msg).toMatch(/recorded=[0-9a-f]{64}/);
    expect(msg).toMatch(/replay=[0-9a-f]{64}/);
    expect(msg).toContain('tolerance');
  });

  it('numeric tolerance below observed divergence still fails (loud-error path)', async () => {
    const bundlePath = await buildBaselineBundle();
    const divergent = (params: LlmCallParams): string => {
      if (params.model.startsWith('gemma4:31b')) {
        return JSON.stringify({
          verdict: 'approve',
          confidence: 0.5,
          rationale: 'changed mind',
          citedEvidenceIds: [],
          dissents: [],
        });
      }
      return baselineHandle(params);
    };
    const llm = createStubLlmClient(divergent);
    const ctx = createTestContext(llm, 'tolerance-seed');
    const report = await replayBundle({
      bundle: loadSignedBundle(bundlePath),
      ctx,
      currentRuntimeLock: RUNTIME_LOCK,
      tolerance: 0.1, // below observed 0.25
    });
    expect(report.fullMatch).toBe(false);
    expect(renderDigestMismatchError(report).length).toBeGreaterThan(0);
  });

  it('also tolerates the bundle being on disk (round-trip)', async () => {
    const bundlePath = await buildBaselineBundle();
    const reload = JSON.parse(readFileSync(bundlePath, 'utf8'));
    expect(reload.body.id).toBeDefined();
    // Sanity: write a copy so the test exercises the I/O.
    const copy = bundlePath + '.copy';
    writeFileSync(copy, JSON.stringify(reload), 'utf8');
    expect(readFileSync(copy, 'utf8').length).toBe(JSON.stringify(reload).length);
  });
});
