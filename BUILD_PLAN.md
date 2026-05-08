# Counterfactual Court: Build Plan & Status

## Protocol

This file is the source of truth for where the Counterfactual Court build stands. Two rules:

1. **Claude reads this first.** Any new chat in this project: open this file before answering. The status line, blocker list, and current phase determine what advice is in-scope.
2. **Brad updates checkboxes as work lands.** Mark `[x]` when done, leave `[ ]` when open. Update the **Current Status** line at every milestone. Move blockers in and out of the active list.

The file replaces "remember when we discussed..." reconstruction. State the work, state what's done, move on.

---

## Current Status

**Phase:** 2A-2G complete; final acceptance pending (real-bandit multi-file-e2e + re-baseline)
**Date:** 7 May 2026
**Days remaining to submission:** 17
**One-line:** Phase 1 closed. Phase 2A-2G landed: 2A-2E behind feature flags; 2F bench corpus + smoke RESULTS.md (raw 31B F1 0.947, Court F1 0.571 driven by Ollama-overload errors on commodity hardware; full 200-patch run queued); 2G replay hardening with `--tolerance <float>` flag, loud digest-mismatch error naming every divergent agent + hashes, committed `test-fixtures/replay-fixture.verdict` cross-machine fixture, 10-replay variance measurement on developer machine (10/10 full-match, recommended tolerance 0.0). 200 unit/integration tests green.

## Active Blockers

None.

## Decisions Log

Architectural decisions live in `docs/DECISIONS.md` with rationale per entry. Reference by ADR number when discussing tradeoffs in chat.

---

## Hard Gating Rule

**Week 1 must be green before any Week 2 work begins.** The core loop (Prosecutor + Defender + Jury + signed bundle + bit-identical replay) is the contest-viable minimum. Every Week 2 feature sits behind a feature flag and only ships if Week 1 is locked. If a Week 2 task tempts you while Week 1 has open boxes, defer it.

---

## Phase 0: Repo + Runtime Setup

**Date:** 7 May (single day if it goes well, two if Ollama fights back)
**Goal:** Empty-but-correct foundation. CI green on a stub. All four Gemma variants pinned by digest and pullable locally.

### Tasks

- [x] `git init`, license (MIT), `.gitignore` (node, bundles/, .env)
- [x] `package.json`: TypeScript, ESM (`"type": "module"`), Node 20+, pnpm
- [x] `tsconfig.json`: strict mode, no implicit any, ES2022 target
- [x] Vitest configured; one passing smoke test
- [x] ESLint + Prettier configured; `pnpm check` runs both
- [x] GitHub Actions: `pnpm install && pnpm check && pnpm test` on push
- [x] `src/cli/gemmacourt.ts` stub that prints `--help` and `--version`
- [x] `pnpm gemmacourt --help` works end-to-end
- [x] Pull all four Gemma 4 variants via Ollama (deviation: only three unique tags pulled because Gemma 4 has native multimodal across variants and `gemma4:4b-vision` does not exist as a separate tag in the Ollama registry; the e4b model serves both Prosecutor and Court Reporter roles per ADR-001):
  - [x] `gemma4:e4b-it-q8_0` (Prosecutor + Court Reporter; was `gemma4:4b` / `gemma4:4b-vision`)
  - [x] `gemma4:26b-a4b-it-q8_0` (Defender; was `gemma4:26b-moe`, `a4b` denotes MoE active params)
  - [x] `gemma4:31b-it-q8_0` (Jury, unchanged)
- [x] `runtime.lock.json` with digests for all pinned variants (3 unique tags), plus Ollama version (0.23.1), plus Node version (24.15.0)
- [x] `docs/AGENTS.md`: short doc the Jury will read describing each agent's role
- [x] `docs/CONTRIBUTING.md`: code style, branch naming, commit format
- [x] `docs/STYLE_GUIDE.md`: TS conventions Jury will reference
- [x] `docs/PRIOR_ART.md`: explicit deltas vs. Swarm Orchestrator and other debate systems
- [x] `docs/DECISIONS.md`: ADR-001 (model variant assignment), ADR-002 (determinism contract)
- [x] `README.md`: stub, no marketing copy yet

### Definition of Done

