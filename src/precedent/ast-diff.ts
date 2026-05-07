import ts from 'typescript';
import { contentHash } from '../runtime/canonical.js';

/**
 * Histogram of TypeScript AST node kinds present in the added (post-image)
 * portion of a unified diff. The structural similarity score in this module is
 * computed as the cosine similarity of two histograms; that's a coarse but
 * symmetric and bounded measure that aligns with the intuition that two
 * patches touching the same syntactic surfaces are structurally similar.
 *
 * The chosen algorithm:
 * 1. Extract the post-image lines from the patch (everything starting with `+`
 *    that is not a `+++` file header).
 * 2. Concatenate them and run the TypeScript compiler in scriptKind=Latest
 *    error-tolerant mode so a partial fragment still parses.
 * 3. Walk the AST and count occurrences of each `SyntaxKind`.
 * 4. Cosine-similarity two histograms element-wise. The output is in [0, 1].
 *    Symmetric: sim(A, B) = sim(B, A). Identity: sim(A, A) = 1 when the
 *    histogram is non-empty.
 */
export type SyntaxHistogram = ReadonlyMap<ts.SyntaxKind, number>;

/**
 * Pull the post-image lines out of a unified-diff text. Returns a single
 * string with newline separators so the TypeScript parser can tokenize it as
 * one source fragment.
 *
 * Why post-image only: the precedent ledger's job is to recognize "we have
 * seen patches like this before"; the after-state is the load-bearing
 * structure. Removed lines are noise for that purpose.
 *
 * @param patchText Unified diff (whatever `git diff` produces).
 * @returns Concatenation of every added line, sans the leading `+`.
 */
export function extractAddedSource(patchText: string): string {
  const lines = patchText.split('\n');
  const added: string[] = [];
  for (const line of lines) {
    if (line.startsWith('+++')) continue;
    if (line.startsWith('+')) {
      added.push(line.slice(1));
    }
  }
  return added.join('\n');
}

/**
 * Build the {@link SyntaxHistogram} for a unified-diff text. Empty input
 * returns an empty histogram; the comparison function treats those as zero
 * similarity rather than throwing.
 *
 * @param patchText Unified-diff text.
 * @returns Frequency map keyed by `ts.SyntaxKind`.
 */
export function buildHistogram(patchText: string): SyntaxHistogram {
  const source = extractAddedSource(patchText);
  if (source.length === 0) return new Map();
  const sourceFile = ts.createSourceFile(
    'patch-fragment.ts',
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    ts.ScriptKind.TS,
  );
  const counts = new Map<ts.SyntaxKind, number>();
  function walk(node: ts.Node): void {
    counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
    ts.forEachChild(node, walk);
  }
  walk(sourceFile);
  return counts;
}

/**
 * Cosine similarity of two AST node-kind histograms. Returns 0 when either
 * histogram is empty, which preserves the bounded [0, 1] range without
 * collapsing the function to NaN. Identity: `astSimilarity(A, A) === 1` for
 * any A whose histogram has at least one entry. Symmetry follows from cosine
 * similarity itself: `astSimilarity(A, B) === astSimilarity(B, A)`.
 *
 * @param a Source histogram.
 * @param b Target histogram.
 * @returns Similarity score in [0, 1].
 */
export function similarityFromHistograms(a: SyntaxHistogram, b: SyntaxHistogram): number {
  if (a.size === 0 || b.size === 0) return 0;
  const allKinds = new Set<ts.SyntaxKind>();
  for (const k of a.keys()) allKinds.add(k);
  for (const k of b.keys()) allKinds.add(k);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const k of allKinds) {
    const va = a.get(k) ?? 0;
    const vb = b.get(k) ?? 0;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }
  if (magA === 0 || magB === 0) return 0;
  const score = dot / (Math.sqrt(magA) * Math.sqrt(magB));
  // Clamp; floating-point error can produce 1.0000000000000002 on identical inputs.
  if (score < 0) return 0;
  if (score > 1) return 1;
  return score;
}

/**
 * Convenience wrapper: build histograms for both patches and compute the
 * similarity score in one call. Pure.
 *
 * @param patchA Unified-diff text.
 * @param patchB Unified-diff text.
 * @returns Similarity score in [0, 1].
 */
export function astSimilarity(patchA: string, patchB: string): number {
  return similarityFromHistograms(buildHistogram(patchA), buildHistogram(patchB));
}

/**
 * Stable patch fingerprint for ledger storage. Combines the histogram with
 * the post-image source bytes so two patches that hash identically here are
 * structurally indistinguishable up to whitespace. Caller stores the value as
 * a hex digest.
 *
 * @param patchText Unified-diff text.
 * @returns 64-char lowercase hex sha-256 digest.
 */
export function patchFingerprint(patchText: string): string {
  const histogram = buildHistogram(patchText);
  const sortedKinds = [...histogram.keys()].sort((a, b) => a - b);
  const histogramArray = sortedKinds.map((k) => [k, histogram.get(k) ?? 0]);
  return contentHash({
    histogram: histogramArray,
    addedSource: extractAddedSource(patchText),
  });
}

/**
 * Serialize a histogram to a plain object so it can be persisted in the
 * ledger JSON. Keys become numeric strings (the {@link ts.SyntaxKind} number);
 * values are counts.
 *
 * @param histogram Histogram to serialize.
 * @returns Plain object representation.
 */
export function histogramToJson(histogram: SyntaxHistogram): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [kind, count] of histogram) {
    out[String(kind)] = count;
  }
  return out;
}

/**
 * Inverse of {@link histogramToJson}. Reads a persisted ledger histogram back
 * into the in-memory {@link Map}. Tolerates non-numeric keys by skipping them.
 *
 * @param json Plain-object histogram from disk.
 * @returns In-memory histogram.
 */
export function histogramFromJson(json: Record<string, number>): SyntaxHistogram {
  const out = new Map<ts.SyntaxKind, number>();
  for (const [k, v] of Object.entries(json)) {
    const kind = Number.parseInt(k, 10);
    if (!Number.isFinite(kind)) continue;
    if (typeof v === 'number') {
      out.set(kind as ts.SyntaxKind, v);
    }
  }
  return out;
}
