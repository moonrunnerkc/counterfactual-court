import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Manifest } from '../manifest-schema.js';
import { runOne as runCourtOne } from '../scripts/run-court.js';
import { createStubLlmClient } from '../../src/runtime/llm-client-stub.js';
import type { LlmCallParams } from '../../src/runtime/llm-client.js';

const benchRoot = resolve(__dirname, '..');
const manifestPath = resolve(benchRoot, 'manifest.json');

const manifestExists = existsSync(manifestPath);

const PROSECUTION = JSON.stringify({
  exhibits: [
    {
      id: 'p1',
      kind: 'logic-error',
      claim: 'placeholder',
      evidence: 'a',
      confidence: 0.5,
    },
  ],
  summary: 'smoke',
});
const DEFENSE = JSON.stringify({
  rebuttals: [{ exhibitId: 'p1', rebuttal: 'placeholder', refutes: false, confidence: 0.5 }],
  summary: 'smoke',
});
const RAW_GRAPH = JSON.stringify({
  exhibits: [
    {
      source: 'prosecution',
      label: 'p1',
      claim: 'placeholder',
      evidence: 'a',
      confidence: 0.5,
      kind: 'logic-error',
    },
  ],
  citations: [],
  testCases: [],
  precedents: [],
  verdict: { label: 'v1', verdict: 'reject', confidence: 0.5, summary: 'smoke verdict' },
  edges: [{ from: 'p1', to: 'v1', relation: 'supports' }],
  dissents: [],
});

function smokeHandle(params: LlmCallParams): string {
  const sys = params.system ?? '';
  if (sys.includes('You are the Prosecutor')) return PROSECUTION;
  if (sys.includes('You are the Defender')) return DEFENSE;
  if (sys.includes('You are the Jury')) return RAW_GRAPH;
  throw new Error(`smoke: unhandled role for model ${params.model}`);
}

describe.skipIf(!manifestExists)('bench smoke (10-patch subset, stub LLM)', () => {
  it('runs end-to-end on 5 real + 5 poisoned patches without throwing', async () => {
    const manifest = Manifest.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
    const real = manifest.entries.filter((e) => e.category === 'real-merged').slice(0, 5);
    const categories = [
      'logic-error',
      'security-vulnerability',
      'test-weakening',
      'prompt-injection',
      'license-laundering',
    ] as const;
    const poisonedSubset = categories
      .map((cat) => manifest.entries.find((e) => e.category === cat))
      .filter((e): e is NonNullable<typeof e> => e !== undefined);
    const subset = [...real, ...poisonedSubset];
    expect(subset.length).toBe(10);

    const llm = createStubLlmClient(smokeHandle);
    const rows: { id: string; observedVerdict: string }[] = [];
    for (const entry of subset) {
      const row = await runCourtOne(entry, llm);
      expect(row.error).toBe(null);
      rows.push({ id: row.id, observedVerdict: row.observedVerdict });
    }
    expect(rows).toHaveLength(10);
    for (const row of rows) {
      expect(['approve', 'reject', 'request-changes']).toContain(row.observedVerdict);
    }
  }, 60_000);
});
