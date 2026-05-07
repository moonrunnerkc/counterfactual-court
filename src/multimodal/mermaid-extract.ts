/**
 * Extract Mermaid diagram blocks from a PR description (Markdown). Phase 2E
 * surfaces these to the Court Reporter so the Jury can cross-reference the
 * intended structure (the diagram) against the actual diff.
 *
 * Why parse text rather than render: the Phase 2E budget did not include a
 * headless-browser dependency for SVG rendering. Modern Gemma-4 multimodal
 * variants interpret Mermaid syntax directly, so the runtime forwards the
 * raw block as a textual exhibit. ADR-003-style note: a future phase can
 * substitute real renders without changing this surface.
 */

/** One extracted Mermaid block. */
export interface MermaidBlock {
  /** Diagram kind detected from the first non-whitespace token (best effort). */
  kind: 'sequenceDiagram' | 'classDiagram' | 'flowchart' | 'erDiagram' | 'stateDiagram' | 'unknown';
  /** Verbatim block body, sans the ```mermaid fences. */
  body: string;
  /** 0-based block index in the source description (insertion order). */
  index: number;
}

const FENCE_RE = /```mermaid\s*\r?\n([\s\S]*?)```/giu;

/**
 * Pull every fenced Mermaid block out of a Markdown text. Returns blocks in
 * source order. Empty strings or text without a Mermaid fence yield an empty
 * array.
 *
 * @param markdown PR description or any Markdown blob.
 * @returns Sorted list of {@link MermaidBlock}.
 */
export function extractMermaidBlocks(markdown: string): MermaidBlock[] {
  if (markdown.length === 0) return [];
  const blocks: MermaidBlock[] = [];
  // Reset lastIndex on each call so the regex is reusable.
  FENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = FENCE_RE.exec(markdown)) !== null) {
    const body = (match[1] ?? '').trim();
    if (body.length === 0) continue;
    blocks.push({ kind: detectKind(body), body, index });
    index += 1;
  }
  return blocks;
}

function detectKind(body: string): MermaidBlock['kind'] {
  const firstLine = body.split('\n')[0]?.trim().toLowerCase() ?? '';
  if (firstLine.startsWith('sequencediagram')) return 'sequenceDiagram';
  if (firstLine.startsWith('classdiagram')) return 'classDiagram';
  if (firstLine.startsWith('flowchart') || firstLine.startsWith('graph ')) return 'flowchart';
  if (firstLine.startsWith('erdiagram')) return 'erDiagram';
  if (firstLine.startsWith('statediagram')) return 'stateDiagram';
  return 'unknown';
}

/**
 * Pull function/method/class identifiers a Mermaid block references. Used by
 * the divergence detector to check whether the diagram mentions symbols the
 * diff does not touch (or vice versa). Heuristic: any token that looks like
 * an identifier followed by `(` or `.<id>` is treated as a symbol.
 *
 * @param block Mermaid block.
 * @returns Sorted, deduped symbol list.
 */
export function symbolsInBlock(block: MermaidBlock): string[] {
  const found = new Set<string>();
  const re = /\b([A-Za-z_][A-Za-z0-9_]*)\s*[(.]/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block.body)) !== null) {
    if (m[1] !== undefined) found.add(m[1]);
  }
  return [...found].sort();
}
