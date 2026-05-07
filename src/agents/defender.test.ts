import { describe, expect, it } from 'vitest';
import { createStubLlmClient } from '../runtime/llm-client-stub.js';
import type { DefenseDossier, ProsecutionDossier } from '../evidence/schema.js';
import { defend, DEFENDER_MODEL, buildDefenderPrompt } from './defender.js';
import { createTestContext } from './test-context.js';

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

const STUB_DEFENSE: DefenseDossier = {
  rebuttals: [
    {
      exhibitId: 'p1',
      rebuttal:
        'The author may have intended subtraction; verify with the issue tracker before rejecting.',
      refutes: false,
      confidence: 0.4,
    },
  ],
  summary: 'The exhibit is likely correct but missing context.',
};

describe('defend', () => {
  it('produces a zod-valid dossier from a fixture input', async () => {
    const llm = createStubLlmClient(() => JSON.stringify(STUB_DEFENSE));
    const ctx = createTestContext(llm);
    const defense = await defend({ patch: PATCH, dossier: PROSECUTION, ctx });
    expect(defense).toEqual(STUB_DEFENSE);
    expect(llm.calls[0]!.params.model).toBe(DEFENDER_MODEL);
    expect(llm.calls[0]!.params.temperature).toBe(0);
  });

  it('produces identical results across two runs with the same seed', async () => {
    const handler = (): string => JSON.stringify(STUB_DEFENSE);
    const llmA = createStubLlmClient(handler);
    const llmB = createStubLlmClient(handler);
    const a = await defend({
      patch: PATCH,
      dossier: PROSECUTION,
      ctx: createTestContext(llmA, 'defender-seed'),
    });
    const b = await defend({
      patch: PATCH,
      dossier: PROSECUTION,
      ctx: createTestContext(llmB, 'defender-seed'),
    });
    expect(a).toEqual(b);
    expect(llmA.calls[0]!.result.promptHash).toBe(llmB.calls[0]!.result.promptHash);
  });

  it('rejects schema-invalid output with a typed error', async () => {
    const bad = {
      rebuttals: [{ exhibitId: 'p1', rebuttal: 'ok', refutes: 'maybe', confidence: 0.5 }],
      summary: 'x',
    };
    const llm = createStubLlmClient(() => JSON.stringify(bad));
    const ctx = createTestContext(llm);
    await expect(defend({ patch: PATCH, dossier: PROSECUTION, ctx })).rejects.toThrow(
      /defender: model output failed schema validation/,
    );
  });

  it('builds a prompt that embeds the dossier JSON', () => {
    const prompt = buildDefenderPrompt(PATCH, PROSECUTION);
    expect(prompt).toContain(PATCH);
    expect(prompt).toContain('"id": "p1"');
    expect(prompt).toContain('DefenseDossier JSON');
  });
});
