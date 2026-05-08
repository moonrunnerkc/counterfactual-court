/**
 * Seed the local precedent ledger with a related prior verdict for the
 * Phase 2 final-acceptance e2e run. The seed entry is the existing
 * sample-patch verdict (also an arithmetic-operator inversion in a small
 * TypeScript module), so the multi-file-e2e patch (which inverts add/sub)
 * has at least one structurally similar precedent above the default 0.85
 * threshold.
 *
 * Run with `pnpm tsx scripts/seed-e2e-ledger.ts [<ledger-dir>]`. With no
 * argument the script writes to `~/.gemmacourt/ledger/`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { addLedgerEntry, openLedger } from '../src/precedent/ledger.js';

const SAMPLE_PATCH_BUNDLE =
  'bundles/236da0e43efbf4a88fd10366c29c25b6483c6ac7dc6177ef53937f4e10dff37b.verdict';

async function main(): Promise<void> {
  const ledgerDir = process.argv[2] ?? resolve(homedir(), '.gemmacourt', 'ledger');
  if (!existsSync(SAMPLE_PATCH_BUNDLE)) {
    throw new Error(
      `seed-e2e-ledger: source bundle ${SAMPLE_PATCH_BUNDLE} not found; run pnpm gemmacourt run --fixture sample-patch first`,
    );
  }
  const bundle = JSON.parse(readFileSync(SAMPLE_PATCH_BUNDLE, 'utf8')) as {
    body: {
      id: string;
      inputs: { patch: string };
      agents: { jury: { output: { verdict: 'approve' | 'reject' | 'request-changes' } } };
    };
  };
  const handle0 = openLedger(ledgerDir);
  const result = addLedgerEntry(
    handle0,
    bundle.body.inputs.patch,
    bundle.body.id,
    bundle.body.agents.jury.output.verdict,
    '2026-05-07T22:00:00.000Z',
  );
  process.stderr.write(
    `seeded ledger at ${ledgerDir} with entry ${result.entry.id.slice(0, 12)} (verdict=${bundle.body.agents.jury.output.verdict}); total entries: ${result.handle.entries.length}\n`,
  );
}

await main();