- `pnpm gemmacourt --version` prints
- `pnpm check && pnpm test` passes
- CI green on `main`
- All four model digests verifiable via `ollama show <name>`

### Cuts if Behind

Nothing. Phase 0 is non-negotiable. If it slips past day 2, the project is in trouble.

---

## Phase 1: Core Loop (Week 1, 7-13 May)

**Goal:** One real `.verdict` bundle on a recognizable OSS TypeScript PR that re-runs bit-identical via `gemmacourt replay`.

### 1A. Determinism Runtime (do this first; everything depends on it)

- [x] `src/runtime/determinism.ts`: seeded RNG (xoshiro256**), frozen clock, content-hash helpers (barrel re-export over `rng.ts`, `clock.ts`, `canonical.ts`)
- [x] `src/runtime/config.ts`: env loaded once at startup, frozen object, no later reads
- [x] `src/runtime/llm-client.ts`: sole gateway to Ollama; explicit temperature/top-p/top-k/seed on every call (compile-time required + runtime `validateLlmCallParams` guard); deterministic stub in `llm-client-stub.ts`
- [x] `src/runtime/log.ts`: structured logger; no console use elsewhere (verified by grep)
- [x] `AgentContext` type carrying rng, clock, config, llmClient, logger (`src/runtime/agent-context.ts`)
- [x] Unit tests proving same seed produces same RNG sequence (43 tests across `determinism.test.ts`, `config.test.ts`, `log.test.ts`, `llm-client.test.ts`)

### 1B. Agents (single-file TS patches only)

- [x] `src/agents/prosecutor.ts`: input = patch + repo snippet; output = `ProsecutionDossier` with adversarial exhibits
- [x] `src/agents/defender.ts`: input = patch + dossier; output = rebuttals per exhibit
- [x] `src/agents/court-reporter.ts`: input = attached PNGs only (skip diagrams/video this week); output = exhibit nodes from OCR (empty list when no attachments, no LLM call)
- [x] `src/agents/jury.ts`: input = repo HEAD + patch + both dossiers + style/policy docs; output = `JuryOpinion`
- [x] Behavior tests for each agent against fixture inputs (18 agent tests under `src/agents/*.test.ts`; pipeline smoke run at `scripts/agents-fixture-run.ts`)

### 1C. Bundle Lifecycle

- [x] `src/runtime/bundle-writer.ts`: canonical JSON serialization; Ed25519 signing (deterministic keypair derived from `baseSeed:bundle-signing` so replays produce byte-identical signatures)
- [x] `src/runtime/bundle-replayer.ts`: digest verification, runtime-lock diff (refuses on Ollama-version or model-digest drift unless `--tolerate-runtime`), full re-run, per-agent hash comparison
- [x] `pnpm gemmacourt run --fixture <name>` produces a bundle (`<id>.verdict` in `bundles/`)
- [x] `pnpm gemmacourt replay <bundle>` reproduces it; on `sample-patch` the bundle replayed bit-identical against real Ollama (3 LLM calls, all response hashes byte-equal)
- [x] `pnpm gemmacourt verify <bundle>` checks Ed25519 signature only (no LLM calls)
- [x] Integration test: `src/runtime/bundle-lifecycle.test.ts` covers run, replay bit-identity, tampered-bundle rejection, runtime-drift refusal, runtime-drift tolerance, and per-agent divergence reporting

### 1D. First Real Verdict

