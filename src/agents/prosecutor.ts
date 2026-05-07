import type { AgentContext } from '../runtime/agent-context.js';
import { parseJsonResponse } from './parse-json-response.js';
import { ProsecutionDossier } from '../evidence/schema.js';

/** Default Ollama tag for the Prosecutor. Pinned to a digest in runtime.lock.json. */
export const PROSECUTOR_MODEL = 'gemma4:e4b-it-q8_0';

const MAX_SEED = 2 ** 31 - 1;

const SYSTEM_PROMPT = `You are the Prosecutor in Counterfactual Court, an offline PR review system.
Your job is to argue against the patch under review. Surface every plausible concern: logic errors, security risks, weakened tests, style violations, license issues. Never approve.
Return a single JSON object that conforms to this TypeScript type and nothing else:

interface ProsecutionDossier {
  exhibits: Array<{
    id: string;            // short stable id like "p1", "p2"
    kind: "logic-error" | "security-risk" | "test-weakening" | "style-violation" | "license-concern" | "documentation" | "multimodal-extraction" | "other";
    claim: string;         // one-sentence allegation
    evidence: string;      // a verbatim quote from the patch or repo snippet
    confidence: number;    // 0..1, your confidence the allegation holds
  }>;
  summary: string;         // one paragraph synthesizing the case
}

Rules:
- If the patch looks clean, return an empty exhibits array and a summary noting that.
- evidence must quote the input. Do not paraphrase.
- EVERY exhibit object MUST include all five fields (id, kind, claim, evidence, confidence). A missing field invalidates the dossier and the case is dismissed. Confidence is required even when uncertain; pick a number between 0 and 1.
- Output JSON only, no Markdown, no commentary.`;

/**
 * Build the user-facing prompt body for the Prosecutor. Exposed for tests so
 * they can hash it and assert prompt stability across refactors.
 *
 * @param patch       Unified-diff text of the patch under review.
 * @param repoSnippet Working-set excerpt the orchestrator selected for context.
 * @returns The prompt string sent verbatim to the LLM.
 */
export function buildProsecutorPrompt(patch: string, repoSnippet: string): string {
  return `## Patch under review\n\n${patch}\n\n## Repository working set\n\n${repoSnippet}\n\n## Task\n\nProduce the ProsecutionDossier JSON now.`;
}

/** Inputs accepted by {@link prosecute}. */
export interface ProsecutorInput {
  /** Unified-diff text of the patch under review. */
  readonly patch: string;
  /** Working-set excerpt the orchestrator selected for context. */
  readonly repoSnippet: string;
  /** Caller-supplied context bundling rng, clock, llm, logger, config. */
  readonly ctx: AgentContext;
}

/**
 * Run the Prosecutor agent. Calls the gateway LLM with explicit decoding
 * parameters, then parses and zod-validates the response into a typed
 * {@link ProsecutionDossier}. The single LLM seed is drawn from `ctx.rng`,
 * so two runs that share an rng-seed and inputs produce identical calls.
 *
 * @param input Patch, repo snippet, and agent context.
 * @returns A validated {@link ProsecutionDossier}.
 * @throws Error if the model output is not valid JSON or fails the schema.
 */
export async function prosecute(input: ProsecutorInput): Promise<ProsecutionDossier> {
  const { patch, repoSnippet, ctx } = input;
  const log = ctx.logger.child({ agent: 'prosecutor' });
  const seed = ctx.rng.nextInt(0, MAX_SEED);
  const prompt = buildProsecutorPrompt(patch, repoSnippet);
  log.info('agent.start', { model: PROSECUTOR_MODEL, seed });
  const result = await ctx.llm.call({
    model: PROSECUTOR_MODEL,
    system: SYSTEM_PROMPT,
    prompt,
    temperature: 0,
    topP: 0.95,
    topK: 40,
    seed,
  });
  const dossier = parseJsonResponse(result.text, ProsecutionDossier, 'prosecutor');
  log.info('agent.done', {
    promptHash: result.promptHash,
    responseHash: result.responseHash,
    exhibitCount: dossier.exhibits.length,
  });
  return dossier;
}
