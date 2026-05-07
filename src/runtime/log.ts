import type { Clock } from './clock.js';
import type { LogLevel } from './config.js';

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Structured logger. Every entry is a single JSON object on its own line
 * containing `ts`, `level`, `event`, plus any caller-supplied fields and
 * inherited child bindings. This is the only logger in the codebase: no
 * other module is permitted to call `console.*` or write to stdout/stderr
 * for diagnostic purposes.
 */
export interface Logger {
  /** Emit a debug-level event. Drops if `level` is above debug. */
  debug(event: string, fields?: Readonly<Record<string, unknown>>): void;
  /** Emit an info-level event. */
  info(event: string, fields?: Readonly<Record<string, unknown>>): void;
  /** Emit a warning event. */
  warn(event: string, fields?: Readonly<Record<string, unknown>>): void;
  /** Emit an error-level event. */
  error(event: string, fields?: Readonly<Record<string, unknown>>): void;
  /**
   * Return a derived logger that prepends `bindings` to every event's fields.
   * Useful for scoping a subtree of the run (e.g. `{ agent: 'prosecutor' }`).
   */
  child(bindings: Readonly<Record<string, unknown>>): Logger;
}

/** Constructor parameters for {@link createLogger}. */
export interface LoggerOptions {
  /** Clock used to stamp every entry's `ts` field. */
  readonly clock: Clock;
  /** Minimum severity to emit. Events below this rank are dropped. */
  readonly level: LogLevel;
  /** Sink invoked once per emitted entry with the serialized JSON line. */
  readonly sink: (line: string) => void;
  /** Optional bindings merged into every event before caller-supplied fields. */
  readonly bindings?: Readonly<Record<string, unknown>>;
}

/**
 * Build a structured logger from explicit dependencies. The sink is the only
 * destination; the runtime uses {@link stderrSink}, tests pass a buffer.
 *
 * @param opts Logger configuration: clock, level, sink, optional bindings.
 * @returns A {@link Logger} closing over the supplied dependencies.
 */
export function createLogger(opts: LoggerOptions): Logger {
  const { clock, level, sink } = opts;
  const minRank = LEVEL_RANK[level];
  const baseBindings: Readonly<Record<string, unknown>> = opts.bindings ?? {};

  function emit(
    eventLevel: LogLevel,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ): void {
    if (LEVEL_RANK[eventLevel] < minRank) return;
    const entry: Record<string, unknown> = {
      ts: clock.nowIso(),
      level: eventLevel,
      event,
      ...baseBindings,
      ...(fields ?? {}),
    };
    sink(JSON.stringify(entry));
  }

  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
    child: (bindings) =>
      createLogger({
        clock,
        level,
        sink,
        bindings: { ...baseBindings, ...bindings },
      }),
  };
}

/**
 * Default sink: append the line and a newline to fd 2 (stderr). Stdout is
 * reserved for tool-readable CLI output (bundle paths, etc.); diagnostic
 * logs always go to stderr so they do not corrupt that contract.
 *
 * @param line Serialized JSON line, without trailing newline.
 */
export function stderrSink(line: string): void {
  process.stderr.write(`${line}\n`);
}
