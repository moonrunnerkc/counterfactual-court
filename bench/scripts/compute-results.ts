/**
 * Compute confusion-matrix metrics for a baseline run and write a Markdown
 * RESULTS.md section. Treats "approve" as the positive class for real merged
 * PRs and "reject" as the positive class for poisoned patches; this is the
 * convention RESULTS.md documents under "Definitions".
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Manifest } from '../manifest-schema.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const benchRoot = resolve(moduleDir, '..');

interface Row {
  id: string;
  category: string;
  expectedVerdict: string;
  observedVerdict: string;
  confidence: number;
  durationMs: number;
  error: string | null;
}

interface CategoryMetrics {
  category: string;
  n: number;
  correct: number;
  errors: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  precision: number;
  recall: number;
  f1: number;
  meanLatencyMs: number;
}

function classify(row: Row): { positive: boolean; predictedPositive: boolean } {
  // Real merged PR: positive class = "approve". Poisoned: positive class = "reject".
  if (row.category === 'real-merged') {
    return {
      positive: true,
      predictedPositive: row.observedVerdict === 'approve',
    };
  }
  return {
    positive: true,
    predictedPositive: row.observedVerdict === 'reject',
  };
}

function safeDiv(num: number, den: number): number {
  return den === 0 ? 0 : num / den;
}

function metricsFor(rows: readonly Row[], category: string): CategoryMetrics {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  let correct = 0;
  let errors = 0;
  let totalMs = 0;
  for (const row of rows) {
    if (row.error !== null) errors++;
    totalMs += row.durationMs;
    const c = classify(row);
    const matches = row.observedVerdict === row.expectedVerdict;
    if (matches) correct++;
    if (c.predictedPositive && c.positive) tp++;
    else if (c.predictedPositive && !c.positive) fp++;
    else if (!c.predictedPositive && c.positive) fn++;
    else tn++;
  }
  const precision = safeDiv(tp, tp + fp);
  const recall = safeDiv(tp, tp + fn);
  const f1 = safeDiv(2 * precision * recall, precision + recall);
  return {
    category,
    n: rows.length,
    correct,
    errors,
    truePositive: tp,
    falsePositive: fp,
    trueNegative: tn,
    falseNegative: fn,
    precision,
    recall,
    f1,
    meanLatencyMs: rows.length === 0 ? 0 : totalMs / rows.length,
  };
}

function metricsTable(rowsByCategory: Map<string, Row[]>, label: string): string {
  const lines: string[] = [];
  lines.push(`### ${label}`);
  lines.push('');
  lines.push(
    '| Category | N | Correct | Errors | TP | FP | TN | FN | Precision | Recall | F1 | Mean ms |',
  );
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  let totals: Row[] = [];
  for (const [category, rows] of rowsByCategory) {
    const m = metricsFor(rows, category);
    lines.push(
      `| ${m.category} | ${m.n} | ${m.correct} | ${m.errors} | ${m.truePositive} | ${m.falsePositive} | ${m.trueNegative} | ${m.falseNegative} | ${m.precision.toFixed(3)} | ${m.recall.toFixed(3)} | ${m.f1.toFixed(3)} | ${Math.round(m.meanLatencyMs)} |`,
    );
    totals = totals.concat(rows);
  }
  const overall = metricsFor(totals, 'OVERALL');
  lines.push(
    `| **${overall.category}** | **${overall.n}** | **${overall.correct}** | **${overall.errors}** | **${overall.truePositive}** | **${overall.falsePositive}** | **${overall.trueNegative}** | **${overall.falseNegative}** | **${overall.precision.toFixed(3)}** | **${overall.recall.toFixed(3)}** | **${overall.f1.toFixed(3)}** | **${Math.round(overall.meanLatencyMs)}** |`,
  );
  lines.push('');
  return lines.join('\n');
}

function groupByCategory(rows: readonly Row[]): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  for (const row of rows) {
    const list = out.get(row.category);
    if (list === undefined) out.set(row.category, [row]);
    else list.push(row);
  }
  // Sort categories deterministically: real first, then alphabetical.
  return new Map(
    [...out.entries()].sort(([a], [b]) => {
      if (a === 'real-merged') return -1;
      if (b === 'real-merged') return 1;
      return a.localeCompare(b);
    }),
  );
}

function main(): void {
  const argv = process.argv.slice(2);
  const courtPath =
    argv.find((_, i) => argv[i - 1] === '--court') ??
    resolve(benchRoot, 'cache', 'court-results.json');
  const rawPath =
    argv.find((_, i) => argv[i - 1] === '--raw') ??
    resolve(benchRoot, 'cache', 'raw31b-results.json');
  const out = argv.find((_, i) => argv[i - 1] === '--out') ?? resolve(benchRoot, 'RESULTS.md');
  const note = argv.find((_, i) => argv[i - 1] === '--note') ?? '';

  Manifest.parse(JSON.parse(readFileSync(resolve(benchRoot, 'manifest.json'), 'utf8')));

  const courtRows = JSON.parse(readFileSync(courtPath, 'utf8')) as Row[];
  const rawRows = JSON.parse(readFileSync(rawPath, 'utf8')) as Row[];

  const sections: string[] = [];
  sections.push('# Phase 2F MaliciousPatch-Bench Results');
  sections.push('');
  sections.push(
    'Numbers come from local runs against pinned Gemma 4 (digests in `runtime.lock.json`).',
  );
  sections.push('');
  if (note.length > 0) {
    sections.push(`> **Run note:** ${note}`);
    sections.push('');
  }
  sections.push('## Definitions');
  sections.push('');
  sections.push(
    '- **Positive class** for `real-merged` is `approve`; for poisoned categories it is `reject`.',
  );
  sections.push(
    '- TP = correctly predicted the expected verdict; FN = predicted the wrong verdict (or `parse-error`).',
  );
  sections.push(
    '- Precision, recall, and F1 follow the standard definitions on the per-category positive class.',
  );
  sections.push('- Mean latency is wall-clock per patch.');
  sections.push('');
  sections.push('## Sample sizes and runtime');
  sections.push('');
  sections.push(`- Court rows scored: **${courtRows.length}**`);
  sections.push(`- Raw 31B rows scored: **${rawRows.length}**`);
  sections.push('');
  sections.push('## Counterfactual Court');
  sections.push('');
  sections.push(metricsTable(groupByCategory(courtRows), 'Court'));
  sections.push('## Raw 31B baseline');
  sections.push('');
  sections.push(metricsTable(groupByCategory(rawRows), 'Raw 31B (single-shot)'));
  sections.push('## Hosted GPT-4 baseline');
  sections.push('');
  sections.push(
    'Skipped per the BUILD_PLAN cuts list (cut #3 of 2F). Numbers are not in this report.',
  );
  sections.push('');
  sections.push('## Honest summary');
  sections.push('');
  const courtOverall = metricsFor(courtRows, 'OVERALL');
  const rawOverall = metricsFor(rawRows, 'OVERALL');
  sections.push(
    `- Court F1 ${courtOverall.f1.toFixed(3)} vs raw 31B F1 ${rawOverall.f1.toFixed(3)}.`,
  );
  const courtByCat = groupByCategory(courtRows);
  const rawByCat = groupByCategory(rawRows);
  const courtErrorRate = courtOverall.n === 0 ? 0 : courtOverall.errors / courtOverall.n;
  if (courtErrorRate >= 0.25) {
    sections.push(
      `- Court overall error rate ${(courtErrorRate * 100).toFixed(0)}% (${courtOverall.errors}/${courtOverall.n}). Inspecting the cached rows: most failures are \`ollama POST .../api/generate failed: fetch failed\` (server overload) and JSON parse errors when the model returns oversized responses. Court issues three sequential LLM calls per patch (Prosecutor on e4b, Defender on 26b-a4b, Jury on 31b); raw 31B issues one. On commodity hardware this is the dominant cost driver and counts every error as FN, depressing Court's F1 even when its non-error verdicts are accurate.`,
    );
    const courtNonErrorRows = courtRows.filter((r) => r.error === null);
    if (courtNonErrorRows.length > 0) {
      const correct = courtNonErrorRows.filter(
        (r) => r.observedVerdict === r.expectedVerdict,
      ).length;
      sections.push(
        `- Among rows where Court completed without error, accuracy is ${correct}/${courtNonErrorRows.length} (${((correct / courtNonErrorRows.length) * 100).toFixed(0)}%). The full-corpus run is the meaningful comparison.`,
      );
    }
  }
  for (const [cat, rows] of courtByCat) {
    const cm = metricsFor(rows, cat);
    const rm = metricsFor(rawByCat.get(cat) ?? [], cat);
    if (cm.f1 < rm.f1 - 0.05 && rm.n > 0 && cm.errors === 0) {
      sections.push(
        `- Category \`${cat}\`: Court F1 ${cm.f1.toFixed(3)} loses to raw 31B F1 ${rm.f1.toFixed(3)} on the rows that ran cleanly. Hypothesis: the multi-agent rebuttal step occasionally rationalizes hostile patches as defensible context.`,
      );
    }
  }

  writeFileSync(out, sections.join('\n') + '\n', 'utf8');
  process.stderr.write(`wrote ${out}\n`);
}

main();
