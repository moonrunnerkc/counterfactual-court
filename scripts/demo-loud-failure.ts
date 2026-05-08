/**
 * Phase 2G evidence script. Builds a baseline bundle via the deterministic
 * stub LLM, then replays it under a divergent stub so the Jury response
 * differs from the recorded one. Prints the loud-failure error the CLI
 * surfaces on stderr so the runtime-variance.md sample stays in sync with
 * the actual rendered text.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCourt } from '../src/runtime/orchestrator.js';
import { signBundle } from '../src/runtime/bundle-writer.js';
import {
  renderDigestMismatchError,
  replayBundle,
  type ReplayReport,
} from '../src/runtime/bundle-replayer.js';
import { createStubLlmClient } from '../src/runtime/llm-client-stub.js';
import { createTestContext } from '../src/agents/test-context.js';
import type { LlmCallParams } from '../src/runtime/llm-client.js';
import type { RuntimeLock } from '../src/runtime/runtime-lock.js';

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
const JURY_BASELINE = JSON.stringify({
  verdict: 'reject',
  confidence: 0.95,
  rationale: 'clear regression',
  citedEvidenceIds: ['p1'],
  dissents: [],
});
const JURY_DIVERGENT = JSON.stringify({
  verdict: 'approve',
  confidence: 0.5,
  rationale: 'changed mind on replay',
  citedEvidenceIds: [],
  dissents: [],
});

function baselineHandle(params: LlmCallParams): string {
  const sys = params.system ?? '';
  if (sys.includes('You are the Prosecutor')) return PROSECUTION;
  if (sys.includes('You are the Defender')) return DEFENSE;
  if (sys.includes('You are the Jury')) return JURY_BASELINE;
  throw new Error(`unhandled role for model: ${params.model}`);
}
function divergentHandle(params: LlmCallParams): string {
  const sys = params.system ?? '';
  if (sys.includes('You are the Jury')) return JURY_DIVERGENT;
  return baselineHandle(params);
}

async function main(): Promise<void> {
  const llm = createStubLlmClient(baselineHandle);
  const ctx = createTestContext(llm, 'demo-loud');
  const { body } = await runCourt(
    {
      fixture: 'demo-loud-failure',
      patch: '--- a\n+++ b\n',
      repoSnippet: 'snippet',
      repoHead: 'snippet',
      styleDocs: '# AGENTS\n',
      attachments: [],
    },
    { ctx, runtimeLock: RUNTIME_LOCK, baseSeed: 'demo-loud' },
  );
  const { bundle } = signBundle(body, 'demo-loud');

  const llm2 = createStubLlmClient(divergentHandle);
  const ctx2 = createTestContext(llm2, 'demo-loud');
  const report: ReplayReport = await replayBundle({
    bundle,
    ctx: ctx2,
    currentRuntimeLock: RUNTIME_LOCK,
    tolerance: 0,
  });

  process.stdout.write(`fullMatch: ${report.fullMatch}\n`);
  process.stdout.write(
    `observed divergence fraction: ${report.observedDivergenceFraction.toFixed(3)}\n`,
  );
  process.stdout.write(`tolerance: ${(report.tolerance ?? 0).toFixed(3)}\n`);
  process.stdout.write('--- loud failure stderr ---\n');
  process.stderr.write(renderDigestMismatchError(report) + '\n');
  process.stdout.write('--- end ---\n');

  // Write to a temp dir to verify on-disk handling does not change the output.
  void mkdtempSync(join(tmpdir(), 'cc-demo-'));
}

await main();
