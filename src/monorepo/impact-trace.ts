import {
  buildImportGraph,
  toPosix,
  transitiveImporters,
  type ImportGraph,
} from './import-graph.js';

/** One entry in the ripple set surfaced to the Jury. */
export interface RippleEntry {
  /** Project-relative path of a file that depends on a changed file. */
  file: string;
  /** Hop distance from the changed file (1 = direct importer). */
  depth: number;
  /** Project-relative path of the changed file this entry depends on. */
  changedFile: string;
}

/** Ripple set produced by {@link computeRippleSet}. */
export interface RippleSet {
  /** Files whose post-image content actually changed in the patch. */
  readonly changedFiles: readonly string[];
  /** Direct importers and transitive consumers, deduped by `file`. */
  readonly entries: readonly RippleEntry[];
}

/**
 * Pull the project-relative files a unified-diff text touches. Looks at the
 * `+++ b/<path>` headers; `/dev/null` is skipped because it represents a
 * deletion target rather than a real file.
 *
 * @param patchText Unified-diff text.
 * @returns Sorted list of unique project-relative paths.
 */
export function changedFilesFromPatch(patchText: string): string[] {
  const seen = new Set<string>();
  for (const line of patchText.split('\n')) {
    if (!line.startsWith('+++ ')) continue;
    let target = line.slice(4).trim();
    if (target === '/dev/null') continue;
    if (target.startsWith('b/')) target = target.slice(2);
    seen.add(toPosix(target));
  }
  return [...seen].sort();
}

/**
 * Compute the ripple set for a patch against an import graph. Pure.
 *
 * Depth is measured via BFS over reverse edges. A file that imports a changed
 * file directly has depth 1; one that imports a depth-1 file has depth 2; and
 * so on. When the same downstream file is reached through multiple changed
 * files, the entry with the smaller depth wins; ties keep the
 * lexicographically-first changed file for determinism.
 *
 * @param graph     Import graph for the project.
 * @param patchText Unified-diff text of the patch under review.
 * @returns The {@link RippleSet}.
 */
export function computeRippleSet(graph: ImportGraph, patchText: string): RippleSet {
  const changedFiles = changedFilesFromPatch(patchText).filter((f) => graph.files.includes(f));

  const bestByFile = new Map<string, RippleEntry>();
  for (const changed of changedFiles) {
    const queue: { file: string; depth: number }[] = [{ file: changed, depth: 0 }];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === undefined) break;
      if (visited.has(cur.file)) continue;
      visited.add(cur.file);
      for (const edge of graph.edges) {
        if (edge.to !== cur.file) continue;
        const importer = edge.from;
        const candidate: RippleEntry = {
          file: importer,
          depth: cur.depth + 1,
          changedFile: changed,
        };
        const existing = bestByFile.get(importer);
        if (
          existing === undefined ||
          candidate.depth < existing.depth ||
          (candidate.depth === existing.depth && candidate.changedFile < existing.changedFile)
        ) {
          bestByFile.set(importer, candidate);
        }
        queue.push({ file: importer, depth: cur.depth + 1 });
      }
    }
  }

  const entries = [...bestByFile.values()].sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.file.localeCompare(b.file);
  });

  return { changedFiles, entries };
}

/**
 * Convenience wrapper: build an import graph for `files` and compute the
 * ripple set against `patchText` in one call.
 *
 * @param rootDir Project root.
 * @param files   Project-relative TS file paths participating in the graph.
 * @param patchText Unified-diff text.
 * @returns The {@link RippleSet}.
 */
export function traceImpact(
  rootDir: string,
  files: readonly string[],
  patchText: string,
): { readonly graph: ImportGraph; readonly rippleSet: RippleSet } {
  const graph = buildImportGraph(rootDir, files);
  const rippleSet = computeRippleSet(graph, patchText);
  return { graph, rippleSet };
}

/** Cross-validate transitive reachability with the import-graph helper. Used in tests. */
export function rippleViaTransitiveImporters(
  graph: ImportGraph,
  changed: string,
): readonly string[] {
  return [...transitiveImporters(graph, changed)].sort();
}
