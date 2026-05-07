import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sha256Hex } from './canonical.js';
import { runCourt } from './orchestrator.js';
import { writeSignedBundle } from './bundle-writer.js';
import { loadSignedBundle, replayBundle, verifyBundleSignature } from './bundle-replayer.js';
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

const PROSECUTION_RESPONSE = JSON.stringify({
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

const DEFENSE_RESPONSE = JSON.stringify({
  rebuttals: [{ exhibitId: 'p1', rebuttal: 'no justification', refutes: false, confidence: 0.2 }],
  summary: 'no defense',
});

const JURY_RESPONSE = JSON.stringify({
  verdict: 'reject',
  confidence: 0.95,
  rationale: 'clear regression',
  citedEvidenceIds: ['p1'],
  dissents: [],
});

function handle(params: LlmCallParams): string {
  if (params.model.startsWith('gemma4:e4b')) return PROSECUTION_RESPONSE;
  if (params.model.startsWith('gemma4:26b')) return DEFENSE_RESPONSE;
  if (params.model.startsWith('gemma4:31b')) return JURY_RESPONSE;
  throw new Error(`unhandled model: ${params.model}`);
}

const INPUTS = {
  fixture: 'unit-fixture',
  patch: '--- a\n+++ b\n',
  repoSnippet: 'snippet',
  repoHead: 'snippet',
  styleDocs: '# AGENTS\n',
  attachments: [] as readonly { name: string; base64: string }[],
};

async function buildBundle(): Promise<{
  bundleId: string;
  bundlePath: string;
  bundleDir: string;
  baseSeed: string;
}> {
  const llm = createStubLlmClient(handle);
  const ctx = createTestContext(llm, 'integration-seed');
  const { body } = await runCourt(INPUTS, {
    ctx,
    runtimeLock: RUNTIME_LOCK,
    baseSeed: 'integration-seed',
  });
  const bundleDir = mkdtempSync(join(tmpdir(), 'cc-bundles-'));
  const written = writeSignedBundle(body, 'integration-seed', bundleDir);
  return { bundleId: body.id, bundlePath: written.path, bundleDir, baseSeed: 'integration-seed' };
}

describe('bundle lifecycle integration', () => {
  it('round-trips run, write, load, and verify signature', async () => {
    const { bundlePath } = await buildBundle();
    const bundle = loadSignedBundle(bundlePath);
    expect(verifyBundleSignature(bundle).ok).toBe(true);
    expect(bundle.body.agents.prosecutor.output.exhibits[0]!.id).toBe('p1');
    expect(bundle.body.agents.jury.output.verdict).toBe('reject');
  });

  it('produces a bit-identical bundle on replay (stub-driven)', async () => {
    const { bundlePath, bundleId } = await buildBundle();
    const recordedBytes = readFileSync(bundlePath);
    const recordedSha = sha256Hex(recordedBytes);

    const llm = createStubLlmClient(handle);
    const ctx = createTestContext(llm, 'integration-seed');
    const bundle = loadSignedBundle(bundlePath);
    const report = await replayBundle({
      bundle,
      ctx,
      currentRuntimeLock: RUNTIME_LOCK,
    });
    expect(report.signatureOk).toBe(true);
    expect(report.runtimeDiffs).toEqual([]);
    expect(report.fullMatch).toBe(true);
    for (const m of report.agentMatches) {
      expect(m.match).toBe(true);
    }

    // Re-write to a fresh dir; bundle bytes should be byte-identical.
    const llm2 = createStubLlmClient(handle);
    const ctx2 = createTestContext(llm2, 'integration-seed');
    const { body: rerunBody } = await runCourt(INPUTS, {
      ctx: ctx2,
      runtimeLock: RUNTIME_LOCK,
      baseSeed: 'integration-seed',
    });
    const replayDir = mkdtempSync(join(tmpdir(), 'cc-bundles-'));
    const rerun = writeSignedBundle(rerunBody, 'integration-seed', replayDir);
    expect(rerun.bundle.body.id).toBe(bundleId);
    const replayedSha = sha256Hex(readFileSync(rerun.path));
    expect(replayedSha).toBe(recordedSha);
  });

  it('rejects a tampered exhibit during verify', async () => {
    const { bundlePath } = await buildBundle();
    const tampered = JSON.parse(readFileSync(bundlePath, 'utf8')) as Record<string, unknown>;
    const body = tampered['body'] as Record<string, unknown>;
    const agents = body['agents'] as Record<string, Record<string, Record<string, unknown>>>;
    const proseDossier = agents['prosecutor']!['output'] as Record<string, unknown>;
    proseDossier['summary'] = 'tampered summary';
    const tamperedPath = join(dirname(bundlePath), 'tampered.verdict');
    writeFileSync(tamperedPath, JSON.stringify(tampered), 'utf8');

    const tamperedBundle = loadSignedBundle(tamperedPath);
    const sig = verifyBundleSignature(tamperedBundle);
    expect(sig.ok).toBe(false);
    expect(sig.reason).toMatch(/tampered/);
  });

  it('refuses to replay when runtime lock drifts', async () => {
    const { bundlePath } = await buildBundle();
    const bundle = loadSignedBundle(bundlePath);
    const driftedLock: RuntimeLock = {
      ...RUNTIME_LOCK,
      ollama: { version: '0.99.0-fake' },
    };
    const llm = createStubLlmClient(handle);
    const ctx = createTestContext(llm, 'integration-seed');
    await expect(replayBundle({ bundle, ctx, currentRuntimeLock: driftedLock })).rejects.toThrow(
      /runtime drift detected/,
    );
  });

  it('downgrades runtime drift when tolerateRuntimeDrift is true', async () => {
    const { bundlePath } = await buildBundle();
    const bundle = loadSignedBundle(bundlePath);
    const driftedLock: RuntimeLock = {
      ...RUNTIME_LOCK,
      ollama: { version: '0.99.0-fake' },
    };
    const llm = createStubLlmClient(handle);
    const ctx = createTestContext(llm, 'integration-seed');
    const report = await replayBundle({
      bundle,
      ctx,
      currentRuntimeLock: driftedLock,
      tolerateRuntimeDrift: true,
    });
    expect(report.runtimeDiffs).toHaveLength(1);
    expect(report.fullMatch).toBe(false);
    expect(report.toleranceApplied).toBe(true);
  });

  it('reports per-agent mismatch when the LLM diverges', async () => {
    const { bundlePath } = await buildBundle();
    const bundle = loadSignedBundle(bundlePath);
    const divergentHandle = (params: LlmCallParams): string => {
      if (params.model.startsWith('gemma4:31b')) {
        return JSON.stringify({
          verdict: 'approve',
          confidence: 0.5,
          rationale: 'changed mind',
          citedEvidenceIds: [],
          dissents: [],
        });
      }
      return handle(params);
    };
    const llm = createStubLlmClient(divergentHandle);
    const ctx = createTestContext(llm, 'integration-seed');
    const report = await replayBundle({
      bundle,
      ctx,
      currentRuntimeLock: RUNTIME_LOCK,
    });
    const juryMatch = report.agentMatches.find((m) => m.agent === 'jury');
    expect(juryMatch?.match).toBe(false);
    expect(report.fullMatch).toBe(false);
  });
});
