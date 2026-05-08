import { z } from 'zod';
import type { AgentContext } from '../runtime/agent-context.js';
import { parseJsonResponse } from './parse-json-response.js';
import { ReporterExhibits, type ReporterExhibit } from '../evidence/schema.js';
import { extractMermaidBlocks } from '../multimodal/mermaid-extract.js';
import { detectDiagramDivergences } from '../multimodal/divergence.js';

const REPORTER_EXHIBITS_JSON_SCHEMA = z.toJSONSchema(ReporterExhibits) as Record<string, unknown>;

/** Default Ollama tag for the Court Reporter. Same model as the Prosecutor; different role. */
export const COURT_REPORTER_MODEL = 'gemma4:e4b-it-q8_0';

const MAX_SEED = 2 ** 31 - 1;

const SYSTEM_PROMPT = `You are the Court Reporter in Counterfactual Court, an offline PR review system.
Your job is to convert PNG attachments (screenshots, diagrams) into structured exhibits the Jury can compare against the diff. You see only the images. You do not see the patch or any other dossier.
Return a single JSON object that conforms to this TypeScript type and nothing else:

interface ReporterExhibits {
  exhibits: Array<{
    id: string;            // short stable id like "r1", "r2"
    attachmentName: string; // exact filename from input
    extractedText: string;  // OCR text or empty if none
    intentSummary: string;  // one sentence describing what the image conveys
    kind: "logic-error" | "security-risk" | "test-weakening" | "style-violation" | "license-concern" | "documentation" | "multimodal-extraction" | "other";
  }>;
}

Rules:
- Produce one exhibit per attachment.
- For most screenshots, kind is "multimodal-extraction".
- Output JSON only, no Markdown, no commentary.`;

/** Minimal description of one PNG attachment fed to the Court Reporter. */
export interface PngAttachment {
  /** Filename or stable label, e.g. `before.png`. */
  readonly name: string;
  /** Base64-encoded PNG bytes (no `data:` prefix). */
  readonly base64: string;
}

/**
 * Build the user-facing prompt body for the Court Reporter. Exposed for tests
 * so they can assert prompt stability across refactors.
 *
 * @param attachments PNG attachments (zero or more) presented to the model.
 * @returns The prompt string sent verbatim to the LLM.
 */
export function buildCourtReporterPrompt(attachments: readonly PngAttachment[]): string {
  const manifest = attachments.map((a, idx) => `${idx + 1}. ${a.name}`).join('\n');
  return `## Attachments\n\n${manifest}\n\n## Task\n\nProduce the ReporterExhibits JSON now, with exactly ${attachments.length} exhibit${attachments.length === 1 ? '' : 's'}.`;
}

/** Inputs accepted by {@link reportCourt}. */
export interface CourtReporterInput {
  /** PNG attachments. Zero-length is allowed and produces an empty exhibit list. */
  readonly attachments: readonly PngAttachment[];
  /**
   * Phase 2E. Optional PR description (Markdown). When present, the Court
   * Reporter extracts Mermaid blocks and emits one exhibit per block plus a
   * divergence exhibit when the diagram and diff disagree on symbols.
   */
  readonly prDescription?: string;
  /**
   * Phase 2E. Optional patch text used as the comparison side of the
   * diagram-vs-diff divergence detector.
   */
  readonly patch?: string;
  /** Caller-supplied context bundling rng, clock, llm, logger, config. */
  readonly ctx: AgentContext;
}

/**
 * Run the Court Reporter agent. When `attachments` is empty no LLM call is
 * made and an empty exhibit list is returned (per the Phase 1 cuts-list
 * stub policy). Otherwise the multimodal model is invoked once with all
 * attachments forwarded as base64 images.
 *
 * @param input Attachments and agent context.
 * @returns A validated {@link ReporterExhibits}.
 * @throws Error if the model output is not valid JSON or fails the schema.
 */
export async function reportCourt(input: CourtReporterInput): Promise<ReporterExhibits> {
  const { attachments, ctx } = input;
  const log = ctx.logger.child({ agent: 'court-reporter' });

  const diagramExhibits = extractDiagramExhibits(input);

  if (attachments.length === 0) {
    if (diagramExhibits.length > 0) {
      log.info('agent.skip', {
        reason: 'no-image-attachments',
        diagramExhibits: diagramExhibits.length,
      });
      return { exhibits: diagramExhibits };
    }
    log.info('agent.skip', { reason: 'no-attachments' });
    return { exhibits: [] };
  }
  const seed = ctx.rng.nextInt(0, MAX_SEED);
  const prompt = buildCourtReporterPrompt(attachments);
  log.info('agent.start', {
    model: COURT_REPORTER_MODEL,
    seed,
    attachmentCount: attachments.length,
    diagramExhibits: diagramExhibits.length,
  });
  const result = await ctx.llm.call({
    model: COURT_REPORTER_MODEL,
    system: SYSTEM_PROMPT,
    prompt,
    temperature: 0,
    topP: 0.95,
    topK: 40,
    seed,
    images: attachments.map((a) => a.base64),
    format: REPORTER_EXHIBITS_JSON_SCHEMA,
    keepAlive: '15m',
    maxTokens: 4096,
  });
  const llmExhibits = parseJsonResponse(result.text, ReporterExhibits, 'court-reporter');
  const merged: ReporterExhibits = {
    exhibits: [...llmExhibits.exhibits, ...diagramExhibits],
  };
  log.info('agent.done', {
    promptHash: result.promptHash,
    responseHash: result.responseHash,
    exhibitCount: merged.exhibits.length,
  });
  return merged;
}

/**
 * Build the Phase 2E diagram and divergence exhibits without an LLM call.
 * One exhibit per Mermaid block (kind='multimodal-extraction') plus one
 * divergence exhibit per block whose symbols don't line up with the diff.
 */
function extractDiagramExhibits(input: CourtReporterInput): ReporterExhibit[] {
  if (input.prDescription === undefined || input.prDescription.length === 0) return [];
  const blocks = extractMermaidBlocks(input.prDescription);
  if (blocks.length === 0) return [];
  const exhibits: ReporterExhibit[] = blocks.map((block) => ({
    id: `diagram-${block.index}`,
    attachmentName: `mermaid-${block.kind}-${block.index}.md`,
    extractedText: block.body,
    intentSummary: `${block.kind} block extracted from PR description (block ${block.index})`,
    kind: 'multimodal-extraction',
  }));
  if (input.patch !== undefined && input.patch.length > 0) {
    const divergences = detectDiagramDivergences(input.prDescription, input.patch);
    for (const div of divergences) {
      if (!div.diverges) continue;
      exhibits.push({
        id: `divergence-${div.blockIndex}`,
        attachmentName: `divergence-${div.blockIndex}.json`,
        extractedText: JSON.stringify(div, null, 2),
        intentSummary: `Diagram-vs-diff divergence on block ${div.blockIndex} (${div.kind}): ${div.diagramOnly.length} diagram-only symbol(s), ${div.diffOnly.length} diff-only symbol(s)`,
        kind: 'documentation',
      });
    }
  }
  return exhibits;
}
