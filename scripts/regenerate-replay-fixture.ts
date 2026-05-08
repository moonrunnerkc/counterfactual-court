/**
 * Regenerate the cross-machine replay fixture committed under
 * `test-fixtures/replay-fixture.verdict`. Uses the deterministic stub LLM
 * with canned per-agent responses so the bundle is reproducible byte-for-byte
 * on any machine that runs this script. Phase 2G CI test loads the committed
 * bundle and replays it under the same stub to verify the replay code path
 * survives a cross-machine round trip.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { canonicalJson } from '../src/runtime/canonical.js';
import { createStubLlmClient } from '../src/runtime/llm-client-stub.js';
import { runCourt } from '../src/runtime/orchestrator.js';
import { signBundle } from '../src/runtime/bundle-writer.js';
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
const JURY = JSON.stringify({
  verdict: 'reject',
  confidence: 0.95,
  rationale: 'clear regression',
  citedEvidenceIds: ['p1'],
  dissents: [],
});

function handle(params: LlmCallParams): string {
  if (params.model.startsWith('gemma4:e4b')) return PROSECUTION;
  if (params.model.startsWith('gemma4:26b')) return DEFENSE;
  if (params.model.startsWith('gemma4:31b')) return JURY;
  throw new Error(`replay-fixture: unhandled model ${params.model}`);
}

async function main(): Promise<void> {
  const llm = createStubLlmClient(handle);
  const ctx = createTestContext(llm, 'phase-2g-cross-machine');
  const { body } = await runCourt(
    {
      fixture: 'phase-2g-cross-machine',
      patch:
        '--- a/src/util.ts\n+++ b/src/util.ts\n@@\n-export const add = (a: number, b: number) => a + b;\n+export const add = (a: number, b: number) => a - b;\n',
      repoSnippet: 'export const add = (a: number, b: number) => a + b;\n',
      repoHead: 'export const add = (a: number, b: number) => a + b;\n',
      styleDocs: '# AGENTS\n',
      attachments: [],
    },
    { ctx, runtimeLock: RUNTIME_LOCK, baseSeed: 'phase-2g-cross-machine' },
  );
  const { bundle } = signBundle(body, 'phase-2g-cross-machine');
  const out = resolve('test-fixtures', 'replay-fixture.verdict');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, canonicalJson(bundle), 'utf8');
  process.stderr.write(`wrote ${out} (id=${body.id})\n`);
}

await main();
