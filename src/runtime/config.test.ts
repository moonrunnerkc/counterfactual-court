import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('returns a frozen object with documented defaults when env is empty', () => {
    const cfg = loadConfig({});
    expect(cfg.ollamaUrl).toBe('http://localhost:11434');
    expect(cfg.bundlesDir).toBe(resolve('./bundles'));
    expect(cfg.logLevel).toBe('info');
    expect(cfg.runtimeLockPath).toBe(resolve('./runtime.lock.json'));
    expect(cfg.runTimestamp).toBeNull();
    expect(cfg.seed).toBeNull();
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  it('strips a trailing slash from the Ollama URL', () => {
    const cfg = loadConfig({ GEMMACOURT_OLLAMA_URL: 'http://example.test:11434/' });
    expect(cfg.ollamaUrl).toBe('http://example.test:11434');
  });

  it('accepts and resolves a custom bundles directory', () => {
    const cfg = loadConfig({ GEMMACOURT_BUNDLES_DIR: '/tmp/cc-bundles' });
    expect(cfg.bundlesDir).toBe('/tmp/cc-bundles');
  });

  it('parses a known log level', () => {
    expect(loadConfig({ GEMMACOURT_LOG_LEVEL: 'debug' }).logLevel).toBe('debug');
    expect(loadConfig({ GEMMACOURT_LOG_LEVEL: 'WARN' }).logLevel).toBe('warn');
  });

  it('rejects an unknown log level with an actionable message', () => {
    expect(() => loadConfig({ GEMMACOURT_LOG_LEVEL: 'screamy' })).toThrow(
      /GEMMACOURT_LOG_LEVEL must be one of/,
    );
  });

  it('passes runTimestamp and seed through verbatim when set', () => {
    const cfg = loadConfig({
      GEMMACOURT_RUN_TIMESTAMP: '2026-05-07T14:25:13.000Z',
      GEMMACOURT_SEED: '0xdeadbeef',
    });
    expect(cfg.runTimestamp).toBe('2026-05-07T14:25:13.000Z');
    expect(cfg.seed).toBe('0xdeadbeef');
  });

  it('throws on attempts to mutate a returned config (frozen)', () => {
    const cfg = loadConfig({});
    expect(() => {
      (cfg as unknown as Record<string, unknown>)['ollamaUrl'] = 'mutated';
    }).toThrow();
  });
});
