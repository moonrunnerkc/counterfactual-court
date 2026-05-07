import type { AgentContext } from '../runtime/agent-context.js';
import { createRng, frozenClockAt, type RngSeed } from '../runtime/determinism.js';
import { loadConfig } from '../runtime/config.js';
import { createLogger } from '../runtime/log.js';
import type { LlmClient } from '../runtime/llm-client.js';

/**
 * Build an in-memory {@link AgentContext} suitable for behavior tests. The
 * logger discards output (sink ignores its argument), so test assertions focus
 * on the agent's return value and the recorded LLM calls. The clock is frozen
 * at a fixed instant so any timestamp reads remain stable across replays.
 *
 * Lives next to the agent code (not under runtime) because it is a test-only
 * convenience, but it is excluded from the build by the build tsconfig path
 * filter just like the test files themselves.
 *
 * @param llm  LlmClient implementation (typically the deterministic stub).
 * @param seed Seed for the RNG (defaults to a stable string).
 * @returns An AgentContext wired to the supplied LLM and a no-op logger.
 */
export function createTestContext(llm: LlmClient, seed: RngSeed = 'test-seed'): AgentContext {
  const config = loadConfig({});
  const clock = frozenClockAt('2026-05-07T14:00:00Z');
  const logger = createLogger({
    clock,
    level: config.logLevel,
    sink: () => {
      /* discard */
    },
  });
  const rng = createRng(seed);
  return { rng, clock, config, llm, logger };
}
