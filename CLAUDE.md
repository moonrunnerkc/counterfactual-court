# CLAUDE.md

This file gives Claude Code the context it needs to work in the Counterfactual Court repo without breaking the determinism contract.

## Project identity

Counterfactual Court is a local-first, offline-capable PR review system. Four Gemma 4 agents argue and deliberate; the output is a signed, replayable `.verdict` bundle. Built for the Gemma 4 Build track (deadline 24 May 2026). TypeScript, Node 20+, ESM, Vitest, local Gemma via Ollama or llama.cpp.

The repo's primary product is not the code; it's the `.verdict` bundles the code produces. Every architectural decision serves that.

## Commands you'll use

```bash
# install
pnpm install

# build (tsc, no bundler)
pnpm build

# unit + behavior tests (fast, no LLM calls)
pnpm test

# integration suite (runs real Gemma; slow)
pnpm test:integration

# run a single test file
pnpm test src/agents/prosecutor.test.ts

# lint + typecheck
pnpm check

# format
pnpm format

# end-to-end on a fixture PR
pnpm gemmacourt run --fixture vite-plugin-fixture --budget 5m

# replay an existing bundle (must be bit-identical)
pnpm gemmacourt replay ./bundles/2025-05-12-7a3f.verdict

# verify a bundle's signature only
pnpm gemmacourt verify ./bundles/2025-05-12-7a3f.verdict

# regenerate the malicious-patch-bench corpus
pnpm bench:regenerate

# run the bench against the current build
pnpm bench:run
```

## Local Gemma runtime

The runtime expects Ollama on `localhost:11434` by default. Models in use:

- `gemma4:4b` (Prosecutor)
- `gemma4:4b-vision` (Court Reporter)
- `gemma4:26b-moe` (Defender)
- `gemma4:31b-it-q8_0` (Jury, 128k context)

The exact model digests are pinned in `runtime.lock.json`. If `ollama list` shows different digests, replay will refuse to run. Pull explicitly:

```bash
ollama pull gemma4:31b-it-q8_0@sha256:<digest from runtime.lock.json>
```

If you swap runtimes (Ollama to llama.cpp or vice versa), update `runtime.lock.json` and document the variance you observe in `docs/runtime-variance.md`. Don't silently change runtimes.

## The determinism contract

This is the rule that overrides every other consideration in the repo:

> Any code path that runs during agent execution must be reproducible given the same inputs, seeds, model hashes, and runtime version.

Practical consequences:

1. **No `Math.random()`, `Date.now()`, `crypto.randomUUID()` in agent or orchestrator code.** Use `ctx.rng` and `ctx.clock`. The seeded RNG is in `src/runtime/determinism.ts`.
2. **No environment variable reads outside `src/runtime/config.ts`.** Config loads once at startup and is frozen.
3. **No file-system writes outside `src/runtime/bundle-writer.ts`.** Agents return values; the writer persists them.
4. **LLM calls go through `src/runtime/llm-client.ts`.** Temperature, top-p, top-k, and seed are explicit on every call. No defaults.
5. **JSON parsing of model output uses zod schemas in `src/evidence/schema.ts`.** Never `JSON.parse` raw model output into the evidence graph.

If you're about to break any of these, stop and ask. There's almost always a better way that preserves replay.

## Architecture in 60 seconds

```
PR + budget knob
       |
       v
+-------------------+
|   Orchestrator    |  UCB bandit allocates the budget across:
| (budget/orch.ts)  |    - prosecution rollouts
+-------------------+    - defense rebuttals
       |                 - jury deliberation rounds
       v
+----------+   +----------+   +----------------+
|Prosecutor|   |Court Rep |   |   Defender     |
|  (4B)    |   |(4B vision)|  |  (26B MoE)     |
+----------+   +----------+   +----------------+
       \         |               /
        \        v              /
         \  +----------+       /
          \ | Evidence |      /
           \|  Graph   |     /
            +----------+    /
                  |        /
                  v       v
            +---------------+
            |     Jury      |  reads repo HEAD + patch + dossiers
            | (31B, 128k)   |  + style guides + AGENTS.md + precedents
            +---------------+
                  |
                  v
            +---------------+
            | Bundle Writer |  signed .verdict
            +---------------+
```

