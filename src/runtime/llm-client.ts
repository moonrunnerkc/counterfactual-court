import { Agent, fetch as undiciFetch } from 'undici';
import { contentHash, sha256Hex } from './canonical.js';
import type { Logger } from './log.js';

/**
 * Long-timeout undici Agent for Ollama's `/api/generate`. The default
 * headers-timeout (300_000 ms) fires while Ollama is loading a 28-33 GB
 * Gemma 4 model into VRAM on first use, surfacing as `fetch failed` even
 * though the server is still working. We reset both timeouts to 30 minutes
 * because the longest legitimate response we have observed is the 31B Jury
 * on a multi-thousand-token prompt at q8_0.
 */
const OLLAMA_HEADERS_TIMEOUT_MS = 30 * 60 * 1000;
const OLLAMA_BODY_TIMEOUT_MS = 30 * 60 * 1000;
const ollamaAgent = new Agent({
  headersTimeout: OLLAMA_HEADERS_TIMEOUT_MS,
  bodyTimeout: OLLAMA_BODY_TIMEOUT_MS,
});

/**
 * Parameters for a single LLM call. Every sampling knob is required so that
 * agent code cannot inadvertently fall back on a model default; replays must
 * reproduce the exact decoding regime.
 *
 * The TypeScript type enforces presence at compile time; {@link
 * validateLlmCallParams} backstops the same invariants at runtime in case a
 * caller bypasses the type system with `as` casts or dynamic construction.
 */
export interface LlmCallParams {
  /** Ollama tag, e.g. `gemma4:e4b-it-q8_0`. Must match a digest in runtime.lock.json. */
  readonly model: string;
  /** Prompt body sent verbatim. */
  readonly prompt: string;
  /** Optional system prompt prepended by Ollama. */
  readonly system?: string;
  /** Decoding temperature. 0 means greedy. */
  readonly temperature: number;
  /** Top-p (nucleus) sampling cutoff in (0, 1]. */
  readonly topP: number;
  /** Top-k sampling cutoff. Non-negative integer. */
  readonly topK: number;
  /** Seed routed to the underlying sampler. Non-negative integer. */
  readonly seed: number;
  /**
   * Force structured output. Either the literal `'json'` (Ollama's
   * unrestricted JSON mode) or a JSON Schema object — Ollama 0.5.0+
   * constrains the decoder to outputs that satisfy the schema. We pass
   * zod-derived JSON Schemas for every agent so the decoder cannot drift
   * out of the typed contract (eliminating the `verdict.verdict: Invalid
   * option` and missing-required-field failure modes).
   */
  readonly format?: 'json' | Record<string, unknown>;
  /** Max tokens to generate. Mapped to Ollama's `num_predict`. */
  readonly maxTokens?: number;
  /** Optional stop sequences. */
  readonly stop?: readonly string[];
  /**
   * Optional base64-encoded image payloads forwarded to a multimodal model.
   * Forwarded verbatim to Ollama's `images` array. Each entry must be the
   * base64 of a single image file (no `data:` prefix). Decoding is the
   * model's responsibility.
   */
  readonly images?: readonly string[];
  /**
   * Optional Ollama `keep_alive` hint controlling how long the model stays
   * resident in VRAM after this call. Accepts the strings Ollama accepts
   * (e.g. `"15m"`, `"1h"`, `"0"`) or a duration in seconds (number).
   *
   * Excluded from {@link computePromptHash} on purpose: keep_alive is a
   * server-side caching hint, not a sampling parameter. It changes how long
   * Ollama keeps weights loaded but does not change the decoded output for
   * a fixed (prompt, seed, sampling-params) tuple. Including it in the
   * promptHash would break determinism replay across operators who set
   * different keep_alive values for performance.
   */
  readonly keepAlive?: string | number;
}

/** Result of an LLM call. All fields are required so logs and bundles agree. */
export interface LlmCallResult {
  /** Decoded text. The agent layer applies its own schema validation on top. */
  readonly text: string;
  /** Echo of the model tag actually invoked. */
  readonly model: string;
  /** Hash of the canonical params; identical params hash identically. */
  readonly promptHash: string;
  /** SHA-256 of `text`. */
  readonly responseHash: string;
  /** Token counts as reported by Ollama. */
  readonly tokens: { readonly prompt: number; readonly completion: number };
}

