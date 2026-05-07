import { describe, expect, it } from 'vitest';
import { addEdge, addNode, emptyGraph } from './builder.js';
import { findVerdictNode, renderOpinionFromGraph } from './render-opinion.js';
import type { EvidenceGraph } from './graph.js';

function fixtureGraph(): EvidenceGraph {
  let g = emptyGraph();
  const a = addNode(g, 'exhibit', {
    source: 'prosecution',
    label: 'p1',
    claim: 'Operator inverted',
    evidence: 'a - b',
    confidence: 0.9,
    kind: 'logic-error',
  });
  g = a.graph;
  const b = addNode(g, 'verdict', {
    verdict: 'reject',
    confidence: 0.92,
    summary: 'Operator inversion breaks the contract.',
  });
  g = b.graph;
  g = addEdge(g, a.nodeId, b.nodeId, 'supports');
  return g;
}

describe('findVerdictNode', () => {
  it('returns the single verdict node', () => {
    const node = findVerdictNode(fixtureGraph());
    expect(node.kind).toBe('verdict');
    expect(node.payload.verdict).toBe('reject');
  });

  it('throws when no verdict node exists', () => {
    expect(() => findVerdictNode(emptyGraph())).toThrow(/no verdict node/);
  });

  it('throws when more than one verdict node exists', () => {
    let g = emptyGraph();
    const a = addNode(g, 'verdict', {
      verdict: 'approve',
      confidence: 0.9,
      summary: 'Looks good.',
    });
    g = a.graph;
    const b = addNode(g, 'verdict', {
      verdict: 'reject',
      confidence: 0.9,
      summary: 'Looks bad.',
    });
    expect(() => findVerdictNode(b.graph)).toThrow(/2 verdict nodes/);
  });
});

describe('renderOpinionFromGraph', () => {
  it('derives verdict, confidence, rationale, and citations from the graph', () => {
    const opinion = renderOpinionFromGraph(fixtureGraph());
    expect(opinion.verdict).toBe('reject');
    expect(opinion.confidence).toBeCloseTo(0.92);
    expect(opinion.rationale).toContain('Operator inversion');
    expect(opinion.rationale).toContain('Supports');
    expect(opinion.citedEvidenceIds).toHaveLength(1);
    expect(opinion.evidenceGraph).toBeDefined();
  });

  it('changes the rationale when the graph is perturbed', () => {
    const before = renderOpinionFromGraph(fixtureGraph());

    let g = emptyGraph();
    const exhibit = addNode(g, 'exhibit', {
      source: 'defense',
      label: 'd1',
      claim: 'Operator change is intentional',
      evidence: 'spec change in ADR-007',
      confidence: 0.6,
      kind: 'documentation',
    });
    g = exhibit.graph;
    const v = addNode(g, 'verdict', {
      verdict: 'approve',
      confidence: 0.6,
      summary: 'Approved with caveats.',
    });
    g = v.graph;
    g = addEdge(g, exhibit.nodeId, v.nodeId, 'supports');
    const after = renderOpinionFromGraph(g);

    expect(after.verdict).not.toBe(before.verdict);
    expect(after.rationale).not.toBe(before.rationale);
  });

  it('post-hoc rationale mutation does not change the embedded graph', () => {
    const opinion = renderOpinionFromGraph(fixtureGraph());
    const originalGraph = JSON.parse(JSON.stringify(opinion.evidenceGraph));
    const mutated = { ...opinion, rationale: 'I changed my mind, totally approve.' };
    expect(mutated.rationale).not.toBe(opinion.rationale);
    expect(mutated.evidenceGraph).toEqual(originalGraph);
  });
});
