import { extractMermaidBlocks, symbolsInBlock, type MermaidBlock } from './mermaid-extract.js';

/** A single divergence finding. */
export interface DiagramDivergence {
  /** Index of the source Mermaid block in the description. */
  blockIndex: number;
  /** Diagram kind for display. */
  kind: MermaidBlock['kind'];
  /** Symbols the diagram references that the diff does not touch. */
  diagramOnly: string[];
  /** Symbols the diff touches that the diagram does not reference. */
  diffOnly: string[];
  /** True when at least one of `diagramOnly`/`diffOnly` is non-empty. */
  diverges: boolean;
}

const IDENTIFIER_RE = /\b([A-Za-z_][A-Za-z0-9_]*)\b/gu;

/**
 * Pull a coarse identifier set from a unified-diff text. Looks at the
 * post-image lines so we can tell which symbols the patch introduces, edits,
 * or removes (the divergence detector compares this against diagram-mentioned
 * symbols). Filters out keywords and punctuation that match the regex but
 * aren't user identifiers.
 *
 * @param patchText Unified-diff text.
 * @returns Sorted, deduped identifier list.
 */
export function symbolsInPatch(patchText: string): string[] {
  const found = new Set<string>();
  for (const line of patchText.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    let m: RegExpExecArray | null;
    IDENTIFIER_RE.lastIndex = 0;
    while ((m = IDENTIFIER_RE.exec(line)) !== null) {
      const id = m[1];
      if (id !== undefined && !KEYWORDS.has(id) && id.length > 1) {
        found.add(id);
      }
    }
  }
  return [...found].sort();
}

const KEYWORDS = new Set<string>([
  'const',
  'let',
  'var',
  'function',
  'class',
  'interface',
  'type',
  'enum',
  'export',
  'import',
  'from',
  'as',
  'return',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'throw',
  'try',
  'catch',
  'finally',
  'new',
  'this',
  'super',
  'in',
  'of',
  'instanceof',
  'typeof',
  'true',
  'false',
  'null',
  'undefined',
  'void',
  'async',
  'await',
  'yield',
  'public',
  'private',
  'protected',
  'readonly',
  'static',
  'extends',
  'implements',
  'number',
  'string',
  'boolean',
  'any',
  'unknown',
  'never',
]);

/**
 * Compare every Mermaid block in the PR description against the diff text
 * and emit one {@link DiagramDivergence} per block. A block diverges when
 * either set of symbols (diagram-only / diff-only) is non-empty, intuitively:
 * "the diagram says X but the diff does Y."
 *
 * @param prDescription Markdown PR description.
 * @param patchText Unified-diff text.
 * @returns One divergence record per Mermaid block.
 */
export function detectDiagramDivergences(
  prDescription: string,
  patchText: string,
): DiagramDivergence[] {
  const blocks = extractMermaidBlocks(prDescription);
  const diffSymbols = new Set(symbolsInPatch(patchText));
  return blocks.map((block) => {
    const diagramSymbols = new Set(symbolsInBlock(block));
    const diagramOnly = [...diagramSymbols].filter((s) => !diffSymbols.has(s)).sort();
    const diffOnly = [...diffSymbols].filter((s) => !diagramSymbols.has(s)).sort();
    return {
      blockIndex: block.index,
      kind: block.kind,
      diagramOnly,
      diffOnly,
      diverges: diagramOnly.length > 0 || diffOnly.length > 0,
    };
  });
}
