import { z } from 'zod';
import type { AgentContext } from '../runtime/agent-context.js';
import { parseJsonResponse } from './parse-json-response.js';
import {
  JuryOpinion,
  RawJuryGraphSchema,
  type DefenseDossier,
  type ProsecutionDossier,
  type ReporterExhibits,
} from '../evidence/schema.js';

const JURY_OPINION_JSON_SCHEMA = z.toJSONSchema(JuryOpinion) as Record<string, unknown>;
const RAW_JURY_GRAPH_JSON_SCHEMA = z.toJSONSchema(RawJuryGraphSchema) as Record<string, unknown>;
import { buildEvidenceGraph, parseRawJuryGraph } from '../evidence/builder.js';
import { renderOpinionFromGraph } from '../evidence/render-opinion.js';
import type { PrecedentNodePayload, RawJuryGraph } from '../evidence/graph.js';
import { assertEveryPrecedentJustified } from '../precedent/justification.js';
import type { RippleSet } from '../monorepo/impact-trace.js';

/** Default Ollama tag for the Jury. 128k context, q8_0 quant. */
export const JURY_MODEL = 'gemma4:31b-it-q8_0';

const MAX_SEED = 2 ** 31 - 1;

const SYSTEM_PROMPT_LEGACY = `You are the Jury in Counterfactual Court, an offline PR review system.
You are the only agent that sees the whole picture. Your job is to weigh the Prosecutor's exhibits against the Defender's rebuttals, account for any Court Reporter exhibits, and consult the project's style and policy documents to render a verdict.
Return a single JSON object that conforms to this TypeScript type and nothing else:

interface JuryOpinion {
  verdict: "approve" | "reject" | "request-changes";
  confidence: number;        // 0..1
  rationale: string;         // one to three paragraphs explaining the verdict
  citedEvidenceIds: string[]; // exhibit ids you found load-bearing
  dissents: Array<{
    verdict: "approve" | "reject" | "request-changes";
    rationale: string;
  }>;
}

Rules:
- citedEvidenceIds must reference exhibit ids actually present in the inputs.
- A unanimous opinion has dissents: [].
- EVERY field listed in the type is required. A missing field invalidates the opinion. confidence is required even when low; pick a number between 0 and 1.
- Output JSON only, no Markdown, no commentary.`;

const SYSTEM_PROMPT_GRAPH = `You are the Jury in Counterfactual Court, an offline PR review system.
Your job is to emit a structured evidence graph that captures every load-bearing claim, citation, and counter-argument behind your verdict. The prose opinion is generated from this graph by the runtime; do not write the opinion separately.
Return a single JSON object that conforms to this TypeScript type and nothing else:

interface RawJuryGraph {
  exhibits: Array<{
    label: string;            // short id you will reuse in edges, e.g. "p1", "d3", "j1"
    source: "prosecution" | "defense" | "reporter" | "jury";
    claim: string;
    evidence: string;          // verbatim quote from the diff or repo
    confidence: number;        // 0..1
    kind: "logic-error" | "security-risk" | "test-weakening" | "style-violation" | "license-concern" | "documentation" | "multimodal-extraction" | "other";
  }>;
  citations: Array<{ label: string; reference: string; excerpt: string }>;
  testCases: Array<{ label: string; description: string; expected: string; observed: string | null }>;
  precedents: Array<{ label: string; bundleId: string; similarity: number; justification: string }>;
  verdict: { label: string; verdict: "approve" | "reject" | "request-changes"; confidence: number; summary: string };
  edges: Array<{ from: string; to: string; relation: "supports" | "refutes" | "depends-on" }>;
  dissents: Array<{ verdict: "approve" | "reject" | "request-changes"; rationale: string }>;
}

Rules:
- Every edge label (from, to) must match a label declared in exhibits, citations, testCases, precedents, or verdict.
- Each exhibit you reference from the Prosecutor or Defender input must reuse that input's exhibit id as its label.
- Use the verdict label as the destination of edges that support or refute the final verdict.
- Output JSON only, no Markdown, no commentary.`;

/**
 * Build the user-facing prompt for the Jury. Designed to fit a 128k window:
 * the repo HEAD snapshot is included verbatim, not summarized. Exposed for
 * tests so they can assert prompt stability across refactors.
 *
 * Precedent block is appended only when the orchestrator surfaced any. Empty
 * arrays are not embedded so the prompt remains byte-stable across runs that
 * happened to find no matches.
 *
 * @param input Jury input bundle.
 * @returns The prompt string sent verbatim to the LLM.
 */
