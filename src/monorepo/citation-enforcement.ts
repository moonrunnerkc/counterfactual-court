import type { EvidenceGraph } from '../evidence/graph.js';
import type { RippleSet } from './impact-trace.js';

/** Prefix used in citation node references for ripple-file citations. */
export const MONOREPO_CITATION_PREFIX = 'monorepo:';

/**
 * Return the ripple files that no citation node in the graph references. The
 * Phase 2C contract: when the ripple set is non-trivial, the Jury must cite
 * each affected file with a citation node whose `reference` is
 * `monorepo:<path>`. This helper surfaces the gap so a test (or the
 * orchestrator, if a future phase tightens the contract) can enforce it.
 *
 * @param graph     Evidence graph the Jury produced.
 * @param rippleSet Ripple set computed by the orchestrator.
 * @returns List of ripple file paths the graph fails to cite.
 */
export function findUncitedRippleFiles(
  graph: EvidenceGraph,
  rippleSet: RippleSet,
): readonly string[] {
  const cited = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind !== 'citation') continue;
    if (node.payload.reference.startsWith(MONOREPO_CITATION_PREFIX)) {
      cited.add(node.payload.reference.slice(MONOREPO_CITATION_PREFIX.length));
    }
  }
  const missing: string[] = [];
  for (const entry of rippleSet.entries) {
    if (!cited.has(entry.file)) {
      missing.push(entry.file);
    }
  }
  return missing;
}

/**
 * Assert that the graph cites every ripple file. Used by the Phase 2C
 * behavior test and by callers that want a hard guarantee. Emits one
 * actionable line listing the uncited files.
 *
 * @param graph     Evidence graph.
 * @param rippleSet Ripple set.
 * @throws Error when the ripple set is non-trivial and at least one file is
 *   not cited via a `monorepo:<path>` citation node.
 */
export function assertEveryRippleFileCited(graph: EvidenceGraph, rippleSet: RippleSet): void {
  if (rippleSet.entries.length === 0) return;
  const missing = findUncitedRippleFiles(graph, rippleSet);
  if (missing.length === 0) return;
  throw new Error(
    `monorepo impact: ${missing.length} ripple file(s) are not cited; the Jury must add citation nodes with reference="${MONOREPO_CITATION_PREFIX}<path>" for each affected file: ${missing.join(', ')}`,
  );
}
