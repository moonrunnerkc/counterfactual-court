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

---

## ADR-003: UCB1 reward signal (Phase 2D)

**Status:** Accepted. 2026-05-07.

**Decision:** The Phase 2D budget orchestrator allocates each next rollout via standard UCB1 (Auer/Cesa-Bianchi/Fischer 2002) over three discrete arms: `prosecution-rollout`, `defense-rebuttal`, `jury-round`. The reward signal for one rollout is:

```
reward = clamp(0, 1, 0.5 * graphNodeDelta / (graphNodeDelta + 5)
                       + 0.5 * max(0, juryConfidenceDelta))
```

where `graphNodeDelta` is the increase in the evidence graph's node count produced by the rollout, and `juryConfidenceDelta` is the change in the verdict node's confidence (post − pre). The two terms are weighted equally; the graph term is bounded via `x / (x + 5)` so a single rollout that adds many nodes cannot starve the others, and the confidence term is clamped to non-negative so a confidence drop does not produce a negative reward (UCB1 assumes non-negative bounded rewards).

**Rationale:** The orchestrator has no oracle for "this rollout produced new information," so the reward proxies are observable artifacts of the rollout: how many graph nodes appeared and how the Jury's confidence shifted. Both signals are deterministic given the same seed, which preserves the determinism contract. The bounded-fraction transform on `graphNodeDelta` is preferred over a raw count because UCB1 calibration assumes rewards in `[0, 1]`; an unbounded reward would inflate one arm's mean and turn the bandit into a one-arm policy.

**Consequences:**

- The reward function lives next to the orchestrator (not deep inside the bandit) so it can be replaced without touching UCB1.
- The bandit state is initialized empty per run; we do not carry exploration history across runs because the patches are different bandits.
- Exploration coefficient `c` defaults to 2 (textbook UCB1). Adjusting it is an ADR change, not a code-level decision.
- The allocation trace is recorded into the bundle so a replay can reconstruct exactly which arm was pulled at which step under which UCB scores.

---

## ADR-004: Defender model assignment moved from `gemma4:26b-a4b-it-q8_0` to `gemma4:e4b-it-q8_0`

**Status:** Accepted. 2026-05-07. Supersedes the Defender row of ADR-001.

**Decision:** The Defender now runs on `gemma4:e4b-it-q8_0`, the same model the Prosecutor and Court Reporter use. The 26B MoE variant is no longer pinned in `runtime.lock.json` for production paths.

**Rationale:** ADR-001 paired the Defender with the 26B MoE variant for "high-throughput reasoning." In practice, the q8_0 quants of all three originally-assigned models (e4b 11 GB + 26b-a4b 28 GB + 31b 33 GB = 72 GB) exceed Ollama's effective VRAM budget on the consumer M5 Max hardware Phase 1 was developed on. Each Court row triggers two model swaps (e4b→26b for the Defender, 26b→31b for the Jury); under load (Phase 2F bench against 100 patches), Ollama 0.23.1 occasionally hangs mid-swap and our requests time out even with a 30-minute undici dispatcher. The first MaliciousPatch-Bench smoke saw 60% of Court rows fail this way.

Collapsing the Defender to e4b leaves two distinct model files (e4b 11 GB, 31b 33 GB = 44 GB) which fit in VRAM with headroom on any 64 GB+ Mac. Architecturally this matches what ADR-001 already accepted for the Court Reporter ("two roles share a model file. The runtime treats them as distinct agents (distinct prompts, distinct seeds, distinct exhibits)"). The Defender's task — rebut Prosecutor exhibits one at a time — does not actually require the MoE's reasoning headroom; the bottleneck was prompt-following, which `format: 'json'` plus a tighter system prompt addresses for any Gemma 4 size.

**Consequences:**

- `runtime.lock.json` drops the `gemma4:26b-a4b-it-q8_0` entry from the active set. The lockfile retains it as a legacy reference only.
- Every recorded bundle generated before this ADR has a different defender `responseHash`. The Phase 1 fixture is re-recorded; the cross-machine fixture (`test-fixtures/replay-fixture.verdict`) is regenerated.
- Bench's Court runs no longer thrash models, eliminating the dominant failure mode in `bench/RESULTS.md`.
- The contest pitch's "four models" framing remains accurate at the variant-tag level (e4b, 31b are two; the e4b shared between Prosecutor, Defender, and Court Reporter is one model file run with three distinct prompts and three distinct seeds, exactly as ADR-001 already framed for the Court Reporter case).
- The 26B MoE variant remains a future option if the contest demo runs on hardware with enough VRAM. ADR-001's rationale for the MoE choice is preserved here and can be re-activated by reverting the constant in `src/agents/defender.ts` and re-pinning the digest.
