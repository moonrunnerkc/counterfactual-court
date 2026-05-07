import { describe, expect, it } from 'vitest';
import { createStubLlmClient } from '../runtime/llm-client-stub.js';
import type { ProsecutionDossier } from '../evidence/schema.js';
import { prosecute, PROSECUTOR_MODEL, buildProsecutorPrompt } from './prosecutor.js';
import { createTestContext } from './test-context.js';

const PATCH = `--- a/src/util.ts\n+++ b/src/util.ts\n@@\n-export const add = (a: number, b: number) => a + b;\n+export const add = (a: number, b: number) => a - b;\n`;
const REPO_SNIPPET = `// src/util.ts (HEAD)\nexport const add = (a: number, b: number) => a + b;\n`;

const STUB_DOSSIER: ProsecutionDossier = {
  exhibits: [
    {
      id: 'p1',
      kind: 'logic-error',
      claim: 'add() now subtracts instead of summing',
      evidence: 'export const add = (a: number, b: number) => a - b;',
      confidence: 0.99,
    },
  ],
  summary: 'The patch silently inverts the add operator.',
};

describe('prosecute', () => {
  it('produces a zod-valid dossier from a fixture input', async () => {
    const llm = createStubLlmClient(() => JSON.stringify(STUB_DOSSIER));
    const ctx = createTestContext(llm);
    const dossier = await prosecute({ patch: PATCH, repoSnippet: REPO_SNIPPET, ctx });
    expect(dossier).toEqual(STUB_DOSSIER);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.params.model).toBe(PROSECUTOR_MODEL);
    expect(llm.calls[0]!.params.temperature).toBe(0);
    expect(llm.calls[0]!.params.topK).toBe(40);
    expect(llm.calls[0]!.params.topP).toBe(0.95);
  });

  it('produces identical results across two runs with the same seed', async () => {
    const handler = (): string => JSON.stringify(STUB_DOSSIER);
    const llmA = createStubLlmClient(handler);
    const llmB = createStubLlmClient(handler);
    const ctxA = createTestContext(llmA, 'fixed-seed');
    const ctxB = createTestContext(llmB, 'fixed-seed');
    const a = await prosecute({ patch: PATCH, repoSnippet: REPO_SNIPPET, ctx: ctxA });
    const b = await prosecute({ patch: PATCH, repoSnippet: REPO_SNIPPET, ctx: ctxB });
    expect(a).toEqual(b);
    expect(llmA.calls[0]!.params.seed).toBe(llmB.calls[0]!.params.seed);
    expect(llmA.calls[0]!.result.promptHash).toBe(llmB.calls[0]!.result.promptHash);
  });

  it('rejects malformed JSON with a typed error', async () => {
    const llm = createStubLlmClient(() => 'not json at all');
    const ctx = createTestContext(llm);
    await expect(prosecute({ patch: PATCH, repoSnippet: REPO_SNIPPET, ctx })).rejects.toThrow(
      /prosecutor: model output is not valid JSON/,
    );
  });

  it('rejects schema-invalid output with a typed error naming the field', async () => {
    const bad = {
      exhibits: [{ id: 'p1', kind: 'logic-error', claim: '', evidence: 'x', confidence: 1.5 }],
      summary: '',
    };
    const llm = createStubLlmClient(() => JSON.stringify(bad));
    const ctx = createTestContext(llm);
    await expect(prosecute({ patch: PATCH, repoSnippet: REPO_SNIPPET, ctx })).rejects.toThrow(
      /prosecutor: model output failed schema validation/,
    );
  });

  it('strips a Markdown code fence around the JSON payload', async () => {
    const llm = createStubLlmClient(() => '```json\n' + JSON.stringify(STUB_DOSSIER) + '\n```');
    const ctx = createTestContext(llm);
    const dossier = await prosecute({ patch: PATCH, repoSnippet: REPO_SNIPPET, ctx });
    expect(dossier).toEqual(STUB_DOSSIER);
  });

  it('builds a stable prompt that includes the patch and snippet', () => {
    const prompt = buildProsecutorPrompt(PATCH, REPO_SNIPPET);
    expect(prompt).toContain(PATCH);
    expect(prompt).toContain(REPO_SNIPPET);
    expect(prompt).toContain('ProsecutionDossier JSON');
  });
});
