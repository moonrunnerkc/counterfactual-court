import type { EvidenceGraph, EvidenceNode } from './graph.js';
import type { JuryOpinion } from './schema.js';

/**
 * Find the (single) verdict node in a graph. The Jury graph contract requires
 * exactly one node of kind `verdict`; producers that violate this contract
 * make the renderer throw rather than silently picking the first match.
 *
 * @param graph Graph to scan.
 * @returns The verdict node.
 * @throws Error if no verdict node exists or more than one is present.
 */
export function findVerdictNode(graph: EvidenceGraph): Extract<EvidenceNode, { kind: 'verdict' }> {
  const matches = graph.nodes.filter(
    (n): n is Extract<EvidenceNode, { kind: 'verdict' }> => n.kind === 'verdict',
  );
  if (matches.length === 0) {
    throw new Error(
      'evidence renderer: graph has no verdict node; the Jury must emit exactly one node of kind=verdict',
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `evidence renderer: graph has ${matches.length} verdict nodes; the Jury must emit exactly one`,
    );
  }
  const [first] = matches;
  if (first === undefined) {
    throw new Error(
      'evidence renderer: graph has no verdict node; the Jury must emit exactly one node of kind=verdict',
    );
  }
  return first;
}

/**
 * Collect every node connected to the given target id by an incoming
 * edge whose relation is in `relations`. Order matches the graph's edge
 * order so the output is stable across runs that built the graph the same way.
 */
function neighborsByIncomingRelation(
  graph: EvidenceGraph,
  targetId: string,
  relations: ReadonlySet<EvidenceGraph['edges'][number]['relation']>,
): readonly EvidenceNode[] {
  const ids: string[] = [];
  for (const edge of graph.edges) {
    if (edge.toId === targetId && relations.has(edge.relation)) {
      ids.push(edge.fromId);
    }
  }
  return ids
    .map((id) => graph.nodes.find((n) => n.id === id))
    .filter((n): n is EvidenceNode => n !== undefined);
}

function describeNode(node: EvidenceNode): string {
  switch (node.kind) {
    case 'exhibit':
      return `Exhibit (${node.payload.source}, ${node.payload.kind}): ${node.payload.claim}`;
    case 'citation':
      return `Citation (${node.payload.reference}): ${node.payload.excerpt}`;
    case 'test-case':
      return `Test case: ${node.payload.description} (expected ${node.payload.expected})`;
    case 'precedent':
      return `Precedent (${node.payload.bundleId}, sim=${node.payload.similarity.toFixed(2)}): ${node.payload.justification}`;
    case 'verdict':
      return `Verdict: ${node.payload.summary}`;
  }
}

/**
 * Derive a {@link JuryOpinion} from a content-addressed evidence graph. The
 * verdict node supplies the verdict, confidence, and a one-line summary; the
 * rationale paragraph is composed by walking the supports and refutes edges
 * incident to the verdict node in graph order. This is the load-bearing
 * inversion: prose comes from the graph, not the other way round.
 *
 * @param graph Graph the Jury emitted (validated against the schema).
 * @returns A {@link JuryOpinion} with the graph attached.
 * @throws Error when the graph has no or multiple verdict nodes.
 */
export function renderOpinionFromGraph(graph: EvidenceGraph): JuryOpinion {
  const verdictNode = findVerdictNode(graph);
  const supporters = neighborsByIncomingRelation(graph, verdictNode.id, new Set(['supports']));
  const refuters = neighborsByIncomingRelation(graph, verdictNode.id, new Set(['refutes']));

  const supportLines = supporters.map(describeNode);
  const refuteLines = refuters.map(describeNode);

  const rationaleSegments: string[] = [verdictNode.payload.summary];
  if (supportLines.length > 0) {
    rationaleSegments.push(`Supports: ${supportLines.join('; ')}`);
  }
  if (refuteLines.length > 0) {
    rationaleSegments.push(`Counter-arguments considered: ${refuteLines.join('; ')}`);
  }

  const rationale = rationaleSegments.join(' | ');
  const citedEvidenceIds = [...supporters.map((n) => n.id), ...refuters.map((n) => n.id)];

  return {
    verdict: verdictNode.payload.verdict,
    confidence: verdictNode.payload.confidence,
    rationale,
    citedEvidenceIds,
    dissents: [...graph.dissents],
    evidenceGraph: graph,
  };
}
