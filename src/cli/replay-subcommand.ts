import { loadRuntimeLock } from '../runtime/runtime-lock.js';
import { loadSignedBundle, replayBundle, type ReplayReport } from '../runtime/bundle-replayer.js';
import type { LlmClient } from '../runtime/llm-client.js';
import { buildAgentContext, buildOllamaClient, loadConfig } from './build-context.js';

/**
 * Default replay tolerance, in [0, 1]. Phase 2G observed zero hash divergence
 * across 10 replays of the Phase 1 fixture on the developer machine, so the
 * default is 0 (strict). Operators on hardware with documented variance can
 * override per-run via `--tolerance <float>` or set
 * `GEMMACOURT_REPLAY_TOLERANCE` in the environment.
 */
export const DEFAULT_REPLAY_TOLERANCE = 0;

/** Options accepted by {@link executeReplay}. */
export interface ReplayOptions {
  readonly bundlePath: string;
  /** Optional LLM client. Defaults to production Ollama. */
  readonly llm?: LlmClient;
  /** Tolerate per-call hash mismatches (e.g. quantization variance). */
  readonly tolerateHashMismatch?: boolean;
  /** Tolerate runtime-lock drift. Default false (replay refuses on mismatch). */
  readonly tolerateRuntimeDrift?: boolean;
  /** Optional override for runtime.lock.json path. */
  readonly runtimeLockPath?: string;
  /** Phase 2G numeric tolerance in [0, 1]. */
  readonly tolerance?: number;
}

/** Result of {@link executeReplay}. */
export interface ReplayOutcome {
  readonly report: ReplayReport;
}

/**
 * Execute the `gemmacourt replay` subcommand. Loads the bundle, verifies its
 * signature, compares the bundle's recorded runtime against the current
 * runtime, then re-runs the four agents and reports per-agent hash matches.
 *
 * @param opts Subcommand options.
 * @returns A {@link ReplayReport}.
 * @throws Error on signature failure or runtime drift (unless tolerated).
 */
export async function executeReplay(opts: ReplayOptions): Promise<ReplayOutcome> {
  const config = loadConfig();
  const lockPath = opts.runtimeLockPath ?? config.runtimeLockPath;
  const currentRuntimeLock = loadRuntimeLock(lockPath);
  const bundle = loadSignedBundle(opts.bundlePath);
  const llm = opts.llm ?? buildOllamaClient(config);
  const ctx = buildAgentContext({
    config,
    baseSeed: bundle.body.baseSeed,
    clockIso: bundle.body.createdAt,
    llm,
  });
  const tolerance = opts.tolerance ?? DEFAULT_REPLAY_TOLERANCE;
  const report = await replayBundle({
    bundle,
    ctx,
    currentRuntimeLock,
    tolerateHashMismatch: opts.tolerateHashMismatch ?? false,
    tolerateRuntimeDrift: opts.tolerateRuntimeDrift ?? false,
    tolerance,
  });
  return { report };
}
