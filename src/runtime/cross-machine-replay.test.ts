import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadSignedBundle, replayBundle } from './bundle-replayer.js';
import { createStubLlmClient } from './llm-client-stub.js';
import { createTestContext } from '../agents/test-context.js';
import type { LlmCallParams } from './llm-client.js';
import type { RuntimeLock } from './runtime-lock.js';

const FIXTURE_PATH = resolve(__dirname, '..', '..', 'test-fixtures', 'replay-fixture.verdict');

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
  throw new Error(`unhandled model: ${params.model}`);
}

const fixtureExists = existsSync(FIXTURE_PATH);

describe.skipIf(!fixtureExists)('cross-machine replay (Phase 2G)', () => {
  it('replays the committed test-fixtures/replay-fixture.verdict bit-identical under tolerance=0', async () => {
    const bundle = loadSignedBundle(FIXTURE_PATH);
    const llm = createStubLlmClient(handle);
    const ctx = createTestContext(llm, bundle.body.baseSeed);
    const report = await replayBundle({
      bundle,
      ctx,
      currentRuntimeLock: RUNTIME_LOCK,
      tolerance: 0,
    });
    expect(report.fullMatch).toBe(true);
    expect(report.observedDivergenceFraction).toBe(0);
    for (const m of report.agentMatches) {
      expect(m.match).toBe(true);
    }
  });

  it('the committed fixture file is canonical JSON of a SignedBundle envelope', () => {
    const raw = readFileSync(FIXTURE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.body).toBeDefined();
    expect(parsed.signature).toBeDefined();
    expect(parsed.signature.alg).toBe('Ed25519');
    expect(parsed.body.id).toMatch(/^[0-9a-f]{64}$/);
  });
});