export function buildJuryPrompt(input: {
  readonly repoHead: string;
  readonly patch: string;
  readonly prosecution: ProsecutionDossier;
  readonly defense: DefenseDossier;
  readonly reporterExhibits: ReporterExhibits;
  readonly styleDocs: string;
  readonly precedents?: readonly PrecedentNodePayload[];
  readonly rippleSet?: RippleSet;
}): string {
  const segments: string[] = [
    '## Repository HEAD snapshot',
    '',
    input.repoHead,
    '',
    '## Patch under review',
    '',
    input.patch,
    '',
    '## Prosecution dossier',
    '',
    JSON.stringify(input.prosecution, null, 2),
    '',
    '## Defense dossier',
    '',
    JSON.stringify(input.defense, null, 2),
    '',
    '## Court Reporter exhibits',
    '',
    JSON.stringify(input.reporterExhibits, null, 2),
    '',
    '## Style and policy docs',
    '',
    input.styleDocs,
  ];
  if (input.precedents !== undefined && input.precedents.length > 0) {
    segments.push(
      '',
      '## Precedents (top matches from the ledger)',
      '',
      'Each precedent is keyed by `bundleId`. If you cite a precedent in your graph (kind=precedent), you MUST also include at least one supports/depends-on edge from a citation, exhibit, or test-case node into that precedent. The runtime rejects unjustified precedents.',
      '',
      JSON.stringify(input.precedents, null, 2),
    );
  }
  if (input.rippleSet !== undefined && input.rippleSet.entries.length > 0) {
    segments.push(
      '',
      '## Monorepo impact (ripple set)',
      '',
      `The patch touches ${input.rippleSet.changedFiles.length} file(s). The following file(s) depend on the changed file(s) and may be affected. Cite affected files explicitly in your graph (citation nodes with reference="monorepo:<path>") when the change has non-trivial blast radius.`,
      '',
      JSON.stringify(input.rippleSet, null, 2),
    );
  }
  segments.push('', '## Task', '', 'Render the JuryOpinion JSON now.');
  return segments.join('\n');
}

/** Inputs accepted by {@link deliberate}. */
export interface JuryInput {
  /** Verbatim repo HEAD snapshot the Jury reads in full (no summarization). */
  readonly repoHead: string;
  /** Unified-diff text of the patch under review. */
  readonly patch: string;
  /** Prosecutor output. */
  readonly prosecution: ProsecutionDossier;
  /** Defender output. */
  readonly defense: DefenseDossier;
  /** Court Reporter output. */
  readonly reporterExhibits: ReporterExhibits;
  /** Concatenated AGENTS.md, CONTRIBUTING.md, STYLE_GUIDE.md. */
  readonly styleDocs: string;
  /**
   * Phase 2B precedents surfaced by the ledger (top-N above threshold).
   * Empty when the precedent feature is off or the ledger had no matches.
   */
  readonly precedents?: readonly PrecedentNodePayload[];
  /**
   * Phase 2C ripple set computed by the orchestrator. Absent when the
   * monorepo-impact feature is off or the patch lies outside the import
   * graph.
   */
  readonly rippleSet?: RippleSet;
  /** Caller-supplied context bundling rng, clock, llm, logger, config. */
  readonly ctx: AgentContext;
}

/**
 * Run the Jury agent. The only agent with the full picture: repo HEAD, both
 * dossiers, multimodal exhibits, style/policy docs.
 *
 * Dispatches by `ctx.config.features.evidenceGraph`: when off (the Phase 1
 * default), the Jury asks the LLM for a {@link JuryOpinion} directly. When on
 * (Phase 2A), the Jury asks for a raw evidence graph, builds a
 * content-addressed graph, and renders the prose opinion deterministically
 * from the graph.
 *
 * @param input Repo head, patch, both dossiers, reporter exhibits, style docs.
 * @returns A validated {@link JuryOpinion}; `evidenceGraph` is null on the
 *   legacy path and populated on the graph path.
 * @throws Error if the model output is not valid JSON or fails the schema.
 */
export async function deliberate(input: JuryInput): Promise<JuryOpinion> {
  const { ctx } = input;
  const log = ctx.logger.child({ agent: 'jury' });
  const seed = ctx.rng.nextInt(0, MAX_SEED);
  const prompt = buildJuryPrompt(input);
  const useGraph = ctx.config.features.evidenceGraph;
  log.info('agent.start', {
    model: JURY_MODEL,
    seed,
    mode: useGraph ? 'graph' : 'legacy',
    prosecutionExhibits: input.prosecution.exhibits.length,
    defenseRebuttals: input.defense.rebuttals.length,
    reporterExhibits: input.reporterExhibits.exhibits.length,
    promptBytes: prompt.length,
  });
  const result = await ctx.llm.call({
    model: JURY_MODEL,
    system: useGraph ? SYSTEM_PROMPT_GRAPH : SYSTEM_PROMPT_LEGACY,
    prompt,
    temperature: 0,
    topP: 0.95,
    topK: 40,
    seed,
    format: useGraph ? RAW_JURY_GRAPH_JSON_SCHEMA : JURY_OPINION_JSON_SCHEMA,
    keepAlive: '15m',
  });

  if (!useGraph) {
    const opinion = parseJsonResponse(result.text, JuryOpinion, 'jury');
    log.info('agent.done', {
      promptHash: result.promptHash,
      responseHash: result.responseHash,
      verdict: opinion.verdict,
      dissents: opinion.dissents.length,
      citations: opinion.citedEvidenceIds.length,
    });
    return opinion;
  }

  const raw = parseRawGraph(result.text);
  const graph = buildEvidenceGraph(raw);
  assertEveryPrecedentJustified(graph);
  const opinion = renderOpinionFromGraph(graph);
  log.info('agent.done', {
    promptHash: result.promptHash,
    responseHash: result.responseHash,
    verdict: opinion.verdict,
    dissents: opinion.dissents.length,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    citations: opinion.citedEvidenceIds.length,
  });
  return opinion;
}

/**
 * Parse the raw graph JSON the LLM produced. Surfaces both JSON and zod
 * errors with the `jury` caller tag so logs match the agent that emitted
 * them.
 */
function parseRawGraph(text: string): RawJuryGraph {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `jury: model output is not valid JSON (${reason}); the Jury must emit a single JSON object`,
    );
  }
  return parseRawJuryGraph(parsed, 'jury');
}

/** Re-export so callers can validate raw graphs without reaching into builder.ts. */
export { RawJuryGraphSchema };
