/**
 * Phase 2E evidence script. Loads the diagram-mismatch fixture and prints
 * the divergence exhibit JSON the Court Reporter would emit. No LLM call.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectDiagramDivergences } from '../src/multimodal/divergence.js';

const fixtureRoot = resolve('fixtures/diagram-mismatch');
const patch = readFileSync(resolve(fixtureRoot, 'patch.diff'), 'utf8');
const description = readFileSync(resolve(fixtureRoot, 'pr-description.md'), 'utf8');
const divergences = detectDiagramDivergences(description, patch);
process.stdout.write(JSON.stringify(divergences, null, 2) + '\n');