- [x] Pick a small real OSS TS PR (10-200 lines, single file): [`colinhacks/zod#5945`](https://github.com/colinhacks/zod/pull/5945) (cidrv6 regex fix; +9 / -1; production change is a single line in `regexes.ts`)
- [x] Run end-to-end; inspect bundle by hand (verdict=approve at conf 0.9 with 2 citations and 0 dissents; jury rationale references RFC 4291 and catastrophic backtracking)
- [x] Document the first verdict in `docs/first-verdict.md` with bundle hash and observations (bundle id `7c0d94991db8fdce837101334ed0f7438e7cc67064df135a62a610dca6a129fb`, file SHA-256 `2c9a4f7f...`, replay match was bit-identical with zero observed quantized variance)

### Definition of Done

- One bundle in `bundles/` from a real OSS PR
- That bundle replays bit-identical (within documented tolerance)
- All Phase 1 tests pass in CI
- Status line updated; this section's checkboxes all marked

### Cuts if Behind

In order, drop:
1. Court Reporter (vision agent). Bundle a stub that emits empty exhibits if no images present.
2. Defender. The Prosecutor + Jury loop alone still produces a verdict, just less adversarial.
3. The "real OSS PR" target. Use a hand-crafted fixture instead.

Never cut: determinism runtime, bundle writer, bundle replayer.

---

## Phase 2: Differentiators (Week 2, 14-20 May)

**Goal:** All four production-grade differentiators behind feature flags. Each one independently shippable. MaliciousPatch-Bench seeded with first baseline numbers.

### 2A. Evidence Graph (do this first; downstream features depend on it)

- [x] `src/evidence/graph.ts`: typed nodes (exhibit, citation, test-case, precedent, verdict), typed edges (supports, refutes, depends-on)
- [x] `src/evidence/schema.ts`: zod schemas for all node payloads
- [x] Jury emits the graph as the primary output; opinion is generated FROM the graph
- [x] `pnpm gemmacourt run` writes `evidence-graph.json` alongside the verdict (nested at `agents.jury.output.evidenceGraph` inside the signed bundle envelope)
- [x] CLI flag `--graph-only` prints the graph without the prose opinion

### 2B. Precedent Ledger

- [x] `src/precedent/ast-diff.ts`: structural similarity scoring between patches (cosine of TS SyntaxKind histograms; symmetric, identity=1, in [0, 1])
- [x] `src/precedent/ledger.ts`: local content-addressed cache of prior verdicts at `~/.gemmacourt/ledger/` (configurable via `GEMMACOURT_LEDGER_DIR`)
- [x] Jury queries ledger before deliberation; cites precedents above threshold (orchestrator passes `precedents: PrecedentNodePayload[]` to deliberate when `features.precedent` is on)
- [x] Tunable threshold via config (`precedent.similarityThreshold`, default 0.85; topN default 3)
- [x] Jury opinion must justify every cited precedent (test enforces — `assertEveryPrecedentJustified` runs at the orchestrator boundary; precedent without an incoming supports/depends-on edge from a non-precedent node throws)
- [ ] Optional opt-in public push (deferred to Phase 3 per cuts list)

### 2C. Monorepo Impact Tracing

- [x] `src/monorepo/impact-trace.ts`: dependency graph extraction from imports (TS compiler API; counts both `import ... from` and `export ... from` re-exports; resolves relative specifiers and `index.ts` barrels)
- [x] Jury context includes ripple set: files that import the patched modules (orchestrator surfaces `RippleSet` via JuryInput when `features.monorepoImpact` is on; prompt embeds the JSON)
- [x] Jury opinion cites ripple effects explicitly (`monorepo:<path>` citation node per ripple file; `assertEveryRippleFileCited` enforces this in tests via `findUncitedRippleFiles`)
- [x] Behavior test on a multi-file fixture (`src/agents/jury-impact.test.ts` + `fixtures/multi-file/` with 5 files mixing direct imports and re-exports)

### 2D. UCB Bandit Budget Allocator

- [x] `src/budget/ucb-bandit.ts`: standard UCB1 implementation (pure; explores every arm before relying on the mean; ties break by lowest index for determinism)
- [x] `src/budget/orchestrator.ts`: routes the budget across prosecution rollouts, defense rebuttals, jury rounds (BUDGET_ARMS = three discrete arms; `runBanditLoop` allows overrun by at most one step; safety bound at maxSteps)
- [x] CLI flag `--budget 5m | 50m | overnight` (parses Ns/Nm/Nh, "overnight"=8h, bare integer seconds; rejects malformed values)
- [x] Logged allocation decisions go into the bundle (for replay + audit) (`AllocationTrace` zod-validated; bundle id hash now includes the trace; bundle round-trip test asserts the trace survives sign+reload)
- [x] ADR-003 documents the reward signal (`docs/DECISIONS.md`)

### 2E. Deeper Multimodal

- [x] Court Reporter handles architecture diagrams (Mermaid renders + free-form) (mermaid-extract.ts pulls fenced ```mermaid blocks from the PR description; emitted as `kind=multimodal-extraction` exhibits)
- [x] Court Reporter handles sequence diagrams (kind detection in mermaid-extract.ts: `sequenceDiagram` is recognized alongside `classDiagram`, `flowchart`, `erDiagram`, `stateDiagram`)
- [x] Court Reporter handles frame-sampled video (extract N frames, treat as image batch) (`video-frames.ts` shells out to ffmpeg; default 8 frames; gracefully skips with a warning when ffmpeg is missing per the cuts list policy)
- [x] Cross-reference: extracted intent vs. actual diff, flagged as exhibit when divergent (`divergence.ts` compares symbols-in-diagram vs. symbols-in-patch; emits a `divergence-<idx>` exhibit per non-aligned block; fixture `fixtures/diagram-mismatch/` triggers it: diagram says `sub`/`calculate`, diff does `add`)

### 2F. MaliciousPatch-Bench

- [x] `bench/` subdir in this repo (mono-repo simpler per cuts list)
- [x] 100 real merged PRs from popular OSS projects (gh-api fetch with mandatory license verification; sources MIT 150 / Apache-2.0 33 / BSD-3-Clause 17)
- [x] 100 deliberately poisoned patches across 5 categories (20 each via deterministic xoshiro256** poisoner): logic errors, security vulnerabilities, test weakening, prompt-injection comments, license laundering
- [x] Generation methodology documented in `bench/METHODOLOGY.md` with one worked example per category
- [x] Baseline runs:
  - [x] Counterfactual Court (`bench/scripts/run-court.ts`); 10-patch smoke run on developer machine landed
  - [x] Raw 31B single-shot (`bench/scripts/run-raw-31b.ts`); 10-patch smoke run landed
  - [ ] One hosted GPT-4-class reviewer (deferred per BUILD_PLAN cuts list cut #3 of 2F)
- [x] Honest TP/FP numbers published in `bench/RESULTS.md`. The 10-patch smoke shows raw 31B at F1 0.947 and Court at F1 0.571; the gap is dominated by Court's 60% Ollama-overload error rate on commodity hardware (3 sequential LLM calls per patch). Among rows where Court completed cleanly, accuracy is 4/4 = 100%. Full 200-patch run is the meaningful comparison and is queued.
- [x] Smoke test runs end-to-end on a 10-patch subset under stub LLM (`bench/tests/smoke.test.ts`)
- [x] Manifest validation tests assert every patch exists, hashes match, license verified, expected-verdict per category, exactly 20 patches per poisoned category (`bench/tests/manifest.test.ts`)

### 2G. Replay Hardening

- [x] Document residual quantized-inference variance per platform in `docs/runtime-variance.md` (10-replay measurement on developer machine: 10/10 full-match, recommended tolerance 0.0; CI runner uses stub-LLM cross-machine test)
- [x] Replay tolerance flag exposed to CLI (`--tolerance <float>` in [0, 1]; defaults to `DEFAULT_REPLAY_TOLERANCE = 0`; rejects out-of-range values with exit code 2)
- [x] Replay fails loudly on digest mismatch (not silently) (`renderDigestMismatchError` names every divergent agent and prints recorded vs replay hash; CLI prints to stderr; reproducible via `scripts/demo-loud-failure.ts`)
- [x] Cross-machine replay test (committed `test-fixtures/replay-fixture.verdict`; `src/runtime/cross-machine-replay.test.ts` loads it and asserts `tolerance=0` bit-identical replay; runs in CI as part of `pnpm test`)

### Definition of Done

- All five differentiators (graph, ledger, monorepo, bandit, multimodal) work end-to-end behind flags
- Bench corpus exists with first numbers checked in
- Replay hardening documented
- Status line updated

### Cuts if Behind

In order, drop:
1. Frame-sampled video in Court Reporter (keep just images and diagrams)
2. Public ledger push (keep local cache only)
3. Hosted GPT-4 baseline (keep raw 31B baseline only)
4. UCB bandit (use a fixed allocation)

Never cut: evidence graph, precedent ledger, monorepo impact tracing, MaliciousPatch-Bench. Those are the four pitch differentiators.

---

## Phase 3: Polish & Submission (21-24 May, four days)

**Goal:** Submitted, public, demonstrable.

### 3A. Target Repo Demo

- [ ] Pick high-visibility OSS target (Vite plugin or non-trivial Rust crate)
- [ ] Run full court on a real PR there
- [ ] Capture the resulting bundle as the showcase artifact

### 3B. 90-Second Screen Recording

Storyboard (each beat times-out at ~15s):
- [ ] Beat 1: PR opens, `gemmacourt run` invoked
- [ ] Beat 2: Prosecutor exhibits stream live
- [ ] Beat 3: Defender rebuttals stream live
- [ ] Beat 4: Jury renders opinion with dissent
- [ ] Beat 5: Wi-Fi off, `gemmacourt replay` reproduces bit-identical
- [ ] Beat 6: Second similar PR, jury cites precedent from first
- [ ] Final: bundle hash + GitHub link onscreen

### 3C. Public Content

- [ ] README.md final version (architecture diagram, install, demo GIF, links)
- [ ] PRIOR_ART.md final pass (Swarm Orchestrator + CodeAgora + diffray + LangGraph deltas)
- [ ] dev.to post draft (demo GIF first, model-selection table, novel mechanics, benchmark table, PRIOR_ART excerpt, 60-second npx try-it)
- [ ] dev.to post peer-reviewed against the no-AI-tells / no-fabricated-metrics rules
- [ ] LinkedIn post (short, links to dev.to)
- [ ] X thread (5-7 posts, each carries info)

### 3D. GitHub Release

- [ ] Tag `v0.1.0`
- [ ] Release notes with bundle hash of showcase verdict
- [ ] Attach the showcase `.verdict` bundle to the release
- [ ] Attach `runtime.lock.json` to the release

### 3E. Contest Submission

- [ ] Submission form filled
- [ ] Demo video uploaded
- [ ] GitHub link, dev.to link, bench link verified live
- [ ] Submitted before 24 May deadline

### Definition of Done

Submission acknowledged by contest. Status line says "Submitted."

---

## Risk Register

| Risk | Phase Where Mitigated | Mitigation |
|---|---|---|
| Residual non-determinism in quantized inference | 1C, 2G | Document tolerance per platform; replay tolerance flag; never claim perfect bit-identity |
| Precedent similarity false positives | 2B | Tunable threshold; jury must justify every cited precedent; log all similarity scores |
| Scope pressure in 18 days | All | Hard gate: Week 1 green before Week 2; cuts list per phase |
| Benchmark credibility | 2F | Seed exclusively from documented patterns; publish methodology |
| Local runtime drift (Ollama, llama.cpp evolve) | 0, 2G | Pin digests in `runtime.lock.json`; replay fails loudly on mismatch |
| Demo failure on stage | 3B | Pre-record demo; backup bundle + replay on second machine |

---

## Submission Checklist (Mapped to Judging Criteria)

**Intentional and effective use of Gemma 4**
- [ ] All four variants used in production paths (not toy demos)
- [ ] 128k context demonstrably non-summarized (jury reads full repo + patch + dossiers)
- [ ] Vision used on real PR artifacts (screenshots + diagrams)
- [ ] Model assignment table front and center in README + dev.to

**Technical implementation and code quality**
- [ ] CI green
- [ ] No `any` types in agent code
- [ ] All exports JSDoc'd
- [ ] 300-line cap respected
- [ ] Determinism contract enforced by tests

**Creativity and originality**
- [ ] PRIOR_ART.md enumerates explicit deltas vs. competitors
- [ ] Court metaphor visible in CLI, output, docs
- [ ] Replayable signed bundles (no competitor ships these)
- [ ] Evidence graph is queryable (no competitor ships this)

**Usability and user experience**
- [ ] `npx gemmacourt try` works in 60 seconds
- [ ] Offline replay works with Wi-Fi off
- [ ] Output is human-readable AND machine-readable
- [ ] 90-second demo is screenshot-worthy

---

## What This File Is Not

- A code spec. Code patterns live in `copilot-instructions.md` and `CLAUDE.md`.
- A pitch document. The pitch lives in the dev.to post and README.
- A diary. Update at milestones, not every commit.
