import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStubLlmClient } from '../runtime/llm-client-stub.js';
import { reportCourt } from './court-reporter.js';
import { createTestContext } from './test-context.js';

const FIXTURE_ROOT = resolve(__dirname, '..', '..', 'fixtures', 'diagram-mismatch');
const PATCH = readFileSync(resolve(FIXTURE_ROOT, 'patch.diff'), 'utf8');
const PR_DESCRIPTION = readFileSync(resolve(FIXTURE_ROOT, 'pr-description.md'), 'utf8');

describe('Court Reporter (Phase 2E multimodal extensions)', () => {
  it('emits a diagram exhibit when the PR description contains a Mermaid block', async () => {
    const llm = createStubLlmClient(() => '{"exhibits":[]}');
    const ctx = createTestContext(llm, 'multimodal-seed');
    const result = await reportCourt({
      attachments: [],
      prDescription: PR_DESCRIPTION,
      patch: PATCH,
      ctx,
    });
    const diagrams = result.exhibits.filter((e) => e.id.startsWith('diagram-'));
    expect(diagrams.length).toBeGreaterThan(0);
    expect(diagrams[0]!.kind).toBe('multimodal-extraction');
    expect(diagrams[0]!.extractedText).toContain('Caller->>Calculator');
  });

  it('emits a divergence exhibit when the diagram describes sub() but the patch inverts add()', async () => {
    const llm = createStubLlmClient(() => '{"exhibits":[]}');
    const ctx = createTestContext(llm, 'multimodal-seed');
    const result = await reportCourt({
      attachments: [],
      prDescription: PR_DESCRIPTION,
      patch: PATCH,
      ctx,
    });
    const divergences = result.exhibits.filter((e) => e.id.startsWith('divergence-'));
    expect(divergences.length).toBeGreaterThan(0);
    expect(divergences[0]!.intentSummary).toContain('Diagram-vs-diff divergence');
    const parsed = JSON.parse(divergences[0]!.extractedText) as {
      diagramOnly: string[];
      diffOnly: string[];
    };
    expect(parsed.diagramOnly).toContain('sub');
  });

  it('skips LLM call cleanly when no PNG attachments and no diagrams', async () => {
    const llm = createStubLlmClient(() => '{"exhibits":[]}');
    const ctx = createTestContext(llm, 'multimodal-seed');
    const result = await reportCourt({ attachments: [], ctx });
    expect(result.exhibits).toEqual([]);
    expect(llm.calls).toHaveLength(0);
  });

  it('returns diagram exhibits without an LLM call when only diagrams are present (no PNGs)', async () => {
    const llm = createStubLlmClient(() => {
      throw new Error('should not call LLM');
    });
    const ctx = createTestContext(llm, 'multimodal-seed');
    const result = await reportCourt({
      attachments: [],
      prDescription: PR_DESCRIPTION,
      patch: PATCH,
      ctx,
    });
    expect(result.exhibits.length).toBeGreaterThan(0);
    expect(llm.calls).toHaveLength(0);
  });
});
