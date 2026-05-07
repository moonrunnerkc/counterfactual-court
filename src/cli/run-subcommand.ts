import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCourt } from '../runtime/orchestrator.js';
import { writeSignedBundle } from '../runtime/bundle-writer.js';
import { loadRuntimeLock } from '../runtime/runtime-lock.js';
import type { LlmClient } from '../runtime/llm-client.js';
import type { Config } from '../runtime/config.js';
import type { EvidenceGraph } from '../evidence/graph.js';
import { buildAgentContext, buildOllamaClient, loadConfig } from './build-context.js';
import { loadFixture } from './load-fixture.js';

/** Inputs to {@link executeRun}. Allows tests to inject an LLM client. */
export interface RunOptions {
  readonly fixture: string;
  /** Optional override LLM client. Defaults to the production Ollama gateway. */
  readonly llm?: LlmClient;
  /** Optional project root override. Defaults to the package root. */
  readonly projectRoot?: string;
  /** Optional base seed override. Defaults to the run timestamp string. */
  readonly baseSeed?: string;
  /** Optional clock override. Defaults to the config's run timestamp or a new wall ISO string. */
  readonly clockIso?: string;
  /**
   * Phase 2A flag. When true, force-enables the evidence-graph feature for
   * this run regardless of the env config. Used by `--graph-only` so a
   * caller can request a graph without setting an env var first.
   */
  readonly forceEvidenceGraph?: boolean;
}

/** Result returned by {@link executeRun}. */
export interface RunOutcome {
  readonly bundlePath: string;
  readonly bundleId: string;
  /** Evidence graph emitted by the Jury, if the run produced one. */
  readonly evidenceGraph: EvidenceGraph | null;
}

const moduleDir = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the project root from this module's URL. Both the source layout
 * (`src/cli/...`) and the compiled layout (`dist/cli/...`) place this file
 * two directories below the package root.
 */
function defaultProjectRoot(): string {
  return resolve(moduleDir, '..', '..');
}

/**
 * Execute the `gemmacourt run` subcommand. Loads the fixture, runs the four
 * agents, signs the resulting bundle, and writes it to `<bundlesDir>/<id>.verdict`.
 *
 * @param opts Subcommand options.
 * @returns The path of the written bundle and its content-addressed id.
 * @throws Error on missing fixture, unpinned model, or LLM failure.
 */
export async function executeRun(opts: RunOptions): Promise<RunOutcome> {
  const projectRoot = opts.projectRoot ?? defaultProjectRoot();
  const baseConfig = loadConfig();
  const config: Config =
    opts.forceEvidenceGraph === true
      ? Object.freeze({
          ...baseConfig,
          features: Object.freeze({ ...baseConfig.features, evidenceGraph: true }),
        })
      : baseConfig;
  const runtimeLock = loadRuntimeLock(config.runtimeLockPath);
  const inputs = loadFixture(projectRoot, opts.fixture);
  const baseSeed = opts.baseSeed ?? config.seed ?? `run-${opts.fixture}`;
  const clockIso = opts.clockIso ?? config.runTimestamp ?? new Date().toISOString();
  const llm = opts.llm ?? buildOllamaClient(config);
  const ctx = buildAgentContext({ config, baseSeed, clockIso, llm });
  const { body } = await runCourt(inputs, { ctx, runtimeLock, baseSeed });
  const written = writeSignedBundle(body, baseSeed, config.bundlesDir);
  const evidenceGraph = body.agents.jury.output.evidenceGraph ?? null;
  return { bundlePath: written.path, bundleId: body.id, evidenceGraph };
}
