import type { AgentContext } from './agent-context.js';
import { contentHash } from './canonical.js';
import type { LlmClient } from './llm-client.js';
import { createRecordingLlmClient, type RecordedLlmCall } from './recording-llm-client.js';
import type { RuntimeLock } from './runtime-lock.js';
import { prosecute } from '../agents/prosecutor.js';
import { defend } from '../agents/defender.js';
import { reportCourt, type PngAttachment } from '../agents/court-reporter.js';
import { deliberate } from '../agents/jury.js';
import type { BundleBody, BundleLlmCall } from './bundle-schema.js';
import type { PrecedentNodePayload } from '../evidence/graph.js';
import { addLedgerEntry, openLedger } from '../precedent/ledger.js';
import { queryPrecedents } from '../precedent/query.js';
import { type RippleSet, traceImpact } from '../monorepo/impact-trace.js';
import { type AllocationTrace, type ArmExecutor, runBanditLoop } from '../budget/orchestrator.js';

/** Inputs the orchestrator consumes; identical to the bundle's `inputs` block. */
export interface OrchestratorInputs {
  readonly fixture: string;
  readonly patch: string;
  readonly repoSnippet: string;
  readonly repoHead: string;
  readonly styleDocs: string;
  readonly attachments: readonly PngAttachment[];
  /**
   * Phase 2C inputs. When supplied (and `features.monorepoImpact` is on),
   * the orchestrator builds the ripple set against `monorepoFiles` rooted at
   * `monorepoRoot` and surfaces it to the Jury.
   */
  readonly monorepoRoot?: string;
  readonly monorepoFiles?: readonly string[];
  /**
   * Phase 2E. Optional Markdown PR description; the Court Reporter extracts
   * Mermaid blocks and surfaces them as exhibits, plus a divergence exhibit
   * when the diagram and diff disagree on symbols.
   */
  readonly prDescription?: string;
}

/** Dependencies the orchestrator needs to run an end-to-end pipeline. */
export interface OrchestratorDeps {
  /** AgentContext built by the caller. The orchestrator wraps `ctx.llm` for recording. */
  readonly ctx: AgentContext;
  /** Loaded runtime lock; copied verbatim into the bundle body. */
  readonly runtimeLock: RuntimeLock;
  /** Caller-supplied base seed string; embedded for audit and replay. */
  readonly baseSeed: string;
  /**
   * Phase 2D budget configuration. When supplied, the orchestrator runs a
   * UCB1 budget loop after the linear pipeline and embeds the allocation
   * trace into the bundle body. Absent on Phase 1 / linear runs so legacy
   * bundles stay bit-identical.
   */
  readonly budget?: { readonly budgetMs: number; readonly executor: ArmExecutor };
}

/** Result of a successful orchestrator run; ready to sign. */
export interface OrchestratorResult {
  readonly body: BundleBody;
}

/**
 * Pull the call at `idx` from `calls` and assert it exists. Used to convert
 * the recording wrapper's loose `RecordedLlmCall[]` into a definitively
 * typed reference without resorting to non-null assertions.
 */
function requireCall(calls: readonly RecordedLlmCall[], idx: number): RecordedLlmCall {
  const entry = calls[idx];
  if (entry === undefined) {
    throw new Error(
      `orchestrator: expected a recorded LLM call at index ${idx}; recorded ${calls.length}`,
    );
  }
  return entry;
}

/**
 * Convert one recorded LLM call into the bundle's typed audit record. Looks up
 * the model digest from the runtime lock; throws when the model was not pinned
 * because that violates the determinism contract (every call must use a model
 * present in runtime.lock.json).
 */
function toBundleCall(call: RecordedLlmCall, runtimeLock: RuntimeLock): BundleLlmCall {
  const pinned = runtimeLock.models[call.params.model];
  if (pinned === undefined) {
    throw new Error(
      `orchestrator: model ${call.params.model} is not pinned in runtime.lock.json; add a digest entry before running`,
    );
  }
  return {
    model: call.params.model,
    modelDigest: pinned.digest,
    promptHash: call.result.promptHash,
    responseHash: call.result.responseHash,
    seed: call.params.seed,
    prompt: call.params.prompt,
    system: call.params.system ?? '',
    response: call.result.text,
    temperature: call.params.temperature,
    topP: call.params.topP,
    topK: call.params.topK,
  };
}

const REPLAY_INSTRUCTIONS = [
  'To replay this bundle: `pnpm gemmacourt replay <path-to-bundle>`.',
  'Replay loads runtime.lock.json from the project root, refuses to run if Ollama version or model digests differ from the bundle, then re-invokes each agent with the recorded seeds and prompts and compares output hashes.',
  'Verify signature only (no LLM calls): `pnpm gemmacourt verify <path-to-bundle>`.',
].join(' ');

/**
 * Run the full Counterfactual Court pipeline against `inputs`, capture every
 * agent call into a typed bundle body, and return it. Caller signs and writes.
 *
 * @param inputs PR fixture inputs (patch, repo state, attachments, style docs).
 * @param deps   Agent context, runtime lock, and base seed.
 * @returns Bundle body ready to be signed and written.
 * @throws Error if a model used by an agent is not pinned in `runtime.lock.json`.
 */
