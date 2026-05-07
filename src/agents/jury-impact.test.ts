import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { createStubLlmClient } from '../runtime/llm-client-stub.js';
import type { DefenseDossier, ProsecutionDossier, ReporterExhibits } from '../evidence/schema.js';
import type { RawJuryGraph } from '../evidence/graph.js';
import { buildImportGraph } from '../monorepo/import-graph.js';
import { computeRippleSet } from '../monorepo/impact-trace.js';
import {
  MONOREPO_CITATION_PREFIX,
  assertEveryRippleFileCited,
  findUncitedRippleFiles,
} from '../monorepo/citation-enforcement.js';
import { buildJuryPrompt, deliberate } from './jury.js';
import { createTestContext } from './test-context.js';

const FIXTURE_ROOT = resolve(__dirname, '..', '..', 'fixtures', 'multi-file');
const FILES = [
  'src/math.ts',
  'src/index.ts',
  'src/calculator.ts',
  'src/cli.ts',
  'src/unrelated.ts',
];

const PATCH = `--- a/src/math.ts
+++ b/src/math.ts
@@
-export const add = (a: number, b: number): number => a + b;
-export const sub = (a: number, b: number): number => a - b;
+export const add = (a: number, b: number): number => a - b;
+export const sub = (a: number, b: number): number => a + b;
`;

const PROSECUTION: ProsecutionDossier = {
  exhibits: [
    {
      id: 'p1',
      kind: 'logic-error',
      claim: 'add() and sub() are silently swapped',
      evidence: 'a - b',
      confidence: 0.99,
    },
  ],
  summary: 'Operator swap.',
};

const DEFENSE: DefenseDossier = {
  rebuttals: [
    {
      exhibitId: 'p1',
      rebuttal: 'No deliberate justification.',
      refutes: false,
      confidence: 0.2,
    },
  ],
  summary: 'No defense.',
};

const REPORTER_EXHIBITS: ReporterExhibits = { exhibits: [] };

function rippleAwareGraph(rippleFiles: readonly string[]): RawJuryGraph {
  return {
    exhibits: [
      {
        source: 'prosecution',
        label: 'p1',
        claim: 'add() and sub() are silently swapped',
        evidence: 'a - b',
        confidence: 0.99,
        kind: 'logic-error',
      },
    ],
    citations: rippleFiles.map((file, idx) => ({
      label: `c${idx + 1}`,
      reference: `${MONOREPO_CITATION_PREFIX}${file}`,
      excerpt: `Affected downstream file ${file}; the operator swap propagates here.`,
    })),
    testCases: [],
    precedents: [],
    verdict: {
      label: 'v1',
      verdict: 'reject',
      confidence: 0.95,
      summary: `Reject: operator swap propagates to ${rippleFiles.length} dependent file(s).`,
    },
    edges: [
      { from: 'p1', to: 'v1', relation: 'supports' },
      ...rippleFiles.map((_, idx) => ({
        from: `c${idx + 1}`,
        to: 'v1',
        relation: 'supports' as const,
      })),
    ],
    dissents: [],
  };
}

describe('Jury behavior on the multi-file fixture (Phase 2C)', () => {
  it('embeds the ripple set inside the prompt as structured JSON', () => {
    const graph = buildImportGraph(FIXTURE_ROOT, FILES);
    const rippleSet = computeRippleSet(graph, PATCH);
    const prompt = buildJuryPrompt({
      repoHead: '',
      patch: PATCH,
      prosecution: PROSECUTION,
      defense: DEFENSE,
      reporterExhibits: REPORTER_EXHIBITS,
      styleDocs: '',
      rippleSet,
    });
    expect(prompt).toContain('## Monorepo impact');
    expect(prompt).toContain('src/calculator.ts');
    expect(prompt).toContain('src/index.ts');
    expect(prompt).toContain('src/cli.ts');
    expect(prompt).not.toContain('src/unrelated.ts');
  });

  it('opinion cites every ripple file when the Jury produces ripple-aware graph', async () => {
    const graph = buildImportGraph(FIXTURE_ROOT, FILES);
    const rippleSet = computeRippleSet(graph, PATCH);
    const rippleFiles = rippleSet.entries.map((e) => e.file);

    const llm = createStubLlmClient(() => JSON.stringify(rippleAwareGraph(rippleFiles)));
    const ctx = createTestContext(llm, 'impact-seed', { features: { evidenceGraph: true } });
    const opinion = await deliberate({
      repoHead: '',
      patch: PATCH,
      prosecution: PROSECUTION,
      defense: DEFENSE,
      reporterExhibits: REPORTER_EXHIBITS,
      styleDocs: '',
      rippleSet,
      ctx,
    });

    expect(opinion.evidenceGraph).toBeDefined();
    expect(findUncitedRippleFiles(opinion.evidenceGraph!, rippleSet)).toEqual([]);
    expect(() => assertEveryRippleFileCited(opinion.evidenceGraph!, rippleSet)).not.toThrow();
  });

  it('flags missing ripple citations when the Jury ignores the impact', async () => {
    const graph = buildImportGraph(FIXTURE_ROOT, FILES);
    const rippleSet = computeRippleSet(graph, PATCH);
    // Stub returns a graph that does not cite any monorepo files.
    const noCiteGraph: RawJuryGraph = {
      exhibits: [
        {
          source: 'prosecution',
          label: 'p1',
          claim: 'op swap',
          evidence: 'a - b',
          confidence: 0.99,
          kind: 'logic-error',
        },
      ],
      citations: [],
      testCases: [],
      precedents: [],
      verdict: {
        label: 'v1',
        verdict: 'reject',
        confidence: 0.9,
        summary: 'reject',
      },
      edges: [{ from: 'p1', to: 'v1', relation: 'supports' }],
      dissents: [],
    };
    const llm = createStubLlmClient(() => JSON.stringify(noCiteGraph));
    const ctx = createTestContext(llm, 'impact-seed-2', { features: { evidenceGraph: true } });
    const opinion = await deliberate({
      repoHead: '',
      patch: PATCH,
      prosecution: PROSECUTION,
      defense: DEFENSE,
      reporterExhibits: REPORTER_EXHIBITS,
      styleDocs: '',
      rippleSet,
      ctx,
    });
    const missing = findUncitedRippleFiles(opinion.evidenceGraph!, rippleSet);
    expect(missing.length).toBeGreaterThan(0);
    expect(() => assertEveryRippleFileCited(opinion.evidenceGraph!, rippleSet)).toThrow(
      /ripple file/,
    );
  });
});
