import type { Clock, Rng } from './determinism.js';
import type { Config } from './config.js';
import type { LlmClient } from './llm-client.js';
import type { Logger } from './log.js';

/**
 * Bundle of dependencies passed as the first argument to every agent function.
 * Bundles the four primitives that distinguish an agent's controlled
 * environment from raw Node: the seeded RNG, the frozen clock, the config
 * snapshot, the gateway LLM client, and the structured logger.
 *
 * Agents must not reach around the context. No `Math.random()`, no
 * `Date.now()`, no direct Ollama calls, no `console.*`. The whole
 * determinism contract sits at this seam.
 */
export interface AgentContext {
  /** Seeded PRNG. Same seed across replays produces identical draws. */
  readonly rng: Rng;
  /** Frozen clock; every call returns the run's pinned instant. */
  readonly clock: Clock;
  /** Frozen runtime configuration loaded once at startup. */
  readonly config: Config;
  /** Sole LLM gateway. Implementations enforce explicit decoding params. */
  readonly llm: LlmClient;
  /** Structured logger. The only diagnostic output channel for agent code. */
  readonly logger: Logger;
}