export async function runCourt(
  inputs: OrchestratorInputs,
  deps: OrchestratorDeps,
): Promise<OrchestratorResult> {
  const recording = createRecordingLlmClient(deps.ctx.llm);
  const ctx: AgentContext = { ...deps.ctx, llm: recording };

  const prosecution = await prosecute({
    patch: inputs.patch,
    repoSnippet: inputs.repoSnippet,
    ctx,
  });
  const defense = await defend({ patch: inputs.patch, dossier: prosecution, ctx });
  const reporterInput = {
    attachments: inputs.attachments,
    ctx,
    ...(inputs.prDescription === undefined ? {} : { prDescription: inputs.prDescription }),
    ...(inputs.prDescription === undefined ? {} : { patch: inputs.patch }),
  };
  const reporterExhibits = await reportCourt(reporterInput);
  const precedents = ctx.config.features.precedent ? loadPrecedentsFor(ctx, inputs.patch) : [];
  const rippleSet = computeRippleIfRequested(ctx, inputs);
  const juryRippleField = rippleSet === null ? {} : { rippleSet };
  const jury = await deliberate({
    repoHead: inputs.repoHead,
    patch: inputs.patch,
    prosecution,
    defense,
    reporterExhibits,
    styleDocs: inputs.styleDocs,
    precedents,
    ...juryRippleField,
    ctx,
  });

  const calls = recording.calls;
  const expected = inputs.attachments.length === 0 ? 3 : 4;
  if (calls.length !== expected) {
    throw new Error(
      `orchestrator: expected ${expected} LLM calls, recorded ${calls.length}; agent layer changed without updating the orchestrator`,
    );
  }

  const prosecutorCall = requireCall(calls, 0);
  const defenderCall = requireCall(calls, 1);
  const reporterCall = inputs.attachments.length === 0 ? null : requireCall(calls, 2);
  const juryCall = requireCall(calls, calls.length - 1);

  let allocationTrace: AllocationTrace | null = null;
  if (deps.budget !== undefined) {
    const { trace } = await runBanditLoop({
      budgetMs: deps.budget.budgetMs,
      executor: deps.budget.executor,
    });
    allocationTrace = trace;
  }

  const id = contentHash({
    fixture: inputs.fixture,
    baseSeed: deps.baseSeed,
    prosecutionHash: prosecutorCall.result.responseHash,
    defenseHash: defenderCall.result.responseHash,
    reporterHash: reporterCall?.result.responseHash ?? null,
    juryHash: juryCall.result.responseHash,
    allocationTraceHash: allocationTrace === null ? null : contentHash(allocationTrace),
  });

  const body: BundleBody = {
    schemaVersion: '1',
    id,
    createdAt: ctx.clock.nowIso(),
    fixture: inputs.fixture,
    baseSeed: deps.baseSeed,
    runtime: deps.runtimeLock,
    inputs: {
      patch: inputs.patch,
      repoSnippet: inputs.repoSnippet,
      repoHead: inputs.repoHead,
      styleDocs: inputs.styleDocs,
      attachments: inputs.attachments.map((a) => ({ name: a.name, base64: a.base64 })),
    },
    agents: {
      prosecutor: {
        call: toBundleCall(prosecutorCall, deps.runtimeLock),
        output: prosecution,
      },
      defender: {
        call: toBundleCall(defenderCall, deps.runtimeLock),
        output: defense,
      },
      courtReporter: {
        call: reporterCall === null ? null : toBundleCall(reporterCall, deps.runtimeLock),
        output: reporterExhibits,
      },
      jury: {
        call: toBundleCall(juryCall, deps.runtimeLock),
        output: jury,
      },
    },
    ...(allocationTrace === null ? {} : { allocationTrace }),
    replayInstructions: REPLAY_INSTRUCTIONS,
  };

  if (ctx.config.features.precedent) {
    const ledger = openLedger(ctx.config.precedent.ledgerDir);
    addLedgerEntry(ledger, inputs.patch, body.id, jury.verdict, ctx.clock.nowIso());
  }

  return { body };
}

/**
 * Compute the Phase 2C ripple set when the feature is on and the inputs
 * supply a monorepo root and file list. Returns undefined otherwise so the
 * Jury prompt omits the impact block entirely (keeps the prompt byte-stable
 * for non-monorepo fixtures).
 */
function computeRippleIfRequested(ctx: AgentContext, inputs: OrchestratorInputs): RippleSet | null {
  if (!ctx.config.features.monorepoImpact) return null;
  if (inputs.monorepoRoot === undefined || inputs.monorepoFiles === undefined) return null;
  if (inputs.monorepoFiles.length === 0) return null;
  const { rippleSet } = traceImpact(inputs.monorepoRoot, inputs.monorepoFiles, inputs.patch);
  return rippleSet;
}

/**
 * Open the ledger and return the top-N precedents above the configured
 * similarity threshold. Returns an empty list when the ledger is empty so
 * the prompt builder can omit the precedent block entirely (keeps the
 * prompt byte-stable for runs that do not match any prior verdict).
 */
function loadPrecedentsFor(ctx: AgentContext, patch: string): readonly PrecedentNodePayload[] {
  const ledger = openLedger(ctx.config.precedent.ledgerDir);
  const matches = queryPrecedents(ledger, patch, {
    threshold: ctx.config.precedent.similarityThreshold,
    topN: ctx.config.precedent.topN,
  });
  return matches.map((m) => ({
    bundleId: m.entry.bundleId,
    similarity: m.similarity,
    justification: `Prior verdict ${m.entry.verdict} on a structurally similar patch (sim=${m.similarity.toFixed(3)}).`,
  }));
}

/** Provide an explicitly typed LlmClient surface for callers that build the ctx by hand. */
export type { LlmClient };