/** The single authorized gateway to an LLM. No other module may import Ollama. */
export interface LlmClient {
  /**
   * Run one LLM call. Resolves to a typed result; rejects with an Error whose
   * message states what failed and what the caller should check.
   */
  call(params: LlmCallParams): Promise<LlmCallResult>;
}

/**
 * Verify every field of `params` is present and shaped correctly. Run at the
 * start of every {@link LlmClient.call} implementation so callers cannot
 * silently lose seed or top-k to undefined.
 *
 * @param params Caller-supplied parameters. May be `unknown` at runtime even
 *               though the type system claims `LlmCallParams`.
 * @throws Error with a precise field-level message if any required parameter
 *   is missing or has the wrong type or sign.
 */
export function validateLlmCallParams(params: LlmCallParams): void {
  const p = params as unknown as Record<string, unknown>;
  if (typeof p['model'] !== 'string' || p['model'].length === 0) {
    throw new Error('llm call params: `model` must be a non-empty string; pass the Ollama tag');
  }
  if (typeof p['prompt'] !== 'string') {
    throw new Error('llm call params: `prompt` must be a string; empty string is allowed');
  }
  if (p['system'] !== undefined && typeof p['system'] !== 'string') {
    throw new Error('llm call params: `system` must be a string or omitted');
  }
  for (const [key, low, high] of [
    ['temperature', 0, 2],
    ['topP', 0, 1],
  ] as const) {
    const v = p[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < low || v > high) {
      throw new Error(
        `llm call params: \`${key}\` must be a finite number in [${low}, ${high}]; got ${String(v)}`,
      );
    }
  }
  for (const key of ['topK', 'seed'] as const) {
    const v = p[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      throw new Error(
        `llm call params: \`${key}\` must be a non-negative integer; got ${String(v)}`,
      );
    }
  }
  if (p['format'] !== undefined) {
    const f = p['format'];
    const ok = f === 'json' || (typeof f === 'object' && f !== null && !Array.isArray(f));
    if (!ok) {
      throw new Error(
        'llm call params: `format`, if set, must be the string "json" or a JSON Schema object',
      );
    }
  }
  if (p['maxTokens'] !== undefined) {
    const v = p['maxTokens'];
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
      throw new Error('llm call params: `maxTokens`, if set, must be a positive integer');
    }
  }
  if (p['stop'] !== undefined) {
    const v = p['stop'];
    if (!Array.isArray(v) || v.some((entry) => typeof entry !== 'string')) {
      throw new Error('llm call params: `stop`, if set, must be an array of strings');
    }
  }
  if (p['images'] !== undefined) {
    const v = p['images'];
    if (!Array.isArray(v) || v.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
      throw new Error(
        'llm call params: `images`, if set, must be an array of non-empty base64 strings',
      );
    }
  }
  if (p['keepAlive'] !== undefined) {
    const v = p['keepAlive'];
    if (typeof v !== 'string' && typeof v !== 'number') {
      throw new Error('llm call params: `keepAlive`, if set, must be a string or a number');
    }
  }
}

/**
 * Hash the deterministic-relevant subset of the call parameters. This becomes
 * the lookup key for replay caches and the audit trail in the verdict bundle.
 */
export function computePromptHash(params: LlmCallParams): string {
  return contentHash({
    model: params.model,
    prompt: params.prompt,
    system: params.system ?? null,
    temperature: params.temperature,
    topP: params.topP,
    topK: params.topK,
    seed: params.seed,
    format: params.format ?? null,
    maxTokens: params.maxTokens ?? null,
    stop: params.stop ?? null,
    images: params.images ?? null,
  });
}

/** Constructor parameters for {@link createOllamaLlmClient}. */
export interface OllamaLlmClientOptions {
  /** Base URL for the Ollama HTTP API, no trailing slash. */
  readonly baseUrl: string;
  /** Logger used to record one entry per call with prompt and response hashes. */
  readonly logger: Logger;
  /** Override for testing. Defaults to globalThis.fetch. */
  readonly fetchImpl?: typeof fetch;
  /**
   * Maximum retry attempts on a transient `fetch failed` error (Ollama
   * dropping the connection while loading a model into VRAM). Default 2,
   * for a total of 3 attempts. The retry pauses 5s, then 15s. Successful
   * responses always return on the first attempt; only network-level
   * failures retry. HTTP non-200 responses do not retry because those
   * indicate request-level problems the operator must fix.
   */
  readonly maxRetries?: number;
}

