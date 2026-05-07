import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, normalize, relative, resolve } from 'node:path';
import ts from 'typescript';

/**
 * One directed edge in the import graph. `from` imports `to`. `kind` records
 * whether the import is a value/type import or a re-export, because re-exports
 * propagate impact differently when the Jury reasons about a change: if A
 * re-exports B and B changes, every consumer of A is also affected.
 */
export interface ImportEdge {
  /** Project-relative path of the importing file (POSIX separators). */
  from: string;
  /** Project-relative path of the imported file (POSIX separators). */
  to: string;
  /** Whether the edge is a re-export (`export ... from`) or a regular import. */
  kind: 'import' | 'reexport';
}

/** A directed import graph over a set of project files. */
export interface ImportGraph {
  /** Absolute project root every file path is relative to. */
  rootDir: string;
  /** Project-relative file paths that participate in the graph. */
  files: string[];
  /** Directed edges; an edge is included only when the resolved target is in `files`. */
  edges: ImportEdge[];
}

/**
 * Build an import graph for `files` rooted at `rootDir`. Only files in the
 * input list are nodes; imports that resolve outside the set (e.g. into
 * `node_modules`) are skipped because the Jury does not reason about
 * third-party blast radius.
 *
 * Resolution rules: a relative specifier is resolved against the importer's
 * directory, then probed in this order: `<spec>`, `<spec>.ts`, `<spec>.tsx`,
 * `<spec>/index.ts`, `<spec>/index.tsx`. Bare specifiers are skipped. The
 * suffix list mirrors the Phase 2 fixture monorepo and the project's actual
 * layout; no attempt is made to honor a `tsconfig.json` `paths` map.
 *
 * @param rootDir Absolute path; every output `from`/`to` is relative to this.
 * @param files   Project-relative TypeScript file paths.
 * @returns The built {@link ImportGraph}.
 */
export function buildImportGraph(rootDir: string, files: readonly string[]): ImportGraph {
  const absRoot = resolve(rootDir);
  const fileSet = new Set(files.map((f) => toPosix(normalize(f))));
  const edges: ImportEdge[] = [];

  for (const fileRel of fileSet) {
    const absFile = resolve(absRoot, fileRel);
    let source: string;
    try {
      source = readFileSync(absFile, 'utf8');
    } catch {
      continue;
    }
    const sf = ts.createSourceFile(absFile, source, ts.ScriptTarget.Latest, true);
    for (const stmt of sf.statements) {
      const spec = importSpecifier(stmt);
      if (spec === null) continue;
      const resolved = resolveSpecifier(absRoot, absFile, spec.spec, fileSet);
      if (resolved === null) continue;
      edges.push({ from: fileRel, to: resolved, kind: spec.kind });
    }
  }

  return {
    rootDir: absRoot,
    files: [...fileSet].sort(),
    edges: edges.sort((a, b) => {
      if (a.from !== b.from) return a.from.localeCompare(b.from);
      if (a.to !== b.to) return a.to.localeCompare(b.to);
      return a.kind.localeCompare(b.kind);
    }),
  };
}

/**
 * Return every file that transitively imports `target` (directly or via
 * intermediate files). Pure: the input graph is unchanged. The result does
 * not include `target` itself.
 *
 * @param graph  Import graph.
 * @param target Project-relative file path that was changed.
 * @returns Set of project-relative paths that depend on `target`.
 */
export function transitiveImporters(graph: ImportGraph, target: string): Set<string> {
  const wanted = toPosix(normalize(target));
  const result = new Set<string>();
  const queue: string[] = [wanted];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) break;
    for (const edge of graph.edges) {
      if (edge.to !== cur) continue;
      if (result.has(edge.from)) continue;
      result.add(edge.from);
      queue.push(edge.from);
    }
  }
  return result;
}

/**
 * Convert a path to use POSIX separators. We index by POSIX paths so the
 * graph is platform-stable across macOS and Linux CI.
 */
export function toPosix(p: string): string {
  return p.split('\\').join('/');
}

interface SpecifierResult {
  spec: string;
  kind: ImportEdge['kind'];
}

function importSpecifier(stmt: ts.Statement): SpecifierResult | null {
  if (ts.isImportDeclaration(stmt)) {
    const moduleSpecifier = stmt.moduleSpecifier;
    if (ts.isStringLiteral(moduleSpecifier)) {
      return { spec: moduleSpecifier.text, kind: 'import' };
    }
  }
  if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier !== undefined) {
    if (ts.isStringLiteral(stmt.moduleSpecifier)) {
      return { spec: stmt.moduleSpecifier.text, kind: 'reexport' };
    }
  }
  return null;
}

function resolveSpecifier(
  absRoot: string,
  absImporter: string,
  specifier: string,
  fileSet: ReadonlySet<string>,
): string | null {
  if (!specifier.startsWith('.') && !isAbsolute(specifier)) return null;
  const baseDir = dirname(absImporter);
  const baseAbs = resolve(baseDir, specifier);

  const candidates: string[] = [];
  // Strip a `.js` or `.tsx` suffix the importer wrote; resolve to the .ts source.
  const stripped = baseAbs.replace(/\.(js|jsx|tsx)$/u, '');
  candidates.push(stripped);
  candidates.push(`${stripped}.ts`);
  candidates.push(`${stripped}.tsx`);
  candidates.push(resolve(stripped, 'index.ts'));
  candidates.push(resolve(stripped, 'index.tsx'));
  candidates.push(baseAbs);
  candidates.push(`${baseAbs}.ts`);
  candidates.push(`${baseAbs}.tsx`);
  candidates.push(resolve(baseAbs, 'index.ts'));
  candidates.push(resolve(baseAbs, 'index.tsx'));

  for (const candidate of candidates) {
    const rel = toPosix(relative(absRoot, candidate));
    if (fileSet.has(rel)) return rel;
  }
  return null;
}
