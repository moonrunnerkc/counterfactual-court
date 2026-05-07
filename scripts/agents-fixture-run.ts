/**
 * One-shot pipeline runner that exercises each Phase 1B agent against the
 * `fixtures/sample-patch` inputs using the deterministic stub LLM. Prints
 * the four agent outputs as JSON to stdout. Intended as a sanity check for
 * Phase 1B evidence collection; the real (Ollama-backed) end-to-end run
 * lands in Phase 1C via the bundle writer.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStubLlmClient } from '../src/runtime/llm-client-stub.js';
import { createTestContext } from '../src/agents/test-context.js';
import { prosecute } from '../src/agents/prosecutor.js';
import { defend } from '../src/agents/defender.js';
import { reportCourt } from '../src/agents/court-reporter.js';
import { deliberate } from '../src/agents/jury.js';
import type { LlmCallParams } from '../src/runtime/llm-client.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(here, '..', 'fixtures', 'sample-patch');
const patch = readFileSync(resolve(fixtureDir, 'patch.diff'), 'utf8');
const repoSnippet = readFileSync(resolve(fixtureDir, 'repo-snippet.ts'), 'utf8');

const PROSECUTION_RESPONSE = JSON.stringify({
  exhibits: [
    {
      id: 'p1',
      kind: 'logic-error',
      claim: 'add() now returns a - b instead of a + b',
      evidence: '+export const add = (a: number, b: number): number => a - b;',
      confidence: 0.99,
    },
  ],
  summary: 'The patch silently inverts the arithmetic operator on add().',
});

const DEFENSE_RESPONSE = JSON.stringify({
  rebuttals: [
    {
      exhibitId: 'p1',
      rebuttal:
        'No accompanying issue or commit message justifies the change. The allegation stands.',
      refutes: false,
      confidence: 0.2,
    },
  ],
  summary: 'No defense available without contextual justification for the operator change.',
});

const REPORTER_RESPONSE = JSON.stringify({ exhibits: [] });

const JURY_RESPONSE = JSON.stringify({
  verdict: 'reject',
  confidence: 0.95,
  rationale:
    'The patch silently inverts add() into subtraction, breaking every caller that relied on additive semantics. The Defender supplied no justification, so the allegation in p1 stands. Reject.',
  citedEvidenceIds: ['p1'],
  dissents: [],
});

function handle(params: LlmCallParams): string {
  if (params.model.startsWith('gemma4:e4b')) {
    if (params.prompt.includes('Attachments')) return REPORTER_RESPONSE;
    return PROSECUTION_RESPONSE;
  }
  if (params.model.startsWith('gemma4:26b')) return DEFENSE_RESPONSE;
  if (params.model.startsWith('gemma4:31b')) return JURY_RESPONSE;
  throw new Error(`unhandled model: ${params.model}`);
}

async function main(): Promise<void> {
  const llm = createStubLlmClient(handle);
  const ctx = createTestContext(llm, 'fixture-run');

  const prosecution = await prosecute({ patch, repoSnippet, ctx });
  const defense = await defend({ patch, dossier: prosecution, ctx });
  const reporterExhibits = await reportCourt({ attachments: [], ctx });
  const jury = await deliberate({
    repoHead: repoSnippet,
    patch,
    prosecution,
    defense,
    reporterExhibits,
    styleDocs: '# AGENTS.md\nFour agents argue and deliberate.\n',
    ctx,
  });

  process.stdout.write(
    JSON.stringify(
      {
        prosecution,
        defense,
        reporterExhibits,
        jury,
        seedTrace: llm.calls.map((c) => ({
          model: c.params.model,
          seed: c.params.seed,
          promptHash: c.result.promptHash,
          responseHash: c.result.responseHash,
        })),
      },
      null,
      2,
    ) + '\n',
  );
}

await main();
