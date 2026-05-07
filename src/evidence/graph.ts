import type { ExhibitKind, JuryDissent, Verdict } from './schema.js';

/**
 * Categorical node kinds the Jury can emit into the evidence graph. Adding a
 * variant is append-only: bundles in the wild reference these strings, and the
 * graph node id is content-addressed over the kind plus the payload, so a kind
 * rename retroactively invalidates every bundle that referenced it.
 */
export type NodeKind = 'exhibit' | 'citation' | 'test-case' | 'precedent' | 'verdict';

/**
 * Edge relations carried by the graph. `supports` and `refutes` are first-class
 * because they map onto the courtroom metaphor; `depends-on` records ordering
 * constraints between nodes (e.g. a citation a test case depends on).
 */
export type EdgeRelation = 'supports' | 'refutes' | 'depends-on';

/** Sub-agent that originally surfaced an exhibit; also covers Jury-introduced exhibits. */
export type ExhibitSource = 'prosecution' | 'defense' | 'reporter' | 'jury';

/** Payload variant for an exhibit node. */
export interface ExhibitNodePayload {
  source: ExhibitSource;
  label: string;
  claim: string;
  evidence: string;
  confidence: number;
  kind: ExhibitKind;
}

/** Payload variant for a citation (e.g. AGENTS.md, an RFC, a style guide line). */
export interface CitationNodePayload {
  reference: string;
  excerpt: string;
}

/** Payload variant for a Jury-imagined test case. */
export interface TestCaseNodePayload {
  description: string;
  expected: string;
  observed: string | null;
}

/** Payload variant for a precedent ledger lookup; populated by Phase 2B. */
export interface PrecedentNodePayload {
  bundleId: string;
  similarity: number;
  justification: string;
}

/** Payload variant for the (single) verdict node. */
export interface VerdictNodePayload {
  verdict: Verdict;
  confidence: number;
  summary: string;
}

/** Discriminated union over every node kind the graph can carry. */
export type EvidenceNode =
  | { id: string; kind: 'exhibit'; payload: ExhibitNodePayload }
  | { id: string; kind: 'citation'; payload: CitationNodePayload }
  | { id: string; kind: 'test-case'; payload: TestCaseNodePayload }
  | { id: string; kind: 'precedent'; payload: PrecedentNodePayload }
  | { id: string; kind: 'verdict'; payload: VerdictNodePayload };

/** A single edge between two content-addressed nodes. */
export interface EvidenceEdge {
  fromId: string;
  toId: string;
  relation: EdgeRelation;
}

/**
 * The evidence graph the Jury emits. Nodes are content-addressed by sha256
 * over their `{kind, payload}`, so two nodes with identical payloads share an
 * id and the builder dedupes on insert.
 *
 * Fields are not declared `readonly`: zod's inferred types are mutable and the
 * graph round-trips through the bundle's canonical JSON. Builder functions are
 * still pure by construction (they never assign in place); see
 * {@link ../evidence/builder.ts}.
 */
export interface EvidenceGraph {
  nodes: EvidenceNode[];
  edges: EvidenceEdge[];
  dissents: JuryDissent[];
}

/**
 * The Jury's primary structured output before content-addressing. The LLM
 * emits node payloads keyed by short string labels; the builder hashes the
 * payloads to produce stable ids and rewrites edges to use those ids.
 */
export interface RawJuryGraph {
  exhibits: ExhibitNodePayload[];
  citations: (CitationNodePayload & { label: string })[];
  testCases: (TestCaseNodePayload & { label: string })[];
  precedents: (PrecedentNodePayload & { label: string })[];
  verdict: VerdictNodePayload & { label: string };
  edges: { from: string; to: string; relation: EdgeRelation }[];
  dissents: JuryDissent[];
}
