# Architectural Decision Records

Append-only log. Each decision gets an ADR with a short rationale and the consequences that follow. Reference by ADR number when discussing tradeoffs in chat or PRs.

The format is deliberately small: title, status, decision, rationale, consequences. No diagrams.

---

## ADR-001: Model variant assignment

**Status:** Accepted. 2026-05-07.

**Decision:** Each agent is bound to a specific Gemma 4 variant chosen for capability fit:

| Agent          | Concept-doc variant | Pinned Ollama tag                                                                                                            |
| -------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Prosecutor     | 4B (edge / small)   | `gemma4:e4b-it-q8_0`                                                                                                         |
| Court Reporter | 4B vision           | `gemma4:e4b-it-q8_0` (Gemma 4 ships native multimodal across variants; no separate vision tag exists in the Ollama registry) |
| Defender       | 26B MoE             | `gemma4:26b-a4b-it-q8_0` (the `a4b` suffix denotes the MoE active-parameter count)                                           |
| Jury           | 31B dense IT q8_0   | `gemma4:31b-it-q8_0`                                                                                                         |

**Rationale:** The Gemma 4 contest brief explicitly scores capability-matched assignment. Small models do high-throughput cheap work (Prosecutor mutations, Court Reporter OCR), the MoE handles high-throughput reasoning (Defender rebuttals), the dense 31B with a 128k context window does the irreplaceable long-context synthesis (Jury). The concept doc names abstract variants (`gemma4:4b`, `gemma4:4b-vision`, `gemma4:26b-moe`); the pinned tags above are the closest available variants in the Ollama registry as of 2026-05-07. The Court Reporter shares a model file with the Prosecutor because Gemma 4's native multimodal removes the need for a separate vision tag; they remain logically distinct agents with distinct prompts and roles.

**Consequences:**

- The four-role architecture is locked to the Gemma 4 family. Switching variants requires a new ADR.
- Three of four pulls in `runtime.lock.json` use Ollama tags that differ from the concept-doc names. The variant table in `docs/AGENTS.md` is the source of truth for what is actually pulled and pinned.
- Two roles share a model file. The runtime treats them as distinct agents (distinct prompts, distinct seeds, distinct exhibits) even though the underlying weights are identical.

---

## ADR-002: Determinism contract

**Status:** Accepted. 2026-05-07. Implementation deferred to Phase 1A (`src/runtime/determinism.ts`).

**Decision:** Every code path in the agent execution loop must be reproducible given the same inputs, seeds, model hashes, and runtime version. Implemented via:

- A seeded RNG and frozen clock provided through an `AgentContext` (no direct `Math.random`, `Date.now`, or `crypto.randomUUID` in agent code).
- A single LLM gateway (`src/runtime/llm-client.ts`) with explicit temperature, top-p, top-k, and seed on every call.
- Config loaded once at startup and frozen (`src/runtime/config.ts`); no env reads outside that file.
- All filesystem writes routed through `src/runtime/bundle-writer.ts`.
- Model output parsed into the evidence graph only via zod schemas in `src/evidence/schema.ts`; never `JSON.parse` raw output.

**Rationale:** Replayable signed bundles are the load-bearing differentiator (see `docs/PRIOR_ART.md`). If replay diverges, the contest pitch collapses, so the contract is enforced as a property of the source tree, not an aspiration.

**Consequences:**

- No `Math.random`, `Date.now`, `crypto.randomUUID`, env reads, or stray file writes anywhere in agent or orchestrator code.
- LLM temperature changes are config-level decisions (update `runtime.lock.json` and document the variance), not code-level conveniences.
- Residual quantized-inference variance per platform is documented in `docs/runtime-variance.md` (created in Phase 2G); replay tolerates that variance via an explicit flag and never silently smooths it.
- Integration test flakiness is interpreted as a determinism violation, not a test bug, and triaged accordingly.
