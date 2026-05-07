import { contentHash } from '../runtime/canonical.js';
import { EvidenceGraphSchema, RawJuryGraphSchema, type RawJuryGraphValidated } from './schema.js';
import type {
  CitationNodePayload,
  EdgeRelation,
  EvidenceEdge,
  EvidenceGraph,
  EvidenceNode,
  ExhibitNodePayload,
  PrecedentNodePayload,
  RawJuryGraph,
  TestCaseNodePayload,
  VerdictNodePayload,
} from './graph.js';

/**
 * Compute the content-addressed id for a graph node. The hash spans
 * `{kind, payload}` so two payloads of different kinds with otherwise
 * identical fields still resolve to distinct ids.
 */
function nodeId(kind: EvidenceNode['kind'], payload: object): string {
  return contentHash({ kind, payload });
}

/** Return an empty {@link EvidenceGraph}. Pure. */
export function emptyGraph(): EvidenceGraph {
  return { nodes: [], edges: [], dissents: [] };
}

/**
 * Append a node to a graph if a node with the same content-addressed id is not
 * already present. Pure: returns a new graph and never mutates the input.
 *
 * @param graph   Source graph; left unchanged.
 * @param kind    Discriminator selecting the payload variant.
 * @param payload Payload fields for the node.
 * @returns New graph plus the node id (whether or not the node was new).
 */
export function addNode(
  graph: EvidenceGraph,
  kind: EvidenceNode['kind'],
  payload:
    | ExhibitNodePayload
    | CitationNodePayload
    | TestCaseNodePayload
    | PrecedentNodePayload
    | VerdictNodePayload,
): { readonly graph: EvidenceGraph; readonly nodeId: string } {
  const id = nodeId(kind, payload);
  const existing = graph.nodes.find((n) => n.id === id);
  if (existing !== undefined) {
    return { graph, nodeId: id };
  }
  const node = { id, kind, payload } as EvidenceNode;
  return {
    graph: { ...graph, nodes: [...graph.nodes, node] },
    nodeId: id,
  };
}

/**
 * Append an edge between two existing nodes. Pure: returns a new graph and
 * never mutates the input. Throws when either endpoint is unknown so a
 * dangling edge cannot enter the graph.
 *
 * @param graph    Source graph; left unchanged.
 * @param fromId   Content-addressed id of the source node.
 * @param toId     Content-addressed id of the destination node.
 * @param relation Edge relation kind.
 * @returns New graph with the edge appended.
 * @throws Error when either endpoint id is not present in `graph.nodes`.
 */
export function addEdge(
  graph: EvidenceGraph,
  fromId: string,
  toId: string,
  relation: EdgeRelation,
): EvidenceGraph {
  const haveFrom = graph.nodes.some((n) => n.id === fromId);
  const haveTo = graph.nodes.some((n) => n.id === toId);
  if (!haveFrom || !haveTo) {
    throw new Error(
      `evidence builder: cannot add edge ${fromId.slice(0, 12)} -> ${toId.slice(0, 12)} (${relation}); add both nodes before the edge`,
    );
  }
  const edge: EvidenceEdge = { fromId, toId, relation };
  return { ...graph, edges: [...graph.edges, edge] };
}

/**
 * Build a content-addressed {@link EvidenceGraph} from a {@link RawJuryGraph}
 * the Jury LLM emitted. Resolves the LLM's label-based edge references into
 * stable hash ids. Throws on dangling edge labels because those represent
 * malformed model output the bundle should never embed.
 *
 * @param raw Raw Jury graph parsed from model output.
 * @returns The built {@link EvidenceGraph}.
 * @throws Error when an edge references a label the raw graph did not declare.
 */
export function buildEvidenceGraph(raw: RawJuryGraph): EvidenceGraph {
  let graph = emptyGraph();
  const labelToId = new Map<string, string>();

  for (const exhibit of raw.exhibits) {
    const payload: ExhibitNodePayload = exhibit;
    const result = addNode(graph, 'exhibit', payload);
    graph = result.graph;
    labelToId.set(exhibit.label, result.nodeId);
  }
  for (const citation of raw.citations) {
    const { label, ...rest } = citation;
    const result = addNode(graph, 'citation', rest);
    graph = result.graph;
    labelToId.set(label, result.nodeId);
  }
  for (const testCase of raw.testCases) {
    const { label, ...rest } = testCase;
    const result = addNode(graph, 'test-case', rest);
    graph = result.graph;
    labelToId.set(label, result.nodeId);
  }
  for (const precedent of raw.precedents) {
    const { label, ...rest } = precedent;
    const result = addNode(graph, 'precedent', rest);
    graph = result.graph;
    labelToId.set(label, result.nodeId);
  }
  const { label: verdictLabel, ...verdictRest } = raw.verdict;
  const verdictResult = addNode(graph, 'verdict', verdictRest);
  graph = verdictResult.graph;
  labelToId.set(verdictLabel, verdictResult.nodeId);

  for (const edge of raw.edges) {
    const fromId = labelToId.get(edge.from);
    const toId = labelToId.get(edge.to);
    if (fromId === undefined || toId === undefined) {
      throw new Error(
        `evidence builder: edge references undeclared label (from="${edge.from}", to="${edge.to}"); the Jury must declare every node before referencing it`,
      );
    }
    graph = addEdge(graph, fromId, toId, edge.relation);
  }

  graph = { ...graph, dissents: raw.dissents };
  return graph;
}

/**
 * Validate a {@link RawJuryGraph} candidate against the zod schema. Returns
 * the validated value or throws with a precise message identifying the first
 * five offending paths.
 *
 * @param value  Candidate value, typically `JSON.parse(text)`.
 * @param caller Short label for the error message (e.g. "jury").
 * @returns The schema-validated raw graph.
 * @throws Error with all relevant zod issues when validation fails.
 */
export function parseRawJuryGraph(value: unknown, caller: string): RawJuryGraphValidated {
  const result = RawJuryGraphSchema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new Error(
      `${caller}: raw jury graph failed schema validation (${issues}); the Jury produced malformed output`,
    );
  }
  return result.data;
}

/**
 * Validate a content-addressed {@link EvidenceGraph} value (e.g. one read off
 * disk) against the zod schema. Returns the value or throws.
 *
 * @param value  Candidate value.
 * @param caller Short label for the error message.
 * @returns The validated graph.
 * @throws Error with the offending zod issues when validation fails.
 */
export function parseEvidenceGraph(value: unknown, caller: string): EvidenceGraph {
  const result = EvidenceGraphSchema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new Error(
      `${caller}: evidence graph failed schema validation (${issues}); the bundle is corrupted or from a future schema`,
    );
  }
  return result.data;
}
