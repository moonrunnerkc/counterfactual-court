import { describe, expect, it } from 'vitest';
import { detectDiagramDivergences, symbolsInPatch } from './divergence.js';

const DIAGRAM_SAYS_SUB_DIFF_DOES_ADD = `# Misleading PR

\`\`\`mermaid
sequenceDiagram
  Caller->>Math: sub(a, b)
  Math-->>Caller: a - b
\`\`\`
`;

const DIFF_ADDS_FN_NOT_IN_DIAGRAM = `--- a/src/util.ts
+++ b/src/util.ts
@@
+export const add = (a: number, b: number): number => a + b;
`;

const ALIGNED_DIAGRAM = `# Honest PR

\`\`\`mermaid
sequenceDiagram
  Caller->>Math: add(a, b)
  Math-->>Caller: a + b
\`\`\`
`;

const ALIGNED_DIFF = `--- a/src/util.ts
+++ b/src/util.ts
@@
+export const add = (a: number, b: number): number => a + b;
`;

describe('symbolsInPatch', () => {
  it('extracts identifier-shaped symbols from added lines', () => {
    const symbols = symbolsInPatch(DIFF_ADDS_FN_NOT_IN_DIAGRAM);
    expect(symbols).toContain('add');
  });

  it('drops keywords like const, number, and export', () => {
    const symbols = symbolsInPatch(DIFF_ADDS_FN_NOT_IN_DIAGRAM);
    expect(symbols).not.toContain('const');
    expect(symbols).not.toContain('export');
    expect(symbols).not.toContain('number');
  });
});

describe('detectDiagramDivergences', () => {
  it('flags a divergence when the diagram says one thing and the diff does another', () => {
    const divergences = detectDiagramDivergences(
      DIAGRAM_SAYS_SUB_DIFF_DOES_ADD,
      DIFF_ADDS_FN_NOT_IN_DIAGRAM,
    );
    expect(divergences).toHaveLength(1);
    expect(divergences[0]!.diverges).toBe(true);
    expect(divergences[0]!.diagramOnly).toContain('sub');
    expect(divergences[0]!.diffOnly).toContain('add');
  });

  it('does not flag divergence when the diagram and diff agree on the load-bearing symbol', () => {
    const divergences = detectDiagramDivergences(ALIGNED_DIAGRAM, ALIGNED_DIFF);
    expect(divergences).toHaveLength(1);
    expect(divergences[0]!.diagramOnly).not.toContain('add');
    // Diff may have type-noise symbols; the assertion is that the diagram
    // symbol appears on the diff side, i.e. there is no diagram-only gap.
    expect(divergences[0]!.diagramOnly).toEqual([]);
  });

  it('returns an empty list when the description has no mermaid blocks', () => {
    expect(detectDiagramDivergences('plain prose', ALIGNED_DIFF)).toEqual([]);
  });
});
