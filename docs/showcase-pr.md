# Showcase PR

The showcase target for the Phase 3 demo and v0.1.0 release.

## Target

[vitejs/vite-plugin-react#1192](https://github.com/vitejs/vite-plugin-react/pull/1192): `fix(rsc): include bundled server CSS when cssCodeSplit is false`.

Merged 2026-04-23 by `schiller-manuel` into `main` at merge commit `2845b9ff024c0958f30b923f9fef3920f731ecd8`. Base ref `323ccd72576be636b50baa7d9ce816cc94d5991e`. Two files changed: `packages/plugin-rsc/src/plugin.ts` (+39/-3) and `packages/plugin-rsc/e2e/css-code-split.test.ts` (+69).

## Why this PR

The PR is a real correctness fix in the RSC server-CSS pipeline. It is small enough to read in one sitting, multi-file enough to exercise the monorepo trace (`plugin.ts` is imported across the `plugin-rsc` package), and ships with an e2e test, so the Court has both production code and test coverage to reason about. It is recent (under three weeks before the contest cutoff) and lives in a high-visibility OSS repo, which makes the showcase verdict legible to reviewers without having to teach them the surrounding codebase.

## Differentiators this exercises

1. Evidence graph (Phase 2A): the patch produces multiple linked exhibits (build-time CSS bundling change, runtime CSS injection path, new e2e test). The Jury graph should connect those nodes via `supports` and `depends-on` edges.
2. Precedent ledger (Phase 2B): on the second showcase run (beat 6 of the demo), the Jury should cite the first run's verdict because the second PR touches the same `plugin-rsc` surface.
3. Monorepo impact tracing (Phase 2C): `plugin.ts` is the entry point of the `plugin-rsc` package; the ripple set should pick up sibling files in `packages/plugin-rsc/src/` that re-export or import it.
4. Dynamic budget (Phase 2D): the `--budget 50m` flag gives the bandit room to allocate extra prosecution rollouts on the bundling logic and extra jury rounds on the CSS-injection invariant.

## Verifying the resulting bundle

After `bin/run-showcase.sh` writes the bundle to `bundles/showcase/<id>.verdict`, verify three things:

1. Signature: `pnpm gemmacourt verify ./bundles/showcase/<id>.verdict` exits 0.
2. Replay: `pnpm gemmacourt replay ./bundles/showcase/<id>.verdict` reports `bit-identical` (or stays inside the documented tolerance from `docs/runtime-variance.md`).
3. Content sanity: open the bundle JSON and confirm
   - `agents.jury.output.evidenceGraph` has at least one citation node referencing `packages/plugin-rsc/src/plugin.ts`,
   - the ripple set (citation nodes with `kind = "monorepo"`) is non-empty,
   - `allocationTrace.steps[]` covers all three arms (`prosecution-rollout`, `defense-rebuttal`, `jury-round`).

If the second showcase run is recorded, also confirm `agents.jury.output.evidenceGraph` contains a `precedent` node whose `bundleId` matches the first run.
