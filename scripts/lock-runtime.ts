/**
 * lock-runtime
 *
 * Regenerate runtime.lock.json from the live Ollama instance.
 *
 * Reads the digest of each pinned Gemma 4 variant via the Ollama HTTP API,
 * captures the Ollama and Node versions, and writes a stable, sorted lock
 * file at the repo root. The bundle replayer reads this file and refuses to
 * run when any digest does not match.
 *
 * Run with: pnpm lock-runtime
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const lockPath = resolve(repoRoot, 'runtime.lock.json');

const PINNED_MODELS: readonly string[] = [
  'gemma4:e4b-it-q8_0',
  'gemma4:26b-a4b-it-q8_0',
  'gemma4:31b-it-q8_0',
];

const OLLAMA_HOST = process.env['OLLAMA_HOST'] ?? 'http://localhost:11434';
const OLLAMA_FETCH_TIMEOUT_MS = 15_000;

interface OllamaTagEntry {
  readonly name: string;
  readonly digest?: string;
}

interface OllamaTagsResponse {
  readonly models?: readonly OllamaTagEntry[];
}

interface RuntimeLock {
  readonly ollama: { readonly version: string };
  readonly node: { readonly version: string };
  readonly models: Readonly<Record<string, { readonly digest: string }>>;
  readonly generatedAt: string;
}

/**
 * Run a system command and return its trimmed stdout, throwing a helpful
 * error if the command is missing or exits non-zero.
 *
 * @param bin Executable name to run.
 * @param args Argument vector for the executable.
 * @returns Trimmed stdout from the command.
 * @throws If the command cannot be spawned or exits non-zero.
 */
function runCapture(bin: string, args: readonly string[]): string {
  try {
    return execFileSync(bin, args, { encoding: 'utf8' }).trim();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `failed to run \`${bin} ${args.join(' ')}\`: ${reason}; ensure ${bin} is installed and on PATH`,
    );
  }
}

/**
 * Resolve the Ollama daemon version by parsing `ollama --version`. Output
 * formats observed: `ollama version is 0.4.0`, `ollama version 0.4.0`, and
 * `client version is 0.4.0` (when the client is newer than the daemon).
 *
 * @returns A semver string with no `v` prefix.
 * @throws If the version cannot be parsed.
 */
function readOllamaVersion(): string {
  const raw = runCapture('ollama', ['--version']);
  const match = raw.match(/(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/);
  if (!match) {
    throw new Error(
      `could not parse ollama version from output: ${JSON.stringify(raw)}; expected a semver substring like 0.4.0`,
    );
  }
  return match[1] ?? '';
}

/**
 * Fetch the digest map for every model the local Ollama daemon currently
 * lists, via the GET /api/tags endpoint. The response carries the full
 * sha256 manifest digest per tag in this build of Ollama; older or newer
 * builds may use other endpoints, in which case this function should be
 * extended rather than papered over.
 *
 * @returns Map keyed by Ollama tag (e.g. `gemma4:e4b-it-q8_0`) with the
 *   raw hex digest string as the value.
 * @throws If the daemon is unreachable, returns non-2xx, or the payload
 *   contains zero models.
 */
async function fetchAllDigests(): Promise<Record<string, string>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: controller.signal });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const aborted = controller.signal.aborted;
    throw new Error(
      aborted
        ? `Ollama /api/tags did not respond within ${OLLAMA_FETCH_TIMEOUT_MS}ms at ${OLLAMA_HOST}; restart the daemon (kill 'ollama serve' and relaunch the menubar app) and retry`
        : `Ollama daemon unreachable at ${OLLAMA_HOST}: ${reason}; start it with 'ollama serve' and retry`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Ollama /api/tags returned HTTP ${response.status}: ${body || '(empty body)'}; check that the daemon is healthy`,
    );
  }
  const payload = (await response.json()) as OllamaTagsResponse;
  const models = payload.models ?? [];
  if (models.length === 0) {
    throw new Error(
      `Ollama /api/tags returned no models; pull the pinned variants with scripts/pull-models.sh and retry`,
    );
  }
  const map: Record<string, string> = {};
  for (const entry of models) {
    if (typeof entry.digest === 'string' && entry.digest.length > 0) {
      map[entry.name] = entry.digest;
    }
  }
  return map;
}

/**
 * Collect digests for all pinned models, formatted as `sha256:<hex>` so the
 * algorithm is explicit in the lock file, and emit a sorted-by-key map for
 * stable JSON output.
 *
 * @returns Map of model tag to `{ digest }` object, keys sorted lexicographically.
 * @throws If any pinned model is not present in the daemon's tag list.
 */
async function readAllDigests(): Promise<Record<string, { digest: string }>> {
  const allDigests = await fetchAllDigests();
  const entries = PINNED_MODELS.map((name) => {
    const raw = allDigests[name];
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new Error(
        `pinned model ${name} is not present in 'ollama list'; pull it with scripts/pull-models.sh and retry`,
      );
    }
    const digest = raw.startsWith('sha256:') ? raw : `sha256:${raw}`;
    return [name, { digest }] as const;
  });
  const sorted = [...entries].sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(sorted);
}

/**
 * Compose the runtime lock object and write it to disk as pretty JSON with a
 * trailing newline. Output keys are emitted in a fixed order to keep diffs
 * minimal across regenerations.
 *
 * @returns Resolves once the file is written.
 * @throws Propagates errors from version reads, digest fetches, or fs writes.
 */
export async function lockRuntime(): Promise<void> {
  const ollamaVersion = readOllamaVersion();
  const nodeVersion = process.versions.node;
  const models = await readAllDigests();

  const lock: RuntimeLock = {
    ollama: { version: ollamaVersion },
    node: { version: nodeVersion },
    models,
    generatedAt: new Date().toISOString(),
  };

  const serialized = `${JSON.stringify(lock, null, 2)}\n`;
  writeFileSync(lockPath, serialized, 'utf8');
  console.log(`wrote ${lockPath}`);
  for (const [name, info] of Object.entries(models)) {
    console.log(`  ${name}  ${info.digest}`);
  }
  console.log(`  ollama ${ollamaVersion}, node ${nodeVersion}`);
}

await lockRuntime();
