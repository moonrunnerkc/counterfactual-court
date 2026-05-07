#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { executeRun } from './run-subcommand.js';
import { executeReplay } from './replay-subcommand.js';
import { executeVerify } from './verify-subcommand.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));

/**
 * Read the package version from the project's package.json.
 *
 * Walks up two directories from this module's URL because both the source
 * layout (`src/cli/gemmacourt.ts`) and the compiled layout
 * (`dist/cli/gemmacourt.js`) place the file two levels below the package
 * root, so the same offset works at dev time and at runtime.
 *
 * @returns The semver string declared in package.json.
 * @throws If package.json cannot be read, parsed, or has no string `version`.
 */
function readPackageVersion(): string {
  const packageJsonPath = resolve(moduleDir, '..', '..', 'package.json');
  let raw: string;
  try {
    raw = readFileSync(packageJsonPath, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `failed to read package.json at ${packageJsonPath}: ${reason}; run from a built copy of the gemmacourt package`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `failed to parse package.json at ${packageJsonPath}: ${reason}; the manifest is malformed and must be repaired`,
    );
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('version' in parsed) ||
    typeof (parsed as { version: unknown }).version !== 'string'
  ) {
    throw new Error(
      `package.json at ${packageJsonPath} has no string "version" field; declare a semver version in the manifest`,
    );
  }
  return (parsed as { version: string }).version;
}

/** Package version, resolved at module load. */
export const PACKAGE_VERSION: string = readPackageVersion();

/** Usage text printed by `--help` and on argument errors. */
export const USAGE = `Usage: gemmacourt [--help] [--version] <command> [args]

Commands:
  run --fixture <name>          Run the four agents against fixtures/<name> and write a signed .verdict bundle.
  replay <bundle> [--tolerate-hash] [--tolerate-runtime]
                                Re-run a bundle and report whether the response hashes match the recorded ones.
  verify <bundle>               Verify the Ed25519 signature on a bundle. No LLM calls.

Flags:
  --help                        Show this usage message and exit.
  --version                     Print the package version and exit.
`;

/**
 * Outcome of evaluating CLI arguments.
 *
 * @property code   Exit code the host process should use.
 * @property stdout Text intended for stdout (may be empty).
 * @property stderr Text intended for stderr (may be empty).
 */
export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Locate the value associated with a flag in `argv`. Supports both
 * `--flag value` and `--flag=value` forms.
 *
 * @param argv Argument vector to scan.
 * @param flag Flag name including the leading dashes.
 * @returns The string value if found, otherwise null.
 */
function findFlagValue(argv: readonly string[], flag: string): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === flag) {
      const next = argv[i + 1];
      return next === undefined ? null : next;
    }
    if (arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
  }
  return null;
}

/**
 * Parse CLI arguments and dispatch to the appropriate subcommand. Returns
 * a {@link CliResult} so the caller controls process I/O. Subcommands that
 * need network or filesystem access return their result through the
 * `stdout`/`stderr` fields and a numeric exit code.
 *
 * @param argv Argument vector excluding the node executable and script path.
 * @returns The exit code plus stdout and stderr text.
 */
export async function main(argv: readonly string[]): Promise<CliResult> {
  if (argv.includes('--version')) {
    return { code: 0, stdout: `${PACKAGE_VERSION}\n`, stderr: '' };
  }
  if (argv.length === 0 || argv.includes('--help')) {
    return { code: 0, stdout: USAGE, stderr: '' };
  }

  const command = argv[0];
  const rest = argv.slice(1);

  if (command === 'run') {
    const fixture = findFlagValue(rest, '--fixture');
    if (fixture === null || fixture.length === 0) {
      return {
        code: 2,
        stdout: '',
        stderr: `gemmacourt run: --fixture <name> is required\n${USAGE}`,
      };
    }
    try {
      const outcome = await executeRun({ fixture });
      return {
        code: 0,
        stdout: `${outcome.bundlePath}\n`,
        stderr: `wrote bundle ${outcome.bundleId}\n`,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { code: 1, stdout: '', stderr: `gemmacourt run failed: ${reason}\n` };
    }
  }

  if (command === 'replay') {
    const bundlePath = rest[0];
    if (bundlePath === undefined || bundlePath.startsWith('--')) {
      return {
        code: 2,
        stdout: '',
        stderr: `gemmacourt replay: <bundle path> is required\n${USAGE}`,
      };
    }
    const tolerateHash = rest.includes('--tolerate-hash');
    const tolerateRuntime = rest.includes('--tolerate-runtime');
    try {
      const { report } = await executeReplay({
        bundlePath,
        tolerateHashMismatch: tolerateHash,
        tolerateRuntimeDrift: tolerateRuntime,
      });
      const lines = report.agentMatches.map(
        (m) =>
          `${m.agent}: ${m.match ? 'match' : 'mismatch'} (recorded=${m.recordedHash} replay=${m.replayHash})`,
      );
      const summary = report.fullMatch ? 'replay: bit-identical' : 'replay: divergence detected';
      return {
        code: report.fullMatch ? 0 : 1,
        stdout: `${summary}\n${lines.join('\n')}\n`,
        stderr: '',
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { code: 1, stdout: '', stderr: `gemmacourt replay failed: ${reason}\n` };
    }
  }

  if (command === 'verify') {
    const bundlePath = rest[0];
    if (bundlePath === undefined) {
      return {
        code: 2,
        stdout: '',
        stderr: `gemmacourt verify: <bundle path> is required\n${USAGE}`,
      };
    }
    try {
      const outcome = executeVerify(bundlePath);
      if (outcome.signatureOk) {
        return {
          code: 0,
          stdout: `signature OK for bundle ${outcome.bundleId}\n`,
          stderr: '',
        };
      }
      return {
        code: 1,
        stdout: '',
        stderr: `signature FAILED for bundle ${outcome.bundleId}: ${outcome.reason}\n`,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { code: 1, stdout: '', stderr: `gemmacourt verify failed: ${reason}\n` };
    }
  }

  return {
    code: 2,
    stdout: '',
    stderr: `gemmacourt: unrecognized arguments: ${argv.join(' ')}\n${USAGE}`,
  };
}

/**
 * Run the CLI and write its output to the host process.
 *
 * @param argv Argument vector (typically `process.argv.slice(2)`).
 * @returns The exit code the host process should use.
 */
export async function runCli(argv: readonly string[]): Promise<number> {
  const result = await main(argv);
  if (result.stdout.length > 0) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr.length > 0) {
    process.stderr.write(result.stderr);
  }
  return result.code;
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  process.exit(await runCli(process.argv.slice(2)));
}
