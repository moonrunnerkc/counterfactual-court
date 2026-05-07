import type { AgentContext } from '../runtime/agent-context.js';
import { parseJsonResponse } from './parse-json-response.js';
import {
  JuryOpinion,
  type DefenseDossier,
  type ProsecutionDossier,
  type ReporterExhibits,
} from '../evidence/schema.js';

/** Default Ollama tag for the Jury. 128k context, q8_0 quant. */
export const JURY_MODEL = 'gemma4:31b-it-q8_0';

const MAX_SEED = 2 ** 31 - 1;

const SYSTEM_PROMPT = `You are the Jury in Counterfactual Court, an offline PR review system.
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

/**
 * Build the user-facing prompt for the Jury. Designed to fit a 128k window:
 * the repo HEAD snapshot is included verbatim, not summarized. Exposed for
 * tests so they can assert prompt stability across refactors.
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
}): string {
  return [
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
    '',
    '## Task',
    '',
    'Render the JuryOpinion JSON now.',
  ].join('\n');
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
  /** Concatenated AGENTS.md, CONTRIBUTING.md, STYLE_GUIDE.md, and any precedents. */
  readonly styleDocs: string;
  /** Caller-supplied context bundling rng, clock, llm, logger, config. */
  readonly ctx: AgentContext;
}

/**
 * Run the Jury agent. The only agent with the full picture: repo HEAD, both
 * dossiers, multimodal exhibits, style/policy docs.
 *
 * @param input Repo head, patch, both dossiers, reporter exhibits, style docs.
 * @returns A validated {@link JuryOpinion}.
 * @throws Error if the model output is not valid JSON or fails the schema.
 */
export async function deliberate(input: JuryInput): Promise<JuryOpinion> {
  const { ctx } = input;
  const log = ctx.logger.child({ agent: 'jury' });
  const seed = ctx.rng.nextInt(0, MAX_SEED);
  const prompt = buildJuryPrompt(input);
  log.info('agent.start', {
    model: JURY_MODEL,
    seed,
    prosecutionExhibits: input.prosecution.exhibits.length,
    defenseRebuttals: input.defense.rebuttals.length,
    reporterExhibits: input.reporterExhibits.exhibits.length,
    promptBytes: prompt.length,
  });
  const result = await ctx.llm.call({
    model: JURY_MODEL,
    system: SYSTEM_PROMPT,
    prompt,
    temperature: 0,
    topP: 0.95,
    topK: 40,
    seed,
  });
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
