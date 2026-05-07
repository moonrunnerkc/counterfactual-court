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
