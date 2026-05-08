import { readFileSync } from 'node:fs';
import { canonicalJson } from './canonical.js';
import { SignedBundle, type BundleBody } from './bundle-schema.js';
import { verifyCanonical } from './signing.js';
import { diffRuntimeLocks, type RuntimeLock } from './runtime-lock.js';
import type { AgentContext } from './agent-context.js';
import { runCourt } from './orchestrator.js';
import type { PngAttachment } from '../agents/court-reporter.js';

/** Outcome of {@link verifyBundleSignature}. */
export interface SignatureCheck {
  readonly ok: boolean;
  /** Reason on failure. Empty when `ok` is true. */
  readonly reason: string;
}

/** Per-agent comparison result returned by {@link replayBundle}. */
export interface AgentReplayMatch {
  readonly agent: 'prosecutor' | 'defender' | 'courtReporter' | 'jury';
  readonly recordedHash: string;
  readonly replayHash: string;
  readonly match: boolean;
}

/** Outcome of a full replay run. */
export interface ReplayReport {
  readonly signatureOk: boolean;
  readonly runtimeDiffs: readonly string[];
  readonly agentMatches: readonly AgentReplayMatch[];
  readonly fullMatch: boolean;
  readonly toleranceApplied: boolean;
  /** Fraction of agents whose response hash diverged from the recorded one (0..1). */
  readonly observedDivergenceFraction: number;
  /** Numeric tolerance threshold the replay was scored against; null when unset. */
  readonly tolerance: number | null;
}

/**
 * Read a `.verdict` file from disk and zod-validate it. Does NOT verify the
 * signature; callers run {@link verifyBundleSignature} explicitly so the
 * caller controls the failure mode.
 *
 * @param path Absolute path to the bundle file.
 * @returns The parsed {@link SignedBundle}.
 * @throws Error if the file is missing, malformed, or fails schema validation.
 */
export function loadSignedBundle(path: string): SignedBundle {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `bundle-replayer: failed to read ${path}: ${reason}; verify the path and that the file exists`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `bundle-replayer: ${path} is not valid JSON (${reason}); the bundle is corrupted`,
    );
  }
  const result = SignedBundle.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new Error(
      `bundle-replayer: ${path} failed schema validation (${issues}); the bundle is corrupted or from a future schema`,
    );
  }
  return result.data;
}

/**
 * Verify the Ed25519 signature on a signed bundle. Returns a structured
 * outcome instead of throwing so the CLI's `verify` subcommand can decide
 * how to surface the result.
 *
 * @param bundle Bundle envelope to check.
 * @returns Whether the signature verifies and a reason string on failure.
 */
export function verifyBundleSignature(bundle: SignedBundle): SignatureCheck {
  if (bundle.signature.alg !== 'Ed25519') {
    return {
      ok: false,
      reason: `unexpected signature alg ${bundle.signature.alg}; expected Ed25519`,
    };
  }
  const canonical = canonicalJson(bundle.body);
  const sig = Buffer.from(bundle.signature.valueB64, 'base64');
  const pub = Buffer.from(bundle.signature.publicKeyB64, 'base64');
  if (sig.length !== 64) {
    return { ok: false, reason: `signature length ${sig.length} bytes; expected 64` };
  }
  if (pub.length !== 32) {
    return { ok: false, reason: `public key length ${pub.length} bytes; expected 32` };
  }
  const ok = verifyCanonical(Buffer.from(canonical, 'utf8'), sig, pub);
  return ok
    ? { ok: true, reason: '' }
    : {
        ok: false,
        reason: 'Ed25519 verification failed; bundle body or signature has been tampered with',
      };
}

/** Restore PNG attachments from the bundle's `inputs.attachments` block. */
function attachmentsFromBundle(body: BundleBody): readonly PngAttachment[] {
  return body.inputs.attachments.map((a) => ({ name: a.name, base64: a.base64 }));
}

/** Replay options. */
export interface ReplayOptions {
  /** Recorded bundle to compare against. */
  readonly bundle: SignedBundle;
  /** Agent context built by the caller (rng seeded from `bundle.body.baseSeed`). */
  readonly ctx: AgentContext;
  /** Current runtime lock loaded from disk at replay time. */
  readonly currentRuntimeLock: RuntimeLock;
  /**
   * When true, hash mismatches do not flip `fullMatch` to false. Used to
   * tolerate residual quantized-inference variance across hardware/drivers.
   * Defaults to false: replay is strict.
   */
  readonly tolerateHashMismatch?: boolean;
  /**
   * When true, runtime-lock differences (Ollama version, model digests) are
   * downgraded from a hard error to a soft mismatch on `fullMatch`. Defaults
   * to false: replay refuses to proceed when the runtime drifts.
   */
  readonly tolerateRuntimeDrift?: boolean;
  /**
   * Phase 2G numeric tolerance. Maximum fraction of agents (0..1) allowed to
   * diverge before {@link ReplayReport.fullMatch} flips to false. Default
   * undefined = strict (zero tolerance). Supersedes `tolerateHashMismatch`
   * when both are set; the boolean form remains for backward compatibility.
   */
  readonly tolerance?: number;
}

