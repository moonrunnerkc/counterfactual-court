/**
 * Phase 2G variance measurement. Replays a target bundle N times against the
 * configured Ollama runtime, records per-agent match/mismatch on every run,
 * and writes a JSON summary to stdout suitable for `docs/runtime-variance.md`.
 *
 * Run with `pnpm tsx scripts/measure-variance.ts <bundle-path> [--n 10]`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { resolve } from 'node:path';
import { loadRuntimeLock } from '../src/runtime/runtime-lock.js';
import {
  loadSignedBundle,
  replayBundle,
  type AgentReplayMatch,
} from '../src/runtime/bundle-replayer.js';
import { buildAgentContext, buildOllamaClient, loadConfig } from '../src/cli/build-context.js';

interface RunSummary {
  n: number;
  fullMatchCount: number;
  perAgentMismatchCount: Record<string, number>;
  observedDivergenceFractions: number[];
  recommendedTolerance: number;
  perRunHashes: { run: number; agents: AgentReplayMatch[] }[];
}

function parseN(): number {
  const argv = process.argv.slice(3);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--n' && i + 1 < argv.length) {
      const v = Number.parseInt(argv[i + 1] ?? '', 10);
      if (Number.isFinite(v) && v > 0) return v;
    }
  }
  return 10;
}

async function main(): Promise<void> {
  const bundlePath = process.argv[2];
  if (bundlePath === undefined || bundlePath.length === 0) {
    process.stderr.write('usage: measure-variance.ts <bundle-path> [--n 10]\n');
    process.exit(2);
  }
  const n = parseN();
  const config = loadConfig();
  const runtimeLock = loadRuntimeLock(config.runtimeLockPath);
  const bundle = loadSignedBundle(resolve(bundlePath));

  const summary: RunSummary = {
    n,
    fullMatchCount: 0,
    perAgentMismatchCount: { prosecutor: 0, defender: 0, courtReporter: 0, jury: 0 },
    observedDivergenceFractions: [],
    recommendedTolerance: 0,
    perRunHashes: [],
  };

  for (let i = 0; i < n; i++) {
    const llm = buildOllamaClient(config);
    const ctx = buildAgentContext({
      config,
      baseSeed: bundle.body.baseSeed,
      clockIso: bundle.body.createdAt,
      llm,
    });
    const report = await replayBundle({
      bundle,
      ctx,
      currentRuntimeLock: runtimeLock,
      tolerateHashMismatch: true,
      tolerateRuntimeDrift: true,
    });
    summary.observedDivergenceFractions.push(report.observedDivergenceFraction);
    if (report.agentMatches.every((m) => m.match)) summary.fullMatchCount++;
    for (const match of report.agentMatches) {
      if (!match.match) {
        summary.perAgentMismatchCount[match.agent] =
          (summary.perAgentMismatchCount[match.agent] ?? 0) + 1;
      }
    }
    summary.perRunHashes.push({ run: i + 1, agents: [...report.agentMatches] });
    process.stderr.write(
      `[${i + 1}/${n}] divergence=${report.observedDivergenceFraction.toFixed(3)} fullMatch=${report.fullMatch}\n`,
    );
  }

  summary.recommendedTolerance =
    summary.observedDivergenceFractions.length === 0
      ? 0
      : Math.max(...summary.observedDivergenceFractions);

  const meta = {
    bundleId: bundle.body.id,
    fixture: bundle.body.fixture,
    host: hostname(),
    home: homedir(),
    ollamaVersion: bundle.body.runtime.ollama.version,
    nodeVersion: bundle.body.runtime.node.version,
    capturedAt: new Date().toISOString(),
    summary,
  };
  process.stdout.write(JSON.stringify(meta, null, 2) + '\n');

  // Best-effort: write to a sidecar so the runtime-variance.md generator can pick it up.
  const out = resolve('docs', 'variance-' + bundle.body.id.slice(0, 12) + '.json');
  try {
    writeFileSync(out, JSON.stringify(meta, null, 2) + '\n', 'utf8');
    process.stderr.write(`wrote ${out}\n`);
  } catch (err) {
    process.stderr.write(
      `warn: failed to write sidecar (${err instanceof Error ? err.message : String(err)})\n`,
    );
  }
}

void main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(
      `measure-variance fatal: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  },
);

// Avoid unused-import warnings when running under ts-strict.
void execFileSync;
void readFileSync;
