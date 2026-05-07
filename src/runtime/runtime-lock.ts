import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** Zod shape of `runtime.lock.json`. Keep additive-only; bundles in the wild reference these fields. */
export const RuntimeLock = z.object({
  ollama: z.object({ version: z.string().min(1) }),
  node: z.object({ version: z.string().min(1) }),
  models: z.record(
    z.string(),
    z.object({
      digest: z.string().regex(/^sha256:[0-9a-f]{64}$/, 'expected sha256:<hex64> digest'),
    }),
  ),
  generatedAt: z.string().min(1),
});

/** TS view of {@link RuntimeLock}. */
export type RuntimeLock = z.infer<typeof RuntimeLock>;

/**
 * Load and validate `runtime.lock.json` from disk.
 *
 * @param path Absolute path to the lock file.
 * @returns A validated, frozen-shaped {@link RuntimeLock}.
 * @throws Error with the offending path and parse/validation reason on failure.
 */
export function loadRuntimeLock(path: string): RuntimeLock {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `runtime-lock: failed to read ${path}: ${reason}; ensure runtime.lock.json exists at the configured path`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `runtime-lock: ${path} is not valid JSON (${reason}); regenerate via \`pnpm lock-runtime\``,
    );
  }
  const result = RuntimeLock.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new Error(
      `runtime-lock: ${path} failed schema validation (${issues}); regenerate via \`pnpm lock-runtime\``,
    );
  }
  return result.data;
}

/**
 * Compare two {@link RuntimeLock} values and return a list of human-readable
 * differences. An empty list means the recorded and current runtimes match
 * exactly on every field that affects determinism.
 *
 * @param recorded Lock as captured in a bundle.
 * @param current  Lock loaded from disk at replay time.
 * @returns Array of difference descriptions; empty when identical.
 */
export function diffRuntimeLocks(recorded: RuntimeLock, current: RuntimeLock): readonly string[] {
  const diffs: string[] = [];
  if (recorded.ollama.version !== current.ollama.version) {
    diffs.push(
      `ollama version: bundle ${recorded.ollama.version} vs current ${current.ollama.version}`,
    );
  }
  if (recorded.node.version !== current.node.version) {
    diffs.push(`node version: bundle ${recorded.node.version} vs current ${current.node.version}`);
  }
  for (const [model, info] of Object.entries(recorded.models)) {
    const cur = current.models[model];
    if (cur === undefined) {
      diffs.push(`model ${model}: bundle ${info.digest} vs current <not present>`);
      continue;
    }
    if (cur.digest !== info.digest) {
      diffs.push(`model ${model}: bundle ${info.digest} vs current ${cur.digest}`);
    }
  }
  return diffs;
}
