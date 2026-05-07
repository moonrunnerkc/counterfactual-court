import { describe, expect, it } from 'vitest';
import { createStubLlmClient } from '../runtime/llm-client-stub.js';
import type { DefenseDossier, ProsecutionDossier, ReporterExhibits } from '../evidence/schema.js';
import type { RawJuryGraph } from '../evidence/graph.js';
import { deliberate } from './jury.js';
import { createTestContext } from './test-context.js';

const REPO_HEAD = 'export const add = (a: number, b: number) => a + b;\n';
const PATCH = `--- a/src/util.ts\n+++ b/src/util.ts\n@@\n-export const add = (a: number, b: number) => a + b;\n+export const add = (a: number, b: number) => a - b;\n`;

const PROSECUTION: ProsecutionDossier = {
  exhibits: [
    {
      id: 'p1',
      kind: 'logic-error',
      claim: 'add() now subtracts',
      evidence: 'a - b',
      confidence: 0.99,
    },
  ],
  summary: 'The patch inverts the operator.',
};

const DEFENSE: DefenseDossier = {
  rebuttals: [
    {
      exhibitId: 'p1',
      rebuttal: 'Author may have intended subtraction.',
      refutes: false,
      confidence: 0.4,
    },
  ],
  summary: 'Likely correct allegation.',
};

const REPORTER_EXHIBITS: ReporterExhibits = { exhibits: [] };

function rawGraph(): RawJuryGraph {
  return {
    exhibits: [
      {
        source: 'prosecution',
        label: 'p1',
        claim: 'add() now subtracts',
        evidence: 'a - b',
        confidence: 0.99,
        kind: 'logic-error',
      },
    ],
    citations: [
      {
        label: 'c1',
        reference: 'STYLE_GUIDE.md#operators',
        excerpt: 'Arithmetic operators must match prior contracts.',
      },
    ],
    testCases: [],
    precedents: [],
    verdict: {
      label: 'v1',
      verdict: 'reject',
      confidence: 0.92,
      summary: 'Operator inversion breaks the documented contract.',
    },
    edges: [
      { from: 'p1', to: 'v1', relation: 'supports' },
      { from: 'c1', to: 'v1', relation: 'depends-on' },
    ],
    dissents: [],
  };
}

describe('deliberate (graph mode)', () => {
  it('parses a raw graph response and returns a graph-derived opinion', async () => {
    const llm = createStubLlmClient(() => JSON.stringify(rawGraph()));
    const ctx = createTestContext(llm, 'graph-seed', { features: { evidenceGraph: true } });
    const opinion = await deliberate({
      repoHead: REPO_HEAD,
      patch: PATCH,
      prosecution: PROSECUTION,
      defense: DEFENSE,
      reporterExhibits: REPORTER_EXHIBITS,
      styleDocs: '# AGENTS.md\nrules...',
      ctx,
    });
    expect(opinion.verdict).toBe('reject');
    expect(opinion.confidence).toBeCloseTo(0.92);
    expect(opinion.evidenceGraph).toBeDefined();
    expect(opinion.evidenceGraph!.nodes).toHaveLength(3);
    expect(opinion.evidenceGraph!.edges).toHaveLength(2);
    expect(opinion.rationale).toContain('Operator inversion');
  });

  it('rejects malformed graph output with an actionable error', async () => {
    const llm = createStubLlmClient(() => '{ "exhibits": [], "verdict": {} }');
    const ctx = createTestContext(llm, 'graph-seed', { features: { evidenceGraph: true } });
    await expect(
      deliberate({
        repoHead: REPO_HEAD,
        patch: PATCH,
        prosecution: PROSECUTION,
        defense: DEFENSE,
        reporterExhibits: REPORTER_EXHIBITS,
        styleDocs: '',
        ctx,
      }),
    ).rejects.toThrow(/raw jury graph failed schema validation/);
  });

  it('produces identical output across two runs with the same seed', async () => {
    const llmA = createStubLlmClient(() => JSON.stringify(rawGraph()));
    const llmB = createStubLlmClient(() => JSON.stringify(rawGraph()));
    const ctxA = createTestContext(llmA, 'jury-graph-seed', {
      features: { evidenceGraph: true },
    });
    const ctxB = createTestContext(llmB, 'jury-graph-seed', {
      features: { evidenceGraph: true },
    });
    const a = await deliberate({
      repoHead: REPO_HEAD,
      patch: PATCH,
      prosecution: PROSECUTION,
      defense: DEFENSE,
      reporterExhibits: REPORTER_EXHIBITS,
      styleDocs: '',
      ctx: ctxA,
    });
    const b = await deliberate({
      repoHead: REPO_HEAD,
      patch: PATCH,
      prosecution: PROSECUTION,
      defense: DEFENSE,
      reporterExhibits: REPORTER_EXHIBITS,
      styleDocs: '',
      ctx: ctxB,
    });
    expect(a).toEqual(b);
  });
});
