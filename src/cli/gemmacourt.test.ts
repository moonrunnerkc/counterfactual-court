import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main, PACKAGE_VERSION, USAGE } from './gemmacourt.js';

const here = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(here, '..', '..', 'package.json');
const declaredVersion = (JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string })
  .version;

describe('gemmacourt CLI', () => {
  it('exposes a PACKAGE_VERSION that matches package.json', () => {
    expect(PACKAGE_VERSION).toBe(declaredVersion);
  });

  it('prints the version and exits zero on --version', async () => {
    const result = await main(['--version']);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(declaredVersion);
    expect(result.stderr).toBe('');
  });

  it('prints usage on --help', async () => {
    const result = await main(['--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(USAGE);
    expect(result.stderr).toBe('');
  });

  it('prints usage when invoked with no arguments', async () => {
    const result = await main([]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(USAGE);
  });

  it('exits with code 2 and a usage-error message on unknown flags', async () => {
    const result = await main(['--bogus']);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--bogus');
    expect(result.stderr).toContain(USAGE);
  });

  it('rejects `run` invoked without --fixture', async () => {
    const result = await main(['run']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('--fixture');
  });

  it('rejects `replay` invoked without a bundle path', async () => {
    const result = await main(['replay']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('bundle path');
  });

  it('rejects `verify` invoked without a bundle path', async () => {
    const result = await main(['verify']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('bundle path');
  });

  it('rejects `replay --tolerance` with an out-of-range value (Phase 2G)', async () => {
    const result = await main(['replay', 'bundles/none.verdict', '--tolerance', '1.5']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('--tolerance must be a float in [0, 1]');
  });

  it('accepts `replay --tolerance` with a valid float (Phase 2G; downstream may still fail elsewhere)', async () => {
    // Bundle path is fake, so the replay will error on load, not on flag parsing.
    const result = await main(['replay', 'bundles/none.verdict', '--tolerance', '0.25']);
    // Exit code 1 (load failure), not 2 (flag-validation failure) - flag is accepted.
    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain('--tolerance must be a float');
  });
});
