/**
 * Phase 2F Counterfactual Court baseline. Iterates the manifest, runs Court
 * with all Phase 2 features enabled (evidenceGraph + precedent ledger; ripple
 * tracing only when the patch ships with a monorepo), captures the verdict,
 * and writes per-row results to `bench/cache/court-results.json`.
 *
 * Long-running. Run with `pnpm tsx bench/scripts/run-court.ts [--limit N]
 * [--ledger <path>]`. Cached results are reused when --resume is set.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Manifest, type ManifestEntry } from '../manifest-schema.js';
import { runCourt } from '../../src/runtime/orchestrator.js';
import type { LlmClient } from '../../src/runtime/llm-client.js';
import { loadRuntimeLock } from '../../src/runtime/runtime-lock.js';
import { buildAgentContext, buildOllamaClient, loadConfig } from '../../src/cli/build-context.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const benchRoot = resolve(moduleDir, '..');
const projectRoot = resolve(benchRoot, '..');

interface CliArgs {
  limit: number;
  resume: boolean;
  outPath: string;
  categoryFilter: string | null;
  smoke: boolean;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  let limit = 0;
  let resume = false;
  let outPath = resolve(benchRoot, 'cache', 'court-results.json');
  let categoryFilter: string | null = null;
  let smoke = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit' && i + 1 < argv.length) {
      limit = Number.parseInt(argv[i + 1] ?? '0', 10);
      i++;
    } else if (argv[i] === '--resume') {
      resume = true;
    } else if (argv[i] === '--out' && i + 1 < argv.length) {
      outPath = resolve(argv[i + 1] ?? '');
      i++;
    } else if (argv[i] === '--category' && i + 1 < argv.length) {
      categoryFilter = argv[i + 1] ?? null;
      i++;
    } else if (argv[i] === '--smoke') {
      smoke = true;
    }
  }
  return { limit, resume, outPath, categoryFilter, smoke };
}

/**
 * Pick the deterministic smoke subset: the smallest real-merged PR plus the
 * smallest poisoned patch per category, biased toward shorter diffs so the
 * three sequential LLM calls per row remain tractable on commodity hardware.
 * Returns a 10-patch subset: 5 real + 1 per poisoned category.
 */
function smokeSubset(entries: ManifestEntry[]): ManifestEntry[] {
  const byCategory = new Map<string, ManifestEntry[]>();
  for (const entry of entries) {
    const list = byCategory.get(entry.category);
    if (list === undefined) byCategory.set(entry.category, [entry]);
    else list.push(entry);
  }
  for (const list of byCategory.values()) {
    list.sort((a, b) => a.linesAdded - b.linesAdded || a.id.localeCompare(b.id));
  }
  const real = (byCategory.get('real-merged') ?? []).slice(0, 5);
  const poisoned: ManifestEntry[] = [];
  for (const cat of [
    'logic-error',
    'security-vulnerability',
    'test-weakening',
    'prompt-injection',
    'license-laundering',
  ]) {
    const list = byCategory.get(cat) ?? [];
    const first = list[0];
    if (first !== undefined) poisoned.push(first);
  }
  return [...real, ...poisoned];
}

interface CourtRow {
  id: string;
  category: string;
  expectedVerdict: string;
  observedVerdict: string;
  confidence: number;
  durationMs: number;
  error: string | null;
}

async function runOne(entry: ManifestEntry, llmOverride?: LlmClient): Promise<CourtRow> {
  const start = Date.now();
  const patch = readFileSync(resolve(benchRoot, entry.patchPath), 'utf8');
  const baseConfig = loadConfig();
  const config = Object.freeze({
    ...baseConfig,
    features: Object.freeze({
      ...baseConfig.features,
      evidenceGraph: true,
      precedent: true,
    }),
  });
  const runtimeLock = loadRuntimeLock(config.runtimeLockPath);
  const llm = llmOverride ?? buildOllamaClient(config);
  const baseSeed = `bench-court-${entry.id}`;
  const ctx = buildAgentContext({
    config,
    baseSeed,
    clockIso: '2026-05-07T22:00:00.000Z',
    llm,
  });
  try {
    const { body } = await runCourt(
      {
        fixture: `bench-${entry.id}`,
        patch,
        repoSnippet: `// bench fixture: ${entry.id}\n// category: ${entry.category}\n`,
        repoHead: `// bench fixture: ${entry.id}\n`,
        styleDocs: '',
        attachments: [],
      },
      { ctx, runtimeLock, baseSeed },
    );
    return {
      id: entry.id,
      category: entry.category,
      expectedVerdict: entry.expectedVerdict,
      observedVerdict: body.agents.jury.output.verdict,
      confidence: body.agents.jury.output.confidence,
      durationMs: Date.now() - start,
      error: null,
    };
  } catch (err) {
    return {
      id: entry.id,
      category: entry.category,
      expectedVerdict: entry.expectedVerdict,
      observedVerdict: 'error',
      confidence: 0,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message.slice(0, 240) : String(err).slice(0, 240),
    };
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const manifest = Manifest.parse(
    JSON.parse(readFileSync(resolve(benchRoot, 'manifest.json'), 'utf8')),
  );
  let entries = manifest.entries;
  if (args.smoke) {
    entries = smokeSubset(entries);
  } else {
    if (args.categoryFilter !== null) {
      entries = entries.filter((e) => e.category === args.categoryFilter);
    }
    if (args.limit > 0) entries = entries.slice(0, args.limit);
  }

  mkdirSync(dirname(args.outPath), { recursive: true });
  let existing: CourtRow[] = [];
  if (args.resume && existsSync(args.outPath)) {
    existing = JSON.parse(readFileSync(args.outPath, 'utf8')) as CourtRow[];
  }
  const completed = new Set(existing.map((r) => r.id));
  const rows: CourtRow[] = [...existing];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === undefined) continue;
    if (completed.has(entry.id)) continue;
    process.stderr.write(`[${i + 1}/${entries.length}] ${entry.id} ... `);
    const row = await runOne(entry);
    rows.push(row);
    process.stderr.write(
      `${row.observedVerdict} in ${row.durationMs}ms${row.error === null ? '' : ` (error: ${row.error})`}\n`,
    );
    writeFileSync(args.outPath, JSON.stringify(rows, null, 2), 'utf8');
  }

  process.stderr.write(`court done: ${rows.length} rows -> ${args.outPath}\n`);
}

void main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(`run-court fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);

export { runOne };
export type { CourtRow };

void projectRoot;
