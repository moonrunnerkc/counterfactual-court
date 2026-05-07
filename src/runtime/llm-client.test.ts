import { describe, expect, it } from 'vitest';
import { sha256Hex } from './canonical.js';
import { computePromptHash, validateLlmCallParams, type LlmCallParams } from './llm-client.js';
import { createStubLlmClient } from './llm-client-stub.js';

const VALID: LlmCallParams = {
  model: 'gemma4:e4b-it-q8_0',
  prompt: 'hello',
  temperature: 0,
  topP: 0.9,
  topK: 40,
  seed: 42,
};

function withoutKey(key: keyof LlmCallParams): LlmCallParams {
  const copy: Record<string, unknown> = { ...VALID };
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete copy[key];
  return copy as unknown as LlmCallParams;
}

describe('validateLlmCallParams', () => {
  it('accepts a fully-specified params object', () => {
    expect(() => validateLlmCallParams(VALID)).not.toThrow();
  });

  it('rejects a params object missing the seed field', () => {
    expect(() => validateLlmCallParams(withoutKey('seed'))).toThrow(/seed/);
  });

  it.each(['temperature', 'topP', 'topK'] as const)('rejects missing %s', (key) => {
    expect(() => validateLlmCallParams(withoutKey(key))).toThrow(new RegExp(key));
  });

  it('rejects an empty model tag', () => {
    expect(() => validateLlmCallParams({ ...VALID, model: '' })).toThrow(/model/);
  });

  it('rejects a non-finite temperature', () => {
    expect(() =>
      validateLlmCallParams({ ...VALID, temperature: Number.POSITIVE_INFINITY }),
    ).toThrow(/temperature/);
  });

  it('rejects negative top_k or seed', () => {
    expect(() => validateLlmCallParams({ ...VALID, topK: -1 })).toThrow(/topK/);
    expect(() => validateLlmCallParams({ ...VALID, seed: -1 })).toThrow(/seed/);
  });

  it('rejects an unknown format value', () => {
    expect(() => validateLlmCallParams({ ...VALID, format: 'yaml' as unknown as 'json' })).toThrow(
      /format/,
    );
  });

  it('rejects a stop array containing non-strings', () => {
    expect(() =>
      validateLlmCallParams({
        ...VALID,
        stop: [42 as unknown as string],
      }),
    ).toThrow(/stop/);
  });
});

describe('computePromptHash', () => {
  it('is stable across two equivalent params objects (different key order)', () => {
    const a = computePromptHash(VALID);
    const b = computePromptHash({
      seed: 42,
      topK: 40,
      topP: 0.9,
      temperature: 0,
      prompt: 'hello',
      model: 'gemma4:e4b-it-q8_0',
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs when any sampling parameter changes', () => {
    const base = computePromptHash(VALID);
    expect(computePromptHash({ ...VALID, seed: 43 })).not.toBe(base);
    expect(computePromptHash({ ...VALID, temperature: 0.1 })).not.toBe(base);
    expect(computePromptHash({ ...VALID, topK: 41 })).not.toBe(base);
    expect(computePromptHash({ ...VALID, topP: 0.91 })).not.toBe(base);
    expect(computePromptHash({ ...VALID, prompt: 'world' })).not.toBe(base);
    expect(computePromptHash({ ...VALID, model: 'gemma4:31b-it-q8_0' })).not.toBe(base);
  });
});

describe('createStubLlmClient', () => {
  it('returns the handler text and exposes recorded calls', async () => {
    const stub = createStubLlmClient(() => 'canned response');
    const result = await stub.call(VALID);
    expect(result.text).toBe('canned response');
    expect(result.model).toBe(VALID.model);
    expect(result.promptHash).toBe(computePromptHash(VALID));
    expect(result.responseHash).toBe(sha256Hex('canned response'));
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]!.params).toBe(VALID);
    expect(stub.calls[0]!.result).toBe(result);
  });

  it('runs the parameter guard before invoking the handler', async () => {
    let handlerCalled = false;
    const stub = createStubLlmClient(() => {
      handlerCalled = true;
      return 'ignored';
    });
    await expect(stub.call(withoutKey('seed'))).rejects.toThrow(/seed/);
    expect(handlerCalled).toBe(false);
  });

  it('two stubs with the same handler produce identical results for the same params', async () => {
    const handler = (p: LlmCallParams): string => `echo:${p.prompt}:${p.seed}`;
    const a = await createStubLlmClient(handler).call(VALID);
    const b = await createStubLlmClient(handler).call(VALID);
    expect(a.text).toBe(b.text);
    expect(a.promptHash).toBe(b.promptHash);
    expect(a.responseHash).toBe(b.responseHash);
  });
});
