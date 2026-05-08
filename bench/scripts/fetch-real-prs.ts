/**
 * Phase 2F real-PR fetcher. Uses `gh api` (the GitHub CLI's authenticated REST
 * surface) to enumerate recent merged pull requests across a curated list of
 * permissively-licensed OSS repos, verifies each repo's license against the
 * accepted set, downloads the unified-diff patch for each PR, and writes the
 * accepted patches into `bench/real/`.
 *
 * Determinism: the repo list is a constant in this file. Within a repo, PRs
 * are pulled in `state=closed` `sort=updated` `direction=desc` order so two
 * runs against the same upstream state produce the same set of candidates.
 *
 * Run with `pnpm tsx bench/scripts/fetch-real-prs.ts [--target N] [--max-per-repo M]`.
 * Cached `.patch` and license JSON files land in `bench/cache/` (gitignored).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../../src/runtime/canonical.js';
import type { ManifestEntry, PermissiveLicense } from '../manifest-schema.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const benchRoot = resolve(moduleDir, '..');

/**
 * Curated repo list. Each entry is verified at fetch time against the GitHub
 * license API; any repo that no longer reports a permissive license is
 * skipped. Diversity across TS, JS, Python, Go, and Rust is intentional so
 * the bench is not language-monoculture.
 */
const REPOS: readonly { owner: string; repo: string }[] = [
  { owner: 'microsoft', repo: 'TypeScript' },
  { owner: 'vitejs', repo: 'vite' },
  { owner: 'prettier', repo: 'prettier' },
  { owner: 'eslint', repo: 'eslint' },
  { owner: 'jestjs', repo: 'jest' },
  { owner: 'expressjs', repo: 'express' },
  { owner: 'lodash', repo: 'lodash' },
  { owner: 'chalk', repo: 'chalk' },
  { owner: 'biomejs', repo: 'biome' },
  { owner: 'denoland', repo: 'deno' },
  { owner: 'facebook', repo: 'react' },
  { owner: 'vercel', repo: 'next.js' },
  { owner: 'colinhacks', repo: 'zod' },
  { owner: 'sindresorhus', repo: 'execa' },
  { owner: 'sindresorhus', repo: 'got' },
  { owner: 'pallets', repo: 'flask' },
  { owner: 'pallets', repo: 'click' },
  { owner: 'pytest-dev', repo: 'pytest' },
  { owner: 'psf', repo: 'requests' },
  { owner: 'tokio-rs', repo: 'tokio' },
  { owner: 'rust-lang', repo: 'cargo' },
  { owner: 'serde-rs', repo: 'serde' },
  { owner: 'spf13', repo: 'cobra' },
  { owner: 'gin-gonic', repo: 'gin' },
  { owner: 'urfave', repo: 'cli' },
];

const PERMISSIVE: ReadonlySet<string> = new Set([
  'mit',
  'apache-2.0',
  'bsd-2-clause',
  'bsd-3-clause',
  'isc',
  '0bsd',
]);

interface CliArgs {
  target: number;
  maxPerRepo: number;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  let target = 100;
  let maxPerRepo = 8;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target' && i + 1 < argv.length) {
      target = Number.parseInt(argv[i + 1] ?? '0', 10);
      i++;
    }
    if (argv[i] === '--max-per-repo' && i + 1 < argv.length) {
      maxPerRepo = Number.parseInt(argv[i + 1] ?? '0', 10);
      i++;
    }
  }
  return { target, maxPerRepo };
}

interface RepoLicense {
  ok: boolean;
  spdxId: PermissiveLicense | null;
}

function fetchRepoLicense(owner: string, repo: string): RepoLicense {
  const cachePath = resolve(benchRoot, 'cache', `license-${owner}-${repo}.json`);
  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as { spdx_id?: string };
    return classifyLicense(cached.spdx_id);
  }
  let raw: string;
  try {
    raw = execFileSync('gh', ['api', `repos/${owner}/${repo}/license`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return { ok: false, spdxId: null };
  }
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, raw, 'utf8');
  const parsed = JSON.parse(raw) as { license?: { spdx_id?: string } };
  return classifyLicense(parsed.license?.spdx_id);
}

