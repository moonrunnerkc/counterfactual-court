import { sha256Hex } from './canonical.js';
import {
  computePromptHash,
  validateLlmCallParams,
  type LlmCallParams,
  type LlmCallResult,
  type LlmClient,
} from './llm-client.js';

/**
 * Caller-supplied function that maps {@link LlmCallParams} to the response
 * text the stub should return. Returning a Promise is fine; throwing an Error
 * surfaces synchronously through {@link LlmClient.call}.
 */
export type StubLlmHandler = (params: LlmCallParams) => string | Promise<string>;

/**
 * Recorded call entry kept by {@link createStubLlmClient}. Lets tests assert
 * on the exact parameter shape the agent layer produces, including hashes.
 */
export interface StubLlmCallRecord {
  readonly params: LlmCallParams;
  readonly result: LlmCallResult;
}

/** {@link LlmClient} plus a recording of every call seen so far. */
export interface StubLlmClient extends LlmClient {
  /** Append-only history of calls. Index 0 is the first call. */
  readonly calls: readonly StubLlmCallRecord[];
}

/**
 * Build a deterministic stub LLM client. The {@link validateLlmCallParams}
 * guard runs on every call, so the stub is suitable for both happy-path
 * tests and tests that intentionally pass malformed parameters.
 *
 * Token counts are reported as `prompt: 0, completion: 0` since the stub
 * does no tokenization. The hash fields are real SHA-256 of canonical JSON
 * and the response text respectively, so tests asserting on hashes use the
 * same algorithm the production client does.
 *
 * @param handler Function that turns params into response text.
 * @returns A {@link StubLlmClient} that mirrors the production interface.
 */
export function createStubLlmClient(handler: StubLlmHandler): StubLlmClient {
  const calls: StubLlmCallRecord[] = [];
  const client: StubLlmClient = {
    calls,
    async call(params: LlmCallParams): Promise<LlmCallResult> {
      validateLlmCallParams(params);
      const text = await handler(params);
      const result: LlmCallResult = {
        text,
        model: params.model,
        promptHash: computePromptHash(params),
        responseHash: sha256Hex(text),
        tokens: { prompt: 0, completion: 0 },
      };
      calls.push({ params, result });
      return result;
    },
  };
  return client;
}
