import { z } from 'zod';
import { emptyBanditState, pickArm, recordReward, type BanditState } from './ucb-bandit.js';

/** Discrete arm identifiers the budget orchestrator allocates over. */
export const BUDGET_ARMS = ['prosecution-rollout', 'defense-rebuttal', 'jury-round'] as const;
/** TS-side union of {@link BUDGET_ARMS}. */
export type BudgetArm = (typeof BUDGET_ARMS)[number];

/** Zod schema for one allocation step recorded into a bundle. */
export const AllocationStepSchema = z.object({
  step: z.number().int().nonnegative(),
  arm: z.enum(BUDGET_ARMS),
  /** Per-arm UCB scores at the moment of selection (parallel to BUDGET_ARMS). */
  scores: z.array(z.number()),
  /** Wall-clock time the step took to execute, in milliseconds. */
  durationMs: z.number().nonnegative(),
  /** Remaining budget after this step, in milliseconds. */
  remainingMs: z.number(),
  /**
   * Reward observed for this step. Defined as the marginal increase in
   * evidence-graph node count weighted by the jury confidence delta; see
   * docs/DECISIONS.md ADR-003 for rationale.
   */
  reward: z.number(),
});

/** TS view of {@link AllocationStepSchema}. */
export type AllocationStep = z.infer<typeof AllocationStepSchema>;

/** Zod schema for the full allocation trace embedded in a bundle. */
export const AllocationTraceSchema = z.object({
  budgetMs: z.number().nonnegative(),
  arms: z.array(z.string()),
  explorationCoefficient: z.number(),
  steps: z.array(AllocationStepSchema),
});

/** TS view of {@link AllocationTraceSchema}. */
export type AllocationTrace = z.infer<typeof AllocationTraceSchema>;

/**
 * Parse a budget specifier the CLI accepts. Supports `Ns`, `Nm`, `Nh`, the
 * literal token `overnight` (8h), or a bare integer (interpreted as seconds).
 *
 * @param spec Raw flag value.
 * @returns Budget in milliseconds.
 * @throws Error with the offending input on malformed values.
 */
export function parseBudgetSpec(spec: string): number {
  const trimmed = spec.trim().toLowerCase();
  if (trimmed === 'overnight') return 8 * 60 * 60 * 1000;
  const match = /^(\d+(?:\.\d+)?)(s|m|h)?$/u.exec(trimmed);
  if (match === null) {
    throw new Error(
      `budget: cannot parse "${spec}"; use forms like "5m", "50m", "2h", "overnight", or a bare integer (seconds)`,
    );
  }
  const value = Number.parseFloat(match[1] ?? '');
  const unit = match[2] ?? 's';
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`budget: numeric portion of "${spec}" must be a positive finite number`);
  }
  const seconds = unit === 'h' ? value * 3600 : unit === 'm' ? value * 60 : value;
  return Math.round(seconds * 1000);
}

/** Caller-provided executor that runs a single rollout for the named arm. */
export type ArmExecutor = (
  arm: BudgetArm,
  step: number,
) => Promise<{ readonly reward: number; readonly durationMs: number }>;

/** Inputs to {@link runBanditLoop}. */
export interface BanditLoopOptions {
  /** Total budget in milliseconds. The loop stops when remaining budget < 0. */
  readonly budgetMs: number;
  /** Caller-supplied per-arm executor. Receives the arm name and the step index. */
  readonly executor: ArmExecutor;
  /** Optional exploration coefficient override; defaults to 2. */
  readonly explorationCoefficient?: number;
  /**
   * Maximum number of allocation steps as a safety bound, in case an executor
   * reports zero duration and the loop would otherwise spin. Defaults to 256.
   */
  readonly maxSteps?: number;
}

/**
 * Run the UCB1 budget loop. At each step, picks an arm via UCB1, calls the
 * executor for one rollout, records the reward, deducts the duration from
 * the remaining budget, and emits an allocation step into the trace.
 *
 * Budget semantics: the loop is allowed to overshoot by at most one step
 * because the budget check happens before the step starts; once a step
 * begins, we commit to recording its result. Tested explicitly.
 *
 * @param opts Loop options.
 * @returns Final trace plus the final bandit state.
 */
export async function runBanditLoop(opts: BanditLoopOptions): Promise<{
  readonly trace: AllocationTrace;
  readonly finalState: BanditState;
}> {
  const exploration = opts.explorationCoefficient ?? 2;
  const maxSteps = opts.maxSteps ?? 256;
  let state = emptyBanditState([...BUDGET_ARMS], exploration);
  const steps: AllocationStep[] = [];
  let remaining = opts.budgetMs;
  let stepIdx = 0;

  while (remaining > 0 && stepIdx < maxSteps) {
    const pick = pickArm(state);
    const arm = BUDGET_ARMS[pick.armIndex];
    if (arm === undefined) {
      throw new Error(`budget orchestrator: bandit picked invalid arm index ${pick.armIndex}`);
    }
    const result = await opts.executor(arm, stepIdx);
    state = recordReward(state, pick.armIndex, result.reward);
    remaining -= result.durationMs;
    steps.push({
      step: stepIdx,
      arm,
      scores: pick.scores.map((s) => (Number.isFinite(s) ? s : Number.MAX_SAFE_INTEGER)),
      durationMs: result.durationMs,
      remainingMs: remaining,
      reward: result.reward,
    });
    stepIdx += 1;
  }

  const trace: AllocationTrace = {
    budgetMs: opts.budgetMs,
    arms: [...BUDGET_ARMS],
    explorationCoefficient: exploration,
    steps,
  };
  return { trace, finalState: state };
}
