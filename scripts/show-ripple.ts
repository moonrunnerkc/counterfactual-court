/**
 * Phase 2C evidence script. Builds the import graph for the multi-file
 * fixture, computes the ripple set against fixtures/multi-file/patch.diff,
 * and prints both as JSON. Run with `pnpm tsx scripts/show-ripple.ts`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildImportGraph } from '../src/monorepo/import-graph.js';
import { computeRippleSet } from '../src/monorepo/impact-trace.js';

const fixtureRoot = resolve('fixtures/multi-file');
const files = [
  'src/math.ts',
  'src/index.ts',
  'src/calculator.ts',
  'src/cli.ts',
  'src/unrelated.ts',
];
const patch = readFileSync(resolve(fixtureRoot, 'patch.diff'), 'utf8');
const graph = buildImportGraph(fixtureRoot, files);
const rippleSet = computeRippleSet(graph, patch);
process.stdout.write(JSON.stringify({ graph, rippleSet }, null, 2) + '\n');
