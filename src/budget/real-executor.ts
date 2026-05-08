import type { AgentContext } from '../runtime/agent-context.js';
import type { LlmCallParams, LlmClient } from '../runtime/llm-client.js';
import { PROSECUTOR_MODEL } from '../agents/prosecutor.js';
import { DEFENDER_MODEL } from '../agents/defender.js';
import { JURY_MODEL } from '../agents/jury.js';
import type { ArmExecutor, BudgetArm } from './orchestrator.js';

const MAX_SEED = 2 ** 31 - 1;

/**
 * Inputs the real bandit executor needs to issue rollout-specific LLM calls.
 * Mirrors the OrchestratorInputs subset that's load-bearing for the per-arm
 * mini-prompts so the executor can construct deterministic prompts without
 * reaching into the full pipeline state.
 */
export interface RealExecutorInputs {
  /** Unified-diff text the bandit is reasoning about. */
  readonly patch: string;
  /** Excerpt of the working set the agents see. */
  readonly repoSnippet: string;
  /** Concatenated style/policy docs the Jury would normally read. */
  readonly styleDocs: string;
}

interface ParsedReward {
  reward: number;
  rationale: string;
}

const SYSTEM_BY_ARM: Record<BudgetArm, string> = {
  'prosecution-rollout': `You are a Phase 2D bandit rollout for the Prosecutor. In one greedy pass, surface ONE additional concern with the patch under review and rate your confidence in the concern. Output JSON exactly:
{ "concern": "<one sentence>", "confidence": <0..1> }
JSON only.`,
  'defense-rebuttal': `You are a Phase 2D bandit rollout for the Defender. In one greedy pass, give the strongest single rebuttal that the patch is acceptable, and rate your confidence. Output JSON exactly:
{ "rebuttal": "<one sentence>", "confidence": <0..1> }
JSON only.`,
  'jury-round': `You are a Phase 2D bandit rollout for the Jury. In one greedy pass, restate your current verdict on the patch and rate your confidence. Output JSON exactly:
{ "verdict": "approve" | "reject" | "request-changes", "confidence": <0..1> }
JSON only.`,
};

const MODEL_BY_ARM: Record<BudgetArm, string> = {
  'prosecution-rollout': PROSECUTOR_MODEL,
  'defense-rebuttal': DEFENDER_MODEL,
  'jury-round': JURY_MODEL,
};

function buildPrompt(arm: BudgetArm, inputs: RealExecutorInputs, step: number): string {
  return [
    `## Rollout step ${step} (${arm})`,
    '',
    '## Patch under review',
    '',
    inputs.patch,
    '',
    '## Repository working set',
    '',
    inputs.repoSnippet,
    '',
    arm === 'jury-round' ? '## Style and policy docs' : '## Notes',
    '',
    arm === 'jury-round' ? inputs.styleDocs : `Rollout ${step} for ${arm}.`,
    '',
    '## Task',
    '',
    'Output the rollout JSON now.',
  ].join('\n');
}

function parseReward(text: string, arm: BudgetArm): ParsedReward {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return { reward: 0, rationale: 'parse-error' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { reward: 0, rationale: 'parse-error' };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { reward: 0, rationale: 'parse-error' };
  }
  const obj = parsed as {
    confidence?: unknown;
    concern?: unknown;
    rebuttal?: unknown;
    verdict?: unknown;
  };
  const confidence = typeof obj.confidence === 'number' ? obj.confidence : 0;
  const clamped = Math.max(0, Math.min(1, confidence));
  const rationale =
    arm === 'prosecution-rollout' && typeof obj.concern === 'string'
      ? obj.concern.slice(0, 200)
      : arm === 'defense-rebuttal' && typeof obj.rebuttal === 'string'
        ? obj.rebuttal.slice(0, 200)
        : arm === 'jury-round' && typeof obj.verdict === 'string'
          ? `verdict=${obj.verdict}`
          : '';
  return { reward: clamped, rationale };
}

/**
 * Build an {@link ArmExecutor} that issues real Gemma 4 calls per rollout.
 * Each arm dispatches to the model the corresponding agent uses; the seed is
 * drawn from the {@link AgentContext} RNG so the same baseSeed reproduces
 * the same rollout sequence. The reward is the model-reported confidence,
 * clamped to [0, 1] per ADR-003 (UCB1 calibration assumes bounded rewards).
 *
 * @param ctx     AgentContext supplying the RNG, clock, logger, and the
 *                authorized LLM gateway.
 * @param inputs  Patch, repo snippet, and style docs that flow into every
 *                rollout's prompt.
 * @returns A function suitable as the `executor` in
 *   {@link ../budget/orchestrator.ts:BanditLoopOptions}.
 */
export function createRealBanditExecutor(
  ctx: AgentContext,
  inputs: RealExecutorInputs,
): ArmExecutor {
  const log = ctx.logger.child({ component: 'real-bandit-executor' });
  const llm: LlmClient = ctx.llm;
  return async (arm, step) => {
    // Wall-clock measurement is inherently non-deterministic. Real-bandit
    // runs trade replay bit-identity for genuine reward signals; the synthetic
    // executor remains the deterministic option for tests. ADR-003 documents
    // the trade-off.
    const start = Date.now();
    const seed = ctx.rng.nextInt(0, MAX_SEED);
    const params: LlmCallParams = {
      model: MODEL_BY_ARM[arm],
      system: SYSTEM_BY_ARM[arm],
      prompt: buildPrompt(arm, inputs, step),
      temperature: 0,
      topP: 0.95,
      topK: 40,
      seed,
      format: 'json',
    };
    log.info('bandit.rollout.start', { arm, step, seed, model: params.model });
    try {
      const result = await llm.call(params);
      const parsed = parseReward(result.text, arm);
      const durationMs = Date.now() - start;
      log.info('bandit.rollout.done', {
        arm,
        step,
        durationMs,
        reward: parsed.reward,
        rationale: parsed.rationale,
      });
      return { reward: parsed.reward, durationMs };
    } catch (err) {
      const durationMs = Date.now() - start;
      log.warn('bandit.rollout.error', {
        arm,
        step,
        durationMs,
        reason: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      });
      return { reward: 0, durationMs };
    }
  };
}
