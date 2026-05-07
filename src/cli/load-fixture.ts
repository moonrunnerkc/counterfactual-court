import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { OrchestratorInputs } from '../runtime/orchestrator.js';

/** Style and policy documents the Jury reads at deliberation time. */
const STYLE_DOC_FILES = ['AGENTS.md', 'CONTRIBUTING.md', 'STYLE_GUIDE.md'] as const;

/**
 * Load a fixture from `fixtures/<name>/` into the shape the orchestrator
 * accepts. Required files: `patch.diff`, `repo-snippet.ts`. Optional:
 * `repo-head.txt` (defaults to the repo snippet) and an `attachments/`
 * directory of PNG files.
 *
 * @param projectRoot Absolute path to the project root.
 * @param name        Subdirectory name under `fixtures/`.
 * @returns OrchestratorInputs ready for {@link runCourt}.
 * @throws Error with the offending path on missing required files.
 */
export function loadFixture(projectRoot: string, name: string): OrchestratorInputs {
  const fixtureDir = resolve(projectRoot, 'fixtures', name);
  if (!existsSync(fixtureDir) || !statSync(fixtureDir).isDirectory()) {
    throw new Error(
      `cli: fixture "${name}" not found at ${fixtureDir}; create the directory or pick another fixture`,
    );
  }
  const patch = readRequired(fixtureDir, 'patch.diff');
  const repoSnippet = readRequired(fixtureDir, 'repo-snippet.ts');
  const repoHeadPath = join(fixtureDir, 'repo-head.txt');
  const repoHead = existsSync(repoHeadPath) ? readFileSync(repoHeadPath, 'utf8') : repoSnippet;

  const styleDocs = STYLE_DOC_FILES.map((f) => {
    const p = resolve(projectRoot, 'docs', f);
    return existsSync(p) ? `## ${f}\n\n${readFileSync(p, 'utf8')}` : '';
  })
    .filter((s) => s.length > 0)
    .join('\n\n');

  const attachmentsDir = join(fixtureDir, 'attachments');
  const attachments: { name: string; base64: string }[] = [];
  if (existsSync(attachmentsDir) && statSync(attachmentsDir).isDirectory()) {
    for (const entry of readdirSync(attachmentsDir).sort()) {
      if (!entry.toLowerCase().endsWith('.png')) continue;
      const buf = readFileSync(join(attachmentsDir, entry));
      attachments.push({ name: entry, base64: buf.toString('base64') });
    }
  }

  return {
    fixture: name,
    patch,
    repoSnippet,
    repoHead,
    styleDocs,
    attachments,
  };
}

function readRequired(dir: string, fileName: string): string {
  const path = join(dir, fileName);
  if (!existsSync(path)) {
    throw new Error(`cli: fixture file ${path} is required; create it before running this fixture`);
  }
  return readFileSync(path, 'utf8');
}
