import { describe, expect, it } from 'vitest';
import { createStubLlmClient } from '../runtime/llm-client-stub.js';
import type {
  DefenseDossier,
  JuryOpinion,
  ProsecutionDossier,
  ReporterExhibits,
} from '../evidence/schema.js';
import { deliberate, JURY_MODEL, buildJuryPrompt } from './jury.js';
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

const STUB_OPINION: JuryOpinion = {
  verdict: 'reject',
  confidence: 0.92,
  rationale: 'The diff inverts a documented operator without justification. Reject.',
  citedEvidenceIds: ['p1'],
  dissents: [],
};

describe('deliberate', () => {
  it('produces a zod-valid opinion from a fixture input', async () => {
    const llm = createStubLlmClient(() => JSON.stringify(STUB_OPINION));
    const ctx = createTestContext(llm);
    const opinion = await deliberate({
      repoHead: REPO_HEAD,
      patch: PATCH,
      prosecution: PROSECUTION,
      defense: DEFENSE,
      reporterExhibits: REPORTER_EXHIBITS,
      styleDocs: '# AGENTS\nfour agents...',
      ctx,
    });
    expect(opinion).toEqual(STUB_OPINION);
    expect(llm.calls[0]!.params.model).toBe(JURY_MODEL);
    expect(llm.calls[0]!.params.temperature).toBe(0);
  });

  it('produces identical results across two runs with the same seed', async () => {
    const handler = (): string => JSON.stringify(STUB_OPINION);
    const llmA = createStubLlmClient(handler);
    const llmB = createStubLlmClient(handler);
    const baseInput = {
      repoHead: REPO_HEAD,
      patch: PATCH,
      prosecution: PROSECUTION,
      defense: DEFENSE,
      reporterExhibits: REPORTER_EXHIBITS,
      styleDocs: '# AGENTS\nfour agents...',
    };
    const a = await deliberate({ ...baseInput, ctx: createTestContext(llmA, 'jury-seed') });
    const b = await deliberate({ ...baseInput, ctx: createTestContext(llmB, 'jury-seed') });
    expect(a).toEqual(b);
    expect(llmA.calls[0]!.result.promptHash).toBe(llmB.calls[0]!.result.promptHash);
  });

  it('rejects schema-invalid output with a typed error', async () => {
    const bad = {
      verdict: 'maybe',
      confidence: 0.5,
      rationale: '',
      citedEvidenceIds: [],
      dissents: [],
    };
    const llm = createStubLlmClient(() => JSON.stringify(bad));
    const ctx = createTestContext(llm);
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
    ).rejects.toThrow(/jury: model output failed schema validation/);
  });

  it('builds a prompt that embeds repo head, patch, both dossiers, and style docs', () => {
    const prompt = buildJuryPrompt({
      repoHead: REPO_HEAD,
      patch: PATCH,
      prosecution: PROSECUTION,
      defense: DEFENSE,
      reporterExhibits: REPORTER_EXHIBITS,
      styleDocs: '# AGENTS\nfour agents...',
    });
    expect(prompt).toContain(REPO_HEAD);
    expect(prompt).toContain(PATCH);
    expect(prompt).toContain('"id": "p1"');
    expect(prompt).toContain('# AGENTS');
    expect(prompt).toContain('JuryOpinion JSON');
  });
});