function classifyLicense(spdxIdRaw: string | undefined): RepoLicense {
  const lower = (spdxIdRaw ?? '').toLowerCase();
  if (!PERMISSIVE.has(lower)) return { ok: false, spdxId: null };
  const map: Record<string, PermissiveLicense> = {
    mit: 'MIT',
    'apache-2.0': 'Apache-2.0',
    'bsd-2-clause': 'BSD-2-Clause',
    'bsd-3-clause': 'BSD-3-Clause',
    isc: 'ISC',
    '0bsd': '0BSD',
  };
  return { ok: true, spdxId: map[lower] ?? 'MIT' };
}

interface MergedPullSummary {
  number: number;
  title: string;
  url: string;
  diffUrl: string;
  patchUrl: string;
}

function listMergedPulls(owner: string, repo: string, max: number): MergedPullSummary[] {
  const cachePath = resolve(benchRoot, 'cache', `pulls-${owner}-${repo}.json`);
  let raw: string;
  if (existsSync(cachePath)) {
    raw = readFileSync(cachePath, 'utf8');
  } else {
    try {
      raw = execFileSync(
        'gh',
        [
          'api',
          `repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50`,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
      );
    } catch {
      return [];
    }
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, raw, 'utf8');
  }
  const list = JSON.parse(raw) as {
    number: number;
    title: string;
    html_url: string;
    diff_url: string;
    patch_url: string;
    merged_at: string | null;
  }[];
  return list
    .filter((p) => p.merged_at !== null)
    .slice(0, max)
    .map((p) => ({
      number: p.number,
      title: p.title,
      url: p.html_url,
      diffUrl: p.diff_url,
      patchUrl: p.patch_url,
    }));
}

function fetchPatch(owner: string, repo: string, pull: MergedPullSummary): string | null {
  const cachePath = resolve(benchRoot, 'cache', `patch-${owner}-${repo}-${pull.number}.patch`);
  if (existsSync(cachePath)) {
    return readFileSync(cachePath, 'utf8');
  }
  let body: string;
  try {
    body = execFileSync(
      'gh',
      [
        'api',
        '-H',
        'Accept: application/vnd.github.v3.patch',
        `repos/${owner}/${repo}/pulls/${pull.number}`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
    );
  } catch {
    return null;
  }
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, body, 'utf8');
  return body;
}

function countAddedLines(patch: string): number {
  let count = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) count++;
  }
  return count;
}

async function main(): Promise<void> {
  const args = parseArgs();
  mkdirSync(resolve(benchRoot, 'real'), { recursive: true });
  mkdirSync(resolve(benchRoot, 'cache'), { recursive: true });

  const accepted: ManifestEntry[] = [];
  for (const { owner, repo } of REPOS) {
    if (accepted.length >= args.target) break;
    const license = fetchRepoLicense(owner, repo);
    if (!license.ok || license.spdxId === null) {
      process.stderr.write(`skip ${owner}/${repo}: license not permissive\n`);
      continue;
    }
    const pulls = listMergedPulls(owner, repo, args.maxPerRepo * 3);
    let perRepoAdded = 0;
    for (const pull of pulls) {
      if (accepted.length >= args.target || perRepoAdded >= args.maxPerRepo) break;
      const patch = fetchPatch(owner, repo, pull);
      if (patch === null) continue;
      const added = countAddedLines(patch);
      if (added < 5 || added > 500) continue;
      const id = `${owner}-${repo}-pr${pull.number}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const patchPath = `real/${id}.patch`;
      const absPath = resolve(benchRoot, patchPath);
      writeFileSync(absPath, patch, 'utf8');
      const patchHash = sha256Hex(patch);
      accepted.push({
        id,
        patchPath,
        category: 'real-merged',
        expectedVerdict: 'approve',
        license: license.spdxId,
        source: {
          kind: 'real-pr',
          reference: pull.url,
          description: pull.title.slice(0, 240),
        },
        patchHash,
        linesAdded: added,
      });
      perRepoAdded++;
      process.stdout.write(`accepted ${id} (${added} lines)\n`);
    }
  }

  const outPath = resolve(benchRoot, 'cache', 'real-entries.json');
  writeFileSync(outPath, JSON.stringify(accepted, null, 2), 'utf8');
  process.stderr.write(`fetched ${accepted.length}/${args.target} real PRs into ${outPath}\n`);
}

await main();
