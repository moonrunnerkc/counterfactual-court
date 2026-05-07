import { describe, expect, it } from 'vitest';
import { createStubLlmClient } from '../runtime/llm-client-stub.js';
import type { ReporterExhibits } from '../evidence/schema.js';
import { reportCourt, COURT_REPORTER_MODEL, type PngAttachment } from './court-reporter.js';
import { createTestContext } from './test-context.js';

const SAMPLE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

const ATTACHMENTS: readonly PngAttachment[] = [
  { name: 'before.png', base64: SAMPLE_BASE64 },
  { name: 'after.png', base64: SAMPLE_BASE64 },
];

const STUB_EXHIBITS: ReporterExhibits = {
  exhibits: [
    {
      id: 'r1',
      attachmentName: 'before.png',
      extractedText: 'value: 42',
      intentSummary: 'Pre-patch UI shows the value 42.',
      kind: 'multimodal-extraction',
    },
    {
      id: 'r2',
      attachmentName: 'after.png',
      extractedText: 'value: 0',
      intentSummary: 'Post-patch UI shows the value 0.',
      kind: 'multimodal-extraction',
    },
  ],
};

describe('reportCourt', () => {
  it('returns an empty exhibit list and skips the LLM call when no attachments are provided', async () => {
    const llm = createStubLlmClient(() => {
      throw new Error('llm should not be called when attachments is empty');
    });
    const ctx = createTestContext(llm);
    const exhibits = await reportCourt({ attachments: [], ctx });
    expect(exhibits).toEqual({ exhibits: [] });
    expect(llm.calls).toHaveLength(0);
  });

  it('produces a zod-valid exhibit list from PNG attachments', async () => {
    const llm = createStubLlmClient(() => JSON.stringify(STUB_EXHIBITS));
    const ctx = createTestContext(llm);
    const exhibits = await reportCourt({ attachments: ATTACHMENTS, ctx });
    expect(exhibits).toEqual(STUB_EXHIBITS);
    expect(llm.calls[0]!.params.model).toBe(COURT_REPORTER_MODEL);
    expect(llm.calls[0]!.params.images).toEqual([SAMPLE_BASE64, SAMPLE_BASE64]);
  });

  it('produces identical results across two runs with the same seed', async () => {
    const handler = (): string => JSON.stringify(STUB_EXHIBITS);
    const llmA = createStubLlmClient(handler);
    const llmB = createStubLlmClient(handler);
    const a = await reportCourt({
      attachments: ATTACHMENTS,
      ctx: createTestContext(llmA, 'reporter-seed'),
    });
    const b = await reportCourt({
      attachments: ATTACHMENTS,
      ctx: createTestContext(llmB, 'reporter-seed'),
    });
    expect(a).toEqual(b);
    expect(llmA.calls[0]!.result.promptHash).toBe(llmB.calls[0]!.result.promptHash);
  });

  it('rejects schema-invalid output with a typed error', async () => {
    const bad = { exhibits: [{ id: 'r1', attachmentName: 'x.png', kind: 'unknown' }] };
    const llm = createStubLlmClient(() => JSON.stringify(bad));
    const ctx = createTestContext(llm);
    await expect(reportCourt({ attachments: ATTACHMENTS, ctx })).rejects.toThrow(
      /court-reporter: model output failed schema validation/,
    );
  });
});
