import type { ZodType } from 'zod';

/**
 * Strip a leading and trailing Markdown code fence from `text`, if present.
 * Some Gemma 4 prompt configurations occasionally wrap JSON in ```json ... ```
 * blocks even when `format: 'json'` is requested; we tolerate the wrapper
 * rather than fail validation, which would otherwise burn replays on a
 * cosmetic difference. Removing the fence is a no-op when none is present.
 *
 * @param text Raw text returned by the LLM.
 * @returns Text with one matching code fence removed, or `text` unchanged.
 */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const firstNewline = trimmed.indexOf('\n');
  if (firstNewline < 0) return trimmed;
  const body = trimmed.slice(firstNewline + 1);
  const closeIdx = body.lastIndexOf('```');
  if (closeIdx < 0) return body;
  return body.slice(0, closeIdx).trim();
}

/**
 * Parse a JSON-shaped LLM response and validate it against `schema`. Raises
 * a typed error with both the failing field and the offending text excerpt
 * so the caller can surface actionable feedback to the operator.
 *
 * @param raw   Verbatim model output (the `text` field of an LlmCallResult).
 * @param schema Zod schema describing the expected shape.
 * @param agent  Human-readable agent name used in error messages.
 * @returns The parsed and validated value.
 * @throws Error if the text is not valid JSON, or if it parses but fails
 *   schema validation. The thrown Error's message includes the agent name
 *   and a short excerpt of the offending payload.
 */
export function parseJsonResponse<T>(raw: string, schema: ZodType<T>, agent: string): T {
  const stripped = stripCodeFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const excerpt = stripped.length > 200 ? `${stripped.slice(0, 200)}...` : stripped;
    throw new Error(
      `${agent}: model output is not valid JSON (${reason}); excerpt: ${JSON.stringify(excerpt)}; tighten the prompt or pin format: 'json'`,
    );
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(
      `${agent}: model output failed schema validation (${issues}); update the prompt to specify the missing fields`,
    );
  }
  return result.data;
}