The Jury is the only agent that sees the whole picture. The Prosecutor and Defender see only the patch plus their own working set. The Court Reporter sees only the multimodal attachments.

## File layout

```
src/
  agents/         prosecutor, defender, court-reporter, jury
  runtime/        determinism, llm-client, bundle-writer, bundle-replayer, log, config
  precedent/      ast-diff, ledger
  evidence/       graph, exhibit, schema
  budget/         ucb-bandit, orchestrator
  monorepo/       impact-trace
  bench/          malicious-patch-bench
  cli/            gemmacourt
test/
  integration/    end-to-end fixture runs
bundles/          generated, gitignored
fixtures/         PR fixtures used by tests
docs/             architecture notes, runtime variance log, PRIOR_ART.md
runtime.lock.json model digests, runtime versions, container hashes
```

300-line cap per file. When you cross it, decompose. Never append for convenience.

## Code style (non-negotiable)

- Named exports only. No `export default`.
- Kebab-case filenames.
- Full JSDoc on every exported function (`@param`, `@returns`, `@throws`).
- No `any`. Use `unknown` and narrow.
- No em dashes anywhere (code, comments, docs, error messages).
- Errors include both what failed and what to do: `throw new Error('jury context exceeds 128k tokens (got 142k); reduce repo snapshot or split patch')`.
- DRY at three repetitions, not before. SOLID applied pragmatically.
- Tests describe behavior, not implementation. No mocks for things that can be tested directly.

## Workflow rules

**Branching.** Feature branches off `main`. Branch names: `feat/precedent-ledger`, `fix/jury-context-overflow`. No personal-namespace branches.

**Commits.** Conventional commits. Subject under 72 chars. Body explains *why*. When fixing a verdict regression, reference the bundle hash:

```
fix(jury): respect 128k token budget when repo snapshot is large

Repro: bundle 7a3f...
```

**PRs into this repo.** Every PR must pass `pnpm check` and `pnpm test`. Integration tests run on CI; if they're flaky, the determinism contract is broken somewhere and that's the bug, not the test.

**Never modify a signed bundle.** If a bundle is wrong, write a successor bundle that links to and supersedes it. Bundles in `bundles/` are append-only conceptually (the directory itself is gitignored, but the rule still holds for any artifact).

## Things that look reasonable but are wrong

- "I'll add a quick `Math.random()` for jitter; it's harmless." It breaks replay. Use `ctx.rng`.
- "I'll catch this and log; it's a non-critical path." Either rethrow with context or return a typed result. Silent catches hide determinism violations.
- "The schema is overkill for this small JSON." Schema validation at the LLM boundary is the only thing standing between malformed model output and a corrupted evidence graph.
- "I'll bump the temperature to get more creative rebuttals." Temperature changes are a config-level decision, not a code-level one. Update `runtime.lock.json` and document the rationale.
- "I'll use the latest Ollama; it has bug fixes." Pin first, upgrade deliberately, document variance.
- "This file is at 320 lines; I'll just add the new function." Decompose. The 300-line cap exists because long files mask determinism violations.

## When you find a bug in a generated bundle

1. Don't modify the bundle. Reproduce locally with `pnpm gemmacourt replay <bundle>`.
2. If replay reproduces, the bug is in the code path. Fix and commit; reference the bundle hash.
3. If replay diverges, the determinism contract is broken. That's a higher-priority bug than the original. File it first.

## When you're asked to add a feature

Check whether it can be added without touching the agent execution path. If yes, prefer that. The cost of breaking replay is high enough that adjacent changes (CLI flags, output formatting, bundle metadata) are usually preferable to changes inside the agents.

## When in doubt

Read `docs/PRIOR_ART.md` first. It enumerates the explicit deltas vs. Swarm Orchestrator and other debate-style systems, which is also the design rationale for most of the architecture choices in this repo.
