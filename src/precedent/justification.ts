import type { EvidenceGraph } from '../evidence/graph.js';

/** A single justification gap surfaced by {@link findUnjustifiedPrecedents}. */
export interface JustificationGap {
  readonly precedentId: string;
  readonly bundleId: string;
  readonly reason: string;
}

/**
 * Verify every precedent node in the evidence graph carries at least one
 * incoming `supports` or `depends-on` edge from a non-precedent node. The
 * Phase 2B contract is that the Jury cannot cite a precedent without
 * justifying it; absence of an incoming edge is the structural form of
 * "uncited reasoning."
 *
 * @param graph Validated evidence graph.
 * @returns A list of {@link JustificationGap}, empty when every precedent is
 *   justified by at least one supporting node.
 */
export function findUnjustifiedPrecedents(graph: EvidenceGraph): readonly JustificationGap[] {
  const gaps: JustificationGap[] = [];
  for (const node of graph.nodes) {
    if (node.kind !== 'precedent') continue;
    const supportingEdges = graph.edges.filter(
      (edge) =>
        edge.toId === node.id && (edge.relation === 'supports' || edge.relation === 'depends-on'),
    );
    const justifiers = supportingEdges
      .map((edge) => graph.nodes.find((n) => n.id === edge.fromId))
      .filter((n): n is NonNullable<typeof n> => n !== undefined && n.kind !== 'precedent');
    if (justifiers.length === 0) {
      gaps.push({
        precedentId: node.id,
        bundleId: node.payload.bundleId,
        reason: 'no incoming supports/depends-on edge from a non-precedent node',
      });
    }
  }
  return gaps;
}

/**
 * Throw when the graph contains any unjustified precedent. Used at the
 * orchestrator boundary so the bundle never embeds a cited-but-unjustified
 * precedent.
 *
 * @param graph Evidence graph to validate.
 * @throws Error with one line per gap when at least one precedent is unjustified.
 */
export function assertEveryPrecedentJustified(graph: EvidenceGraph): void {
  const gaps = findUnjustifiedPrecedents(graph);
  if (gaps.length === 0) return;
  const lines = gaps.map(
    (g) =>
      `precedent ${g.precedentId.slice(0, 12)} (bundle ${g.bundleId.slice(0, 12)}): ${g.reason}`,
  );
  throw new Error(
    `precedent justification: ${gaps.length} unjustified precedent${gaps.length === 1 ? '' : 's'} cited; the Jury must link each precedent to a supporting exhibit, citation, or test case\n${lines.join('\n')}`,
  );
}

/**
 * Strip unjustified precedent nodes (and any edges incident to them) from the
 * graph rather than throwing. Used by the Jury when the LLM cites a precedent
 * without linking justification: dropping the dangling precedent preserves
 * the rest of the verdict instead of failing the whole run. The orchestrator
 * still calls {@link assertEveryPrecedentJustified} after this pass, but the
 * assert is now an invariant check on a graph that has already been
 * sanitized.
 *
 * @param graph Evidence graph that may contain unjustified precedents.
 * @returns A graph with any unjustified precedents removed; original graph
 *   returned unchanged when there were no gaps.
 */
export function stripUnjustifiedPrecedents(graph: EvidenceGraph): {
  readonly graph: EvidenceGraph;
  readonly stripped: readonly JustificationGap[];
} {
  const gaps = findUnjustifiedPrecedents(graph);
  if (gaps.length === 0) return { graph, stripped: [] };
  const droppedIds = new Set(gaps.map((g) => g.precedentId));
  const filteredNodes = graph.nodes.filter((n) => !droppedIds.has(n.id));
  const filteredEdges = graph.edges.filter(
    (e) => !droppedIds.has(e.fromId) && !droppedIds.has(e.toId),
  );
  return {
    graph: { ...graph, nodes: filteredNodes, edges: filteredEdges },
    stripped: gaps,
  };
}
