import { z } from 'zod';
import type { AgentContext } from '../runtime/agent-context.js';
import { parseJsonResponse } from './parse-json-response.js';
import { DefenseDossier, type ProsecutionDossier } from '../evidence/schema.js';

const DEFENSE_DOSSIER_JSON_SCHEMA = z.toJSONSchema(DefenseDossier) as Record<string, unknown>;

/**
 * Default Ollama tag for the Defender. Per ADR-004 the Defender shares the
 * `e4b-it-q8_0` model file with the Prosecutor and Court Reporter; running
 * three distinct quantized models in VRAM was the dominant failure mode in
 * Phase 2F bench. The Defender is still a logically distinct agent (its own
 * prompt, its own seed, its own exhibits).
 */
export const DEFENDER_MODEL = 'gemma4:e4b-it-q8_0';

const MAX_SEED = 2 ** 31 - 1;

const SYSTEM_PROMPT = `You are the Defender in Counterfactual Court, an offline PR review system.
Your job is to rebut every Prosecutor exhibit. For each exhibit produce a rebuttal that either refutes the allegation outright or contextualizes it as benign. Be honest: when an exhibit is correct, say so by setting refutes=false but still explain the trade-off.
Return a single JSON object that conforms to this TypeScript type and nothing else:

interface DefenseDossier {
  rebuttals: Array<{
    exhibitId: string;     // matches a Prosecutor exhibit id verbatim
    rebuttal: string;      // one paragraph addressing the claim
    refutes: boolean;      // true if you believe the allegation does not hold
    confidence: number;    // 0..1, your confidence the rebuttal holds
  }>;
  summary: string;         // one paragraph synthesizing the defense
}

Rules:
- Produce exactly one rebuttal per Prosecutor exhibit. Do not invent new ids.
- If there are zero exhibits, return an empty rebuttals array and a brief summary.
- EVERY rebuttal object MUST include all four fields (exhibitId, rebuttal, refutes, confidence). A missing field invalidates the dossier.
- Output JSON only, no Markdown, no commentary.`;

/**
 * Build the user-facing prompt body for the Defender. Exposed for tests so
 * they can hash it and assert prompt stability across refactors.
 *
 * @param patch    Unified-diff text of the patch under review.
 * @param dossier  Prosecution exhibits the Defender must rebut.
 * @returns The prompt string sent verbatim to the LLM.
 */
export function buildDefenderPrompt(patch: string, dossier: ProsecutionDossier): string {
  const dossierJson = JSON.stringify(dossier, null, 2);
  return `## Patch under review\n\n${patch}\n\n## Prosecution dossier\n\n${dossierJson}\n\n## Task\n\nProduce the DefenseDossier JSON now.`;
}

/** Inputs accepted by {@link defend}. */
export interface DefenderInput {
  /** Unified-diff text of the patch under review. */
  readonly patch: string;
  /** Prosecution exhibits the Defender must rebut, keyed by exhibit id. */
  readonly dossier: ProsecutionDossier;
  /** Caller-supplied context bundling rng, clock, llm, logger, config. */
  readonly ctx: AgentContext;
}

/**
 * Run the Defender agent. Calls the gateway LLM with explicit decoding
 * parameters, then parses and zod-validates the response into a typed
 * {@link DefenseDossier}.
 *
 * @param input Patch, prosecution dossier, and agent context.
 * @returns A validated {@link DefenseDossier}.
 * @throws Error if the model output is not valid JSON or fails the schema.
 */
export async function defend(input: DefenderInput): Promise<DefenseDossier> {
  const { patch, dossier, ctx } = input;
  const log = ctx.logger.child({ agent: 'defender' });
  const seed = ctx.rng.nextInt(0, MAX_SEED);
  const prompt = buildDefenderPrompt(patch, dossier);
  log.info('agent.start', {
    model: DEFENDER_MODEL,
    seed,
    exhibitCount: dossier.exhibits.length,
  });
  const result = await ctx.llm.call({
    model: DEFENDER_MODEL,
    system: SYSTEM_PROMPT,
    prompt,
    temperature: 0,
    topP: 0.95,
    topK: 40,
    seed,
    format: DEFENSE_DOSSIER_JSON_SCHEMA,
    keepAlive: '15m',
    maxTokens: 4096,
  });
  const defense = parseJsonResponse(result.text, DefenseDossier, 'defender');
  log.info('agent.done', {
    promptHash: result.promptHash,
    responseHash: result.responseHash,
    rebuttalCount: defense.rebuttals.length,
  });
  return defense;
}
