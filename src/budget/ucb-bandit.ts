/**
 * Standard UCB1 (Auer, Cesa-Bianchi, Fischer 2002). Each arm is identified by
 * a string name; state carries the per-arm pull count and cumulative reward.
 *
 * Pure: every state-mutating function returns a new state. Deterministic: ties
 * are broken by arm-index order so two callers with the same history pick the
 * same arm.
 */

/** Per-arm history. */
export interface BanditArmState {
  /** Stable arm identifier; required to be unique within a {@link BanditState}. */
  name: string;
  /** Number of times this arm has been pulled. */
  pulls: number;
  /** Sum of rewards observed for this arm. */
  totalReward: number;
}

/** Full bandit state. */
export interface BanditState {
  arms: BanditArmState[];
  /** Total pulls across every arm; equals sum of `arms[i].pulls`. */
  totalPulls: number;
  /**
   * Exploration coefficient `c` in `mean + c*sqrt(ln(N)/n)`. Default 2 matches
   * the textbook UCB1 derivation when reward is bounded in [0, 1]. Other
   * values are valid; ADR-003 documents the choice for this project.
   */
  explorationCoefficient: number;
}

/**
 * Build a fresh bandit over the given arm names. Pure.
 *
 * @param armNames Distinct arm names (any non-empty string each).
 * @param explorationCoefficient Sets the `c` in `mean + c*sqrt(ln(N)/n)`;
 *   defaults to 2 (textbook UCB1).
 * @returns A {@link BanditState} with zeroed history.
 * @throws Error when `armNames` is empty or contains duplicates.
 */
export function emptyBanditState(
  armNames: readonly string[],
  explorationCoefficient = 2,
): BanditState {
  if (armNames.length === 0) {
    throw new Error('bandit: at least one arm required; got 0');
  }
  const seen = new Set<string>();
  for (const name of armNames) {
    if (name.length === 0) throw new Error('bandit: arm name must be non-empty');
    if (seen.has(name)) throw new Error(`bandit: duplicate arm name "${name}"`);
    seen.add(name);
  }
  return {
    arms: armNames.map((name) => ({ name, pulls: 0, totalReward: 0 })),
    totalPulls: 0,
    explorationCoefficient,
  };
}

/**
 * Compute the UCB1 score for one arm. When `pulls` is 0 the score is
 * `Number.POSITIVE_INFINITY` so the policy explores every arm at least once
 * before relying on the mean term.
 */
export function ucbScore(state: BanditState, armIndex: number): number {
  const arm = state.arms[armIndex];
  if (arm === undefined) {
    throw new Error(`bandit: arm index ${armIndex} out of range; ${state.arms.length} arms`);
  }
  if (arm.pulls === 0) return Number.POSITIVE_INFINITY;
  if (state.totalPulls === 0) return Number.POSITIVE_INFINITY;
  const mean = arm.totalReward / arm.pulls;
  const exploration = Math.sqrt(
    (state.explorationCoefficient * Math.log(state.totalPulls)) / arm.pulls,
  );
  return mean + exploration;
}

/** Result of a single arm-selection step. */
export interface PickResult {
  /** Index of the chosen arm in {@link BanditState.arms}. */
  armIndex: number;
  /** UCB scores for each arm at the moment of selection (parallel to `state.arms`). */
  scores: number[];
}

/**
 * Pick the next arm. Returns the index plus the per-arm UCB scores so the
 * orchestrator can log the decision into the bundle's allocation trace.
 *
 * Tie-break rule: when two arms share the maximum score (typical when both
 * have zero pulls and produce +Infinity), the lower-index arm wins. This is
 * deterministic given the arm-name order the caller passed to
 * {@link emptyBanditState}.
 *
 * @param state Bandit state.
 * @returns {@link PickResult} with the chosen arm index and per-arm scores.
 */
export function pickArm(state: BanditState): PickResult {
  const scores = state.arms.map((_, i) => ucbScore(state, i));
  let bestIndex = 0;
  let bestScore = scores[0] ?? Number.NEGATIVE_INFINITY;
  for (let i = 1; i < scores.length; i++) {
    const s = scores[i];
    if (s !== undefined && s > bestScore) {
      bestIndex = i;
      bestScore = s;
    }
  }
  return { armIndex: bestIndex, scores };
}

/**
 * Record an observed reward for the most recently pulled arm. Pure.
 *
 * @param state    Source state.
 * @param armIndex Arm that was pulled.
 * @param reward   Observed reward; the caller is responsible for keeping it
 *   in the same range across pulls (the UCB1 derivation assumes bounded
 *   rewards; values outside [0, 1] are accepted but the exploration term is
 *   no longer calibrated).
 * @returns A new {@link BanditState}.
 * @throws Error when `armIndex` is out of range.
 */
export function recordReward(state: BanditState, armIndex: number, reward: number): BanditState {
  const arm = state.arms[armIndex];
  if (arm === undefined) {
    throw new Error(`bandit: arm index ${armIndex} out of range; ${state.arms.length} arms`);
  }
  const updated: BanditArmState = {
    name: arm.name,
    pulls: arm.pulls + 1,
    totalReward: arm.totalReward + reward,
  };
  return {
    ...state,
    arms: state.arms.map((a, i) => (i === armIndex ? updated : a)),
    totalPulls: state.totalPulls + 1,
  };
}

/**
 * Convert a textbook UCB1 instance description into a state. Used by the
 * UCB1 correctness test so the test reads as the textbook does. Each entry
 * supplies a name, the number of pulls so far, and the cumulative reward.
 *
 * @param entries Per-arm history.
 * @param explorationCoefficient Optional override; defaults to 2.
 * @returns A {@link BanditState} populated with the provided history.
 */
export function banditStateFromHistory(
  entries: readonly { name: string; pulls: number; totalReward: number }[],
  explorationCoefficient = 2,
): BanditState {
  const totalPulls = entries.reduce((acc, e) => acc + e.pulls, 0);
  return {
    arms: entries.map((e) => ({ name: e.name, pulls: e.pulls, totalReward: e.totalReward })),
    totalPulls,
    explorationCoefficient,
  };
}
