import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { buildImportGraph, transitiveImporters } from './import-graph.js';

const FIXTURE_ROOT = resolve(__dirname, '..', '..', 'fixtures', 'multi-file');
const FILES = [
  'src/math.ts',
  'src/index.ts',
  'src/calculator.ts',
  'src/cli.ts',
  'src/unrelated.ts',
];

describe('buildImportGraph', () => {
  it('lists every file as a node, sorted', () => {
    const g = buildImportGraph(FIXTURE_ROOT, FILES);
    expect(g.files).toEqual([...FILES].sort());
  });

  it('extracts a direct import edge from calculator.ts to math.ts', () => {
    const g = buildImportGraph(FIXTURE_ROOT, FILES);
    expect(g.edges).toContainEqual({
      from: 'src/calculator.ts',
      to: 'src/math.ts',
      kind: 'import',
    });
  });

  it('extracts a re-export edge from index.ts to math.ts', () => {
    const g = buildImportGraph(FIXTURE_ROOT, FILES);
    expect(g.edges).toContainEqual({
      from: 'src/index.ts',
      to: 'src/math.ts',
      kind: 'reexport',
    });
  });

  it('records both direct and through-barrel imports for cli.ts', () => {
    const g = buildImportGraph(FIXTURE_ROOT, FILES);
    const fromCli = g.edges.filter((e) => e.from === 'src/cli.ts');
    expect(fromCli).toHaveLength(2);
    expect(fromCli.map((e) => e.to).sort()).toEqual(['src/calculator.ts', 'src/index.ts']);
  });

  it('isolates unrelated.ts as a node with no incident edges', () => {
    const g = buildImportGraph(FIXTURE_ROOT, FILES);
    expect(g.edges.some((e) => e.from === 'src/unrelated.ts' || e.to === 'src/unrelated.ts')).toBe(
      false,
    );
  });
});

describe('transitiveImporters', () => {
  it('returns every direct and transitive importer of math.ts', () => {
    const g = buildImportGraph(FIXTURE_ROOT, FILES);
    const importers = transitiveImporters(g, 'src/math.ts');
    expect([...importers].sort()).toEqual(['src/calculator.ts', 'src/cli.ts', 'src/index.ts']);
  });

  it('returns the empty set for a file no one imports', () => {
    const g = buildImportGraph(FIXTURE_ROOT, FILES);
    expect(transitiveImporters(g, 'src/cli.ts').size).toBe(0);
  });
});
