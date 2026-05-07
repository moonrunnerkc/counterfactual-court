import type { LlmCallParams, LlmCallResult, LlmClient } from './llm-client.js';

/** One `(params, result)` pair captured by {@link createRecordingLlmClient}. */
export interface RecordedLlmCall {
  readonly params: LlmCallParams;
  readonly result: LlmCallResult;
}

/** {@link LlmClient} wrapper that captures every call for the bundle writer. */
export interface RecordingLlmClient extends LlmClient {
  /** Append-only history. Index 0 is the first call routed through this client. */
  readonly calls: readonly RecordedLlmCall[];
}

/**
 * Wrap an inner {@link LlmClient} so that every call is recorded into an
 * in-memory list. Used by the orchestrator to capture prompts, hashes, and
 * responses for inclusion in a verdict bundle without modifying the agent
 * code path. Determinism is unaffected; the wrapper is a passthrough.
 *
 * @param inner Underlying LLM client (production Ollama or test stub).
 * @returns A {@link RecordingLlmClient} that delegates and records.
 */
export function createRecordingLlmClient(inner: LlmClient): RecordingLlmClient {
  const calls: RecordedLlmCall[] = [];
  return {
    calls,
    async call(params: LlmCallParams): Promise<LlmCallResult> {
      const result = await inner.call(params);
      calls.push({ params, result });
      return result;
    },
  };
}
