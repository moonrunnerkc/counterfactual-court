/**
 * Time source. Two implementations live in this file: a frozen clock that
 * always returns the same instant (used inside agent execution), and a wall
 * clock that reads real time (used at the CLI boundary).
 *
 * The runtime contract: agent code only ever sees a frozen clock through
 * AgentContext, so two replays of the same bundle observe identical
 * timestamps. The single allowed Date.now() call in the runtime lives in
 * {@link wallClock}; nothing else under src/runtime should import Date.
 */
export interface Clock {
  /** Current time in milliseconds since the Unix epoch. */
  nowMillis(): number;
  /** Current time as an ISO 8601 string with millisecond precision. */
  nowIso(): string;
}

/**
 * Build a frozen clock. Every call returns the instant the clock was created
 * with, so the agent execution loop sees a stable wall time. Use this inside
 * AgentContext.
 *
 * @param isoOrEpoch ISO 8601 string (e.g. `2026-05-07T14:25:00Z`) or epoch
 *                   milliseconds.
 * @returns A clock that always returns the supplied instant.
 * @throws If `isoOrEpoch` does not parse to a finite millisecond value.
 */
export function frozenClockAt(isoOrEpoch: string | number): Clock {
  const millis = typeof isoOrEpoch === 'number' ? isoOrEpoch : Date.parse(isoOrEpoch);
  if (!Number.isFinite(millis)) {
    throw new Error(
      `frozenClockAt: invalid timestamp ${String(isoOrEpoch)}; pass an ISO 8601 string or epoch milliseconds`,
    );
  }
  const iso = new Date(millis).toISOString();
  return {
    nowMillis: () => millis,
    nowIso: () => iso,
  };
}

/**
 * Build a wall clock. Reads real time on every call. The only place in the
 * runtime allowed to call Date.now(); use it strictly outside the agent loop
 * (CLI startup, log envelope before AgentContext exists, tooling).
 *
 * @returns A clock that returns real time on each invocation.
 */
export function wallClock(): Clock {
  return {
    nowMillis: () => Date.now(),
    nowIso: () => new Date().toISOString(),
  };
}
