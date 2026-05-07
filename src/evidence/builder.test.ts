import { describe, expect, it } from 'vitest';
import {
  addEdge,
  addNode,
  buildEvidenceGraph,
  emptyGraph,
  parseEvidenceGraph,
  parseRawJuryGraph,
} from './builder.js';
import type {
  CitationNodePayload,
  ExhibitNodePayload,
  RawJuryGraph,
  VerdictNodePayload,
} from './graph.js';

const exhibit: ExhibitNodePayload = {
  source: 'prosecution',
  label: 'p1',
  claim: 'Operator inverted',
  evidence: 'a - b',
  confidence: 0.9,
  kind: 'logic-error',
};

const citation: CitationNodePayload = {
  reference: 'STYLE_GUIDE.md#operators',
  excerpt: 'Arithmetic operators must match prior contracts.',
};

const verdict: VerdictNodePayload = {
  verdict: 'reject',
  confidence: 0.92,
  summary: 'Operator inversion breaks the documented contract.',
};

describe('emptyGraph', () => {
  it('returns a graph with empty arrays', () => {
    const graph = emptyGraph();
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.dissents).toEqual([]);
  });
});

describe('addNode', () => {
  it('appends a content-addressed node and never mutates the input', () => {
    const before = emptyGraph();
    const snapshot = JSON.stringify(before);
    const { graph: after, nodeId } = addNode(before, 'exhibit', exhibit);
    expect(nodeId).toMatch(/^[0-9a-f]{64}$/);
    expect(after.nodes).toHaveLength(1);
    expect(after.nodes[0]!.id).toBe(nodeId);
    expect(after.nodes[0]!.kind).toBe('exhibit');
    expect(after).not.toBe(before);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('dedupes nodes with identical payloads', () => {
    const a = addNode(emptyGraph(), 'exhibit', exhibit);
    const b = addNode(a.graph, 'exhibit', exhibit);
    expect(b.graph.nodes).toHaveLength(1);
    expect(b.nodeId).toBe(a.nodeId);
  });

  it('treats different kinds with the same payload shape as distinct ids', () => {
    const cite1: CitationNodePayload = {
      reference: 'identical',
      excerpt: 'identical',
    };
    const test1 = {
      description: 'identical',
      expected: 'identical',
      observed: null,
    };
    const a = addNode(emptyGraph(), 'citation', cite1);
    const b = addNode(a.graph, 'test-case', test1);
    expect(a.nodeId).not.toBe(b.nodeId);
  });
});

describe('addEdge', () => {
  it('appends an edge and never mutates the input', () => {
    const a = addNode(emptyGraph(), 'exhibit', exhibit);
    const b = addNode(a.graph, 'verdict', verdict);
    const before = b.graph;
    const snapshot = JSON.stringify(before);
    const after = addEdge(before, a.nodeId, b.nodeId, 'supports');
    expect(after.edges).toHaveLength(1);
    expect(after.edges[0]).toEqual({
      fromId: a.nodeId,
      toId: b.nodeId,
      relation: 'supports',
    });
    expect(after).not.toBe(before);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('refuses to add a dangling edge', () => {
    const a = addNode(emptyGraph(), 'exhibit', exhibit);
    expect(() => addEdge(a.graph, a.nodeId, 'unknown-id', 'supports')).toThrow(
      /add both nodes before the edge/,
    );
  });
});

describe('buildEvidenceGraph', () => {
  const raw: RawJuryGraph = {
    exhibits: [exhibit],
    citations: [{ ...citation, label: 'c1' }],
    testCases: [],
    precedents: [],
    verdict: { ...verdict, label: 'v1' },
    edges: [
      { from: 'p1', to: 'v1', relation: 'supports' },
      { from: 'c1', to: 'v1', relation: 'depends-on' },
    ],
    dissents: [],
  };

  it('builds a content-addressed graph from a raw Jury output', () => {
    const graph = buildEvidenceGraph(raw);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
    expect(graph.nodes.every((n) => /^[0-9a-f]{64}$/.test(n.id))).toBe(true);
  });

  it('throws when an edge references an undeclared label', () => {
    const broken: RawJuryGraph = {
      ...raw,
      edges: [{ from: 'ghost', to: 'v1', relation: 'supports' }],
    };
    expect(() => buildEvidenceGraph(broken)).toThrow(/undeclared label/);
  });
});

describe('parseRawJuryGraph', () => {
  it('rejects a payload with a missing required field', () => {
    expect(() =>
      parseRawJuryGraph(
        {
          exhibits: [],
          citations: [],
          testCases: [],
          precedents: [],
          verdict: { label: 'v1', verdict: 'approve' },
          edges: [],
          dissents: [],
        },
        'jury',
      ),
    ).toThrow(/raw jury graph failed schema validation/);
  });

  it('rejects an exhibit with confidence > 1', () => {
    expect(() =>
      parseRawJuryGraph(
        {
          exhibits: [{ ...exhibit, confidence: 2 }],
          citations: [],
          testCases: [],
          precedents: [],
          verdict: { ...verdict, label: 'v1' },
          edges: [],
          dissents: [],
        },
        'jury',
      ),
    ).toThrow(/raw jury graph failed schema validation/);
  });

  it('rejects an unknown verdict literal', () => {
    expect(() =>
      parseRawJuryGraph(
        {
          exhibits: [],
          citations: [],
          testCases: [],
          precedents: [],
          verdict: { ...verdict, label: 'v1', verdict: 'maybe' },
          edges: [],
          dissents: [],
        },
        'jury',
      ),
    ).toThrow(/raw jury graph failed schema validation/);
  });

  it('rejects an unknown edge relation', () => {
    expect(() =>
      parseRawJuryGraph(
        {
          exhibits: [exhibit],
          citations: [],
          testCases: [],
          precedents: [],
          verdict: { ...verdict, label: 'v1' },
          edges: [{ from: 'p1', to: 'v1', relation: 'sometimes' }],
          dissents: [],
        },
        'jury',
      ),
    ).toThrow(/raw jury graph failed schema validation/);
  });
});

describe('parseEvidenceGraph', () => {
  it('round-trips a built graph through the schema', () => {
    const graph = buildEvidenceGraph({
      exhibits: [exhibit],
      citations: [],
      testCases: [],
      precedents: [],
      verdict: { ...verdict, label: 'v1' },
      edges: [{ from: 'p1', to: 'v1', relation: 'supports' }],
      dissents: [],
    });
    const parsed = parseEvidenceGraph(JSON.parse(JSON.stringify(graph)), 'test');
    expect(parsed).toEqual(graph);
  });

  it('rejects a node with a non-sha256 id', () => {
    expect(() =>
      parseEvidenceGraph(
        {
          nodes: [{ id: 'short', kind: 'exhibit', payload: exhibit }],
          edges: [],
          dissents: [],
        },
        'test',
      ),
    ).toThrow(/evidence graph failed schema validation/);
  });
});
