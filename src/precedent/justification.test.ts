import { describe, expect, it } from 'vitest';
import { addEdge, addNode, emptyGraph } from '../evidence/builder.js';
import { assertEveryPrecedentJustified, findUnjustifiedPrecedents } from './justification.js';

function graphWithJustifiedPrecedent(): ReturnType<typeof emptyGraph> {
  let g = emptyGraph();
  const verdict = addNode(g, 'verdict', {
    verdict: 'reject',
    confidence: 0.9,
    summary: 'reject',
  });
  g = verdict.graph;
  const exhibit = addNode(g, 'exhibit', {
    source: 'jury',
    label: 'j1',
    claim: 'Same operator inversion was rejected last week',
    evidence: 'see prior bundle',
    confidence: 0.85,
    kind: 'logic-error',
  });
  g = exhibit.graph;
  const precedent = addNode(g, 'precedent', {
    bundleId: 'p'.repeat(64),
    similarity: 0.97,
    justification: 'sim 0.97',
  });
  g = precedent.graph;
  g = addEdge(g, exhibit.nodeId, precedent.nodeId, 'supports');
  g = addEdge(g, precedent.nodeId, verdict.nodeId, 'supports');
  return g;
}

function graphWithUnjustifiedPrecedent(): ReturnType<typeof emptyGraph> {
  let g = emptyGraph();
  const verdict = addNode(g, 'verdict', {
    verdict: 'reject',
    confidence: 0.9,
    summary: 'reject',
  });
  g = verdict.graph;
  const precedent = addNode(g, 'precedent', {
    bundleId: 'q'.repeat(64),
    similarity: 0.97,
    justification: 'sim 0.97',
  });
  g = precedent.graph;
  g = addEdge(g, precedent.nodeId, verdict.nodeId, 'supports');
  return g;
}

describe('findUnjustifiedPrecedents', () => {
  it('returns no gaps when every precedent has an incoming supports edge', () => {
    expect(findUnjustifiedPrecedents(graphWithJustifiedPrecedent())).toEqual([]);
  });

  it('flags a precedent that has no incoming supports/depends-on edge', () => {
    const gaps = findUnjustifiedPrecedents(graphWithUnjustifiedPrecedent());
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.bundleId).toBe('q'.repeat(64));
  });

  it('flags a precedent whose only incoming edge is from another precedent', () => {
    let g = emptyGraph();
    const verdict = addNode(g, 'verdict', {
      verdict: 'approve',
      confidence: 0.5,
      summary: 'a',
    });
    g = verdict.graph;
    const precA = addNode(g, 'precedent', {
      bundleId: 'a'.repeat(64),
      similarity: 0.9,
      justification: 'a',
    });
    g = precA.graph;
    const precB = addNode(g, 'precedent', {
      bundleId: 'b'.repeat(64),
      similarity: 0.9,
      justification: 'b',
    });
    g = precB.graph;
    g = addEdge(g, precA.nodeId, precB.nodeId, 'supports');
    g = addEdge(g, precB.nodeId, verdict.nodeId, 'supports');
    const gaps = findUnjustifiedPrecedents(g);
    // Both precedents need a non-precedent justifier.
    expect(gaps).toHaveLength(2);
  });
});

describe('assertEveryPrecedentJustified', () => {
  it('returns silently when every precedent is justified', () => {
    expect(() => assertEveryPrecedentJustified(graphWithJustifiedPrecedent())).not.toThrow();
  });

  it('throws an actionable error when a precedent is not justified', () => {
    expect(() => assertEveryPrecedentJustified(graphWithUnjustifiedPrecedent())).toThrow(
      /unjustified precedent/,
    );
  });
});
