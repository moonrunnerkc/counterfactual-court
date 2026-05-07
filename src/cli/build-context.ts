import type { AgentContext } from '../runtime/agent-context.js';
import { loadConfig, type Config } from '../runtime/config.js';
import { createRng, frozenClockAt, wallClock } from '../runtime/determinism.js';
import { createLogger, stderrSink } from '../runtime/log.js';
import { createOllamaLlmClient, type LlmClient } from '../runtime/llm-client.js';

/** Inputs to {@link buildAgentContext}. */
export interface BuildContextOptions {
  readonly config: Config;
  readonly baseSeed: string;
  readonly clockIso: string;
  readonly llm: LlmClient;
}

/**
 * Build the {@link AgentContext} the CLI hands to the orchestrator. Stays in
 * its own file so the bundle-writer subcommand and the bundle-replayer
 * subcommand share one construction path.
 *
 * @param opts Caller-supplied dependencies.
 * @returns A fully-wired AgentContext.
 */
export function buildAgentContext(opts: BuildContextOptions): AgentContext {
  const clock = frozenClockAt(opts.clockIso);
  const logger = createLogger({ clock, level: opts.config.logLevel, sink: stderrSink });
  const rng = createRng(opts.baseSeed);
  return { rng, clock, config: opts.config, llm: opts.llm, logger };
}

/**
 * Build the production Ollama-backed LLM client from a loaded config plus a
 * stderr-bound logger. Kept here so subcommands share one construction path
 * and so the construction is mockable in tests via dependency injection.
 *
 * @param config Loaded {@link Config}.
 * @returns An LLM client wired to `config.ollamaUrl`.
 */
export function buildOllamaClient(config: Config): LlmClient {
  const logger = createLogger({ clock: wallClock(), level: config.logLevel, sink: stderrSink });
  return createOllamaLlmClient({ baseUrl: config.ollamaUrl, logger });
}

/** Re-export so subcommands have a single import surface for config loading. */
export { loadConfig };
