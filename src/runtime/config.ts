import { resolve } from 'node:path';

/** Severity levels supported by the structured logger. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

/**
 * Frozen runtime configuration. Derived once at startup from the process
 * environment; the runtime contract forbids reading process.env anywhere
 * else, so every consumer takes a Config and never reaches behind it.
 */
export interface Config {
  /** Base URL for the Ollama HTTP API (no trailing slash). */
  readonly ollamaUrl: string;
  /** Directory where verdict bundles are written. */
  readonly bundlesDir: string;
  /** Logger threshold. Lower-severity events are dropped. */
  readonly logLevel: LogLevel;
  /** Absolute path to the runtime.lock.json containing pinned model digests. */
  readonly runtimeLockPath: string;
  /**
   * Optional ISO 8601 override for the frozen clock used in agent execution.
   * When unset, callers must supply a timestamp explicitly (typically the
   * bundle's own creation time), so this field is just a knob for tests and
   * deliberate replays.
   */
  readonly runTimestamp: string | null;
  /**
   * Optional seed override (decimal or hex string). Surface-level: agent code
   * derives per-agent seeds from this base via the deterministic RNG, so a
   * single env knob fully reproduces a run.
   */
  readonly seed: string | null;
  /**
   * Phase 2 feature flags. Each defaults off so the Phase 1 regression gate
   * (bit-identical replay of a Phase 1 bundle) cannot be disturbed by a
   * Phase 2 feature landing in the wrong run.
   */
  readonly features: {
    /** Phase 2A. When on, the Jury emits an evidence graph and the prose is derived from it. */
    readonly evidenceGraph: boolean;
    /** Phase 2B. When on, the orchestrator queries the precedent ledger and feeds top matches to the Jury. */
    readonly precedent: boolean;
    /** Phase 2C. When on, the orchestrator computes a ripple set and surfaces it to the Jury as a structured exhibit. */
    readonly monorepoImpact: boolean;
  };
  /** Phase 2B precedent ledger settings. */
  readonly precedent: {
    /** Absolute path to the ledger directory. */
    readonly ledgerDir: string;
    /** Similarity threshold in [0, 1]; entries below this are not surfaced. */
    readonly similarityThreshold: number;
    /** Maximum number of precedents to surface to the Jury per run. */
    readonly topN: number;
  };
}

/**
 * Read and validate `value` as a {@link LogLevel}, defaulting if absent.
 *
 * @param value Raw env string.
 * @param fallback Level to use when `value` is undefined or empty.
 * @returns A valid LogLevel.
 * @throws If `value` is non-empty but not one of the recognized levels.
 */
function parseLogLevel(value: string | undefined, fallback: LogLevel): LogLevel {
  if (value === undefined || value === '') return fallback;
  const lower = value.toLowerCase();
  if ((LOG_LEVELS as readonly string[]).includes(lower)) {
    return lower as LogLevel;
  }
  throw new Error(
    `GEMMACOURT_LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}; got "${value}"; correct the env or unset it`,
  );
}

/**
 * Strip a trailing slash from a URL so request paths can be appended without
 * worrying about doubles. We do not perform full URL validation here; bad
 * URLs surface as fetch errors with the offending value in the message.
 */
function normalizeOllamaUrl(value: string | undefined): string {
  const raw = value && value.length > 0 ? value : 'http://localhost:11434';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

/**
 * Load configuration once from the process environment, freeze it, and
 * return. The single approved entry point for environment access in this
 * codebase. Subsequent reads should hold onto the returned Config object;
 * re-invoking `loadConfig` is supported but produces a fresh frozen copy
 * that does not refresh values changed in-process.
 *
 * @param env Optional env override (used by tests). Defaults to process.env.
 * @returns Frozen Config.
 * @throws If GEMMACOURT_LOG_LEVEL is set to an unrecognized value.
 */
export function loadConfig(env: Readonly<NodeJS.ProcessEnv> = process.env): Config {
  const config: Config = {
    ollamaUrl: normalizeOllamaUrl(env['GEMMACOURT_OLLAMA_URL']),
    bundlesDir: resolve(
      env['GEMMACOURT_BUNDLES_DIR'] && env['GEMMACOURT_BUNDLES_DIR'].length > 0
        ? env['GEMMACOURT_BUNDLES_DIR']
        : './bundles',
    ),
    logLevel: parseLogLevel(env['GEMMACOURT_LOG_LEVEL'], 'info'),
    runtimeLockPath: resolve(
      env['GEMMACOURT_RUNTIME_LOCK'] && env['GEMMACOURT_RUNTIME_LOCK'].length > 0
        ? env['GEMMACOURT_RUNTIME_LOCK']
        : './runtime.lock.json',
    ),
    runTimestamp:
      env['GEMMACOURT_RUN_TIMESTAMP'] && env['GEMMACOURT_RUN_TIMESTAMP'].length > 0
        ? env['GEMMACOURT_RUN_TIMESTAMP']
        : null,
    seed:
      env['GEMMACOURT_SEED'] && env['GEMMACOURT_SEED'].length > 0 ? env['GEMMACOURT_SEED'] : null,
    features: Object.freeze({
      evidenceGraph: parseBoolFlag(env['GEMMACOURT_FEATURE_EVIDENCE_GRAPH']),
      precedent: parseBoolFlag(env['GEMMACOURT_FEATURE_PRECEDENT']),
      monorepoImpact: parseBoolFlag(env['GEMMACOURT_FEATURE_MONOREPO_IMPACT']),
    }),
    precedent: Object.freeze({
      ledgerDir: resolveLedgerDirEnv(env['GEMMACOURT_LEDGER_DIR'], env),
      similarityThreshold: parseThreshold(env['GEMMACOURT_PRECEDENT_THRESHOLD'], 0.85),
      topN: parsePositiveInt(env['GEMMACOURT_PRECEDENT_TOP_N'], 3),
    }),
  };
  return Object.freeze(config);
}

/** Resolve the ledger directory env var into an absolute path with a default. */
function resolveLedgerDirEnv(value: string | undefined, env: Readonly<NodeJS.ProcessEnv>): string {
  if (value !== undefined && value.length > 0) return resolve(value);
  const home = env['HOME'] ?? env['USERPROFILE'] ?? '.';
  return resolve(home, '.gemmacourt', 'ledger');
}

/** Parse a similarity threshold env var, falling back to `fallback`. */
function parseThreshold(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(
      `GEMMACOURT_PRECEDENT_THRESHOLD must be a number in [0, 1]; got "${value}"; correct the env or unset it`,
    );
  }
  return parsed;
}

/** Parse a positive-integer env var with a default. */
function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `precedent topN must be a positive integer; got "${value}"; correct the env or unset it`,
    );
  }
  return parsed;
}

/**
 * Parse a boolean feature-flag env var. `true`, `1`, and `yes` (case
 * insensitive) enable the flag; everything else disables it.
 */
function parseBoolFlag(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}