/** Shape of the Ollama /api/generate response we care about. */
interface OllamaGenerateResponse {
  readonly model?: unknown;
  readonly response?: unknown;
  readonly done?: unknown;
  readonly prompt_eval_count?: unknown;
  readonly eval_count?: unknown;
}

/**
 * Build the real LLM client backed by an Ollama server over HTTP. This is the
 * only file in the codebase allowed to know the Ollama wire format; agents
 * and tests alike consume {@link LlmClient}.
 *
 * @param opts Base URL, logger, and optional fetch override.
 * @returns An LlmClient that POSTs to `${baseUrl}/api/generate`.
 */
export function createOllamaLlmClient(opts: OllamaLlmClientOptions): LlmClient {
  // Use undici's fetch with a long-timeout dispatcher unless the caller
  // injected a fetchImpl (tests do). The dispatcher is only attached when
  // we are using undici's fetch; injected impls keep their own behavior.
  const fetchImpl =
    opts.fetchImpl ??
    ((url: string, init?: Parameters<typeof undiciFetch>[1]): Promise<Response> =>
      undiciFetch(url, { ...init, dispatcher: ollamaAgent }) as unknown as Promise<Response>);
  const baseUrl = opts.baseUrl;
  const logger = opts.logger;
  const maxRetries = opts.maxRetries ?? 2;
  const retryDelaysMs = [5_000, 15_000];

  return {
    async call(params: LlmCallParams): Promise<LlmCallResult> {
      validateLlmCallParams(params);
      const promptHash = computePromptHash(params);
      const body = JSON.stringify({
        model: params.model,
        prompt: params.prompt,
        ...(params.system !== undefined ? { system: params.system } : {}),
        ...(params.images !== undefined ? { images: [...params.images] } : {}),
        stream: false,
        ...(params.format !== undefined ? { format: params.format } : {}),
        ...(params.keepAlive !== undefined ? { keep_alive: params.keepAlive } : {}),
        options: {
          temperature: params.temperature,
          top_p: params.topP,
          top_k: params.topK,
          seed: params.seed,
          ...(params.maxTokens !== undefined ? { num_predict: params.maxTokens } : {}),
          ...(params.stop !== undefined ? { stop: [...params.stop] } : {}),
        },
      });
      const url = `${baseUrl}/api/generate`;
      let res: Response | undefined;
      let lastError = '';
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          });
          break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          if (attempt === maxRetries) {
            throw new Error(
              `ollama POST ${url} failed: ${lastError}; verify the Ollama server is running and reachable (retried ${maxRetries} times)`,
            );
          }
          const delay = retryDelaysMs[attempt] ?? 5_000;
          logger.warn('llm.retry', {
            url,
            reason: lastError,
            attempt: attempt + 1,
            nextDelayMs: delay,
          });
          await new Promise<void>((resolve) => {
            setTimeout(resolve, delay);
          });
        }
      }
      if (res === undefined) {
        throw new Error(`ollama POST ${url} failed: ${lastError}; no response after retries`);
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => '<unreadable>');
        throw new Error(
          `ollama ${url} returned HTTP ${res.status}: ${detail}; confirm the model is pulled and the request body is valid`,
        );
      }
      const json = (await res.json()) as OllamaGenerateResponse;
      if (typeof json.response !== 'string') {
        throw new Error(
          `ollama ${url} response missing string \`response\` field; got keys [${Object.keys(json).join(', ')}]`,
        );
      }
      const text = json.response;
      const responseHash = sha256Hex(text);
      const result: LlmCallResult = {
        text,
        model: typeof json.model === 'string' ? json.model : params.model,
        promptHash,
        responseHash,
        tokens: {
          prompt: typeof json.prompt_eval_count === 'number' ? json.prompt_eval_count : 0,
          completion: typeof json.eval_count === 'number' ? json.eval_count : 0,
        },
      };
      logger.info('llm.call', {
        model: result.model,
        promptHash,
        responseHash,
        promptTokens: result.tokens.prompt,
        completionTokens: result.tokens.completion,
      });
      return result;
    },
  };
}
