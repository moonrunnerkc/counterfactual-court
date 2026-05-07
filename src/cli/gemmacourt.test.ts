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
});
