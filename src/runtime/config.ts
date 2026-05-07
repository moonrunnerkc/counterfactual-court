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
  };
  return Object.freeze(config);
}
