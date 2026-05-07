import { describe, expect, it } from 'vitest';
import { extractMermaidBlocks, symbolsInBlock } from './mermaid-extract.js';

const SEQUENCE_DESCRIPTION = `# Add subtraction support

This PR introduces subtraction:

\`\`\`mermaid
sequenceDiagram
  Caller->>Calculator: calculate("sub", 5, 2)
  Calculator->>Math: sub(5, 2)
  Math-->>Calculator: 3
  Calculator-->>Caller: 3
\`\`\`

That is all.
`;

const DOUBLE_DIAGRAM = `${SEQUENCE_DESCRIPTION}

\`\`\`mermaid
flowchart TD
  Start --> add
  add --> Stop
\`\`\`
`;

describe('extractMermaidBlocks', () => {
  it('returns an empty list for prose with no fences', () => {
    expect(extractMermaidBlocks('# nothing to see\nplain text')).toEqual([]);
  });

  it('extracts a single mermaid block and detects its kind', () => {
    const blocks = extractMermaidBlocks(SEQUENCE_DESCRIPTION);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('sequenceDiagram');
    expect(blocks[0]!.body).toContain('Caller->>Calculator');
  });

  it('preserves source order and assigns sequential indexes for multiple blocks', () => {
    const blocks = extractMermaidBlocks(DOUBLE_DIAGRAM);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.index).toBe(0);
    expect(blocks[1]!.index).toBe(1);
    expect(blocks[1]!.kind).toBe('flowchart');
  });

  it('skips empty blocks', () => {
    const empty = '\n```mermaid\n\n```\n';
    expect(extractMermaidBlocks(empty)).toHaveLength(0);
  });
});

describe('symbolsInBlock', () => {
  it('extracts identifier-shaped symbols from a sequence diagram', () => {
    const [block] = extractMermaidBlocks(SEQUENCE_DESCRIPTION);
    const symbols = symbolsInBlock(block!);
    expect(symbols).toContain('calculate');
    expect(symbols).toContain('sub');
  });
});