/**
 * Re-run the agents recorded in `bundle` and report whether the response
 * hashes match the recorded ones. Fails loudly on signature failure or
 * runtime mismatch by default; both can be downgraded via the tolerance
 * flags. The caller is responsible for configuring `ctx.llm` (real Ollama
 * for production replays, stub for integration tests).
 *
 * @param opts Replay options.
 * @returns A structured {@link ReplayReport}.
 * @throws Error when the signature fails to verify, or when the runtime lock
 *   diverges from the bundle's record and `tolerateRuntimeDrift` is false.
 */
export async function replayBundle(opts: ReplayOptions): Promise<ReplayReport> {
  const sig = verifyBundleSignature(opts.bundle);
  if (!sig.ok) {
    throw new Error(
      `bundle-replayer: signature check failed (${sig.reason}); refusing to replay a tampered bundle`,
    );
  }

  const runtimeDiffs = diffRuntimeLocks(opts.bundle.body.runtime, opts.currentRuntimeLock);
  if (runtimeDiffs.length > 0 && opts.tolerateRuntimeDrift !== true) {
    throw new Error(
      `bundle-replayer: runtime drift detected (${runtimeDiffs.join('; ')}); pin the recorded versions or pass tolerateRuntimeDrift=true`,
    );
  }

  const replay = await runCourt(
    {
      fixture: opts.bundle.body.fixture,
      patch: opts.bundle.body.inputs.patch,
      repoSnippet: opts.bundle.body.inputs.repoSnippet,
      repoHead: opts.bundle.body.inputs.repoHead,
      styleDocs: opts.bundle.body.inputs.styleDocs,
      attachments: attachmentsFromBundle(opts.bundle.body),
    },
    {
      ctx: opts.ctx,
      runtimeLock: opts.currentRuntimeLock,
      baseSeed: opts.bundle.body.baseSeed,
    },
  );

  const recorded = opts.bundle.body.agents;
  const agentMatches: AgentReplayMatch[] = [
    {
      agent: 'prosecutor',
      recordedHash: recorded.prosecutor.call.responseHash,
      replayHash: replay.body.agents.prosecutor.call.responseHash,
      match:
        recorded.prosecutor.call.responseHash === replay.body.agents.prosecutor.call.responseHash,
    },
    {
      agent: 'defender',
      recordedHash: recorded.defender.call.responseHash,
      replayHash: replay.body.agents.defender.call.responseHash,
      match: recorded.defender.call.responseHash === replay.body.agents.defender.call.responseHash,
    },
    {
      agent: 'courtReporter',
      recordedHash: recorded.courtReporter.call?.responseHash ?? '<no-call>',
      replayHash: replay.body.agents.courtReporter.call?.responseHash ?? '<no-call>',
      match:
        (recorded.courtReporter.call?.responseHash ?? '<no-call>') ===
        (replay.body.agents.courtReporter.call?.responseHash ?? '<no-call>'),
    },
    {
      agent: 'jury',
      recordedHash: recorded.jury.call.responseHash,
      replayHash: replay.body.agents.jury.call.responseHash,
      match: recorded.jury.call.responseHash === replay.body.agents.jury.call.responseHash,
    },
  ];

  const allHashesMatch = agentMatches.every((m) => m.match);
  const mismatchedAgents = agentMatches.filter((m) => !m.match).length;
  const observedDivergenceFraction =
    agentMatches.length === 0 ? 0 : mismatchedAgents / agentMatches.length;
  const tolerance = typeof opts.tolerance === 'number' ? opts.tolerance : null;
  const numericTolerancePasses = tolerance !== null && observedDivergenceFraction <= tolerance;
  const hashesPass = allHashesMatch || opts.tolerateHashMismatch === true || numericTolerancePasses;
  const fullMatch = sig.ok && runtimeDiffs.length === 0 && hashesPass;

  return {
    signatureOk: sig.ok,
    runtimeDiffs,
    agentMatches,
    fullMatch,
    toleranceApplied:
      (opts.tolerateHashMismatch === true && !allHashesMatch) ||
      (numericTolerancePasses && !allHashesMatch) ||
      (opts.tolerateRuntimeDrift === true && runtimeDiffs.length > 0),
    observedDivergenceFraction,
    tolerance,
  };
}

/**
 * Render an actionable digest-mismatch error message that names every
 * divergent agent and its recorded vs replay hash. Used by the CLI's
 * `replay` subcommand and by tests that exercise the loud-failure path.
 *
 * @param report Replay report.
 * @returns Multi-line error text; empty when the replay was bit-identical.
 */
export function renderDigestMismatchError(report: ReplayReport): string {
  const mismatches = report.agentMatches.filter((m) => !m.match);
  if (mismatches.length === 0) return '';
  const lines: string[] = [
    `replay: digest mismatch on ${mismatches.length}/${report.agentMatches.length} agent(s); observed divergence fraction ${report.observedDivergenceFraction.toFixed(3)}${report.tolerance !== null ? ` (tolerance ${report.tolerance.toFixed(3)})` : ''}`,
  ];
  for (const m of mismatches) {
    lines.push(`  ${m.agent}: recorded=${m.recordedHash} replay=${m.replayHash}`);
  }
  lines.push(
    'either re-record the bundle on this hardware or pass --tolerance <fraction> with a value at least equal to the observed divergence',
  );
  return lines.join('\n');
}
