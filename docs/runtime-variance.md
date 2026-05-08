# Runtime Variance Report

Phase 2G measurement of residual quantized-inference variance per platform. The replay subcommand uses the dev-machine variance below as the default `--tolerance` so a bundle generated here replays cleanly under typical drift.

## Methodology

Two measurements: this developer machine and the GitHub Actions CI runner.

### Developer machine — real Ollama

Script: `pnpm tsx scripts/measure-variance.ts <bundle-path> --n 10`

For each of N=10 runs, the script reuses the bundle's recorded `baseSeed` and `createdAt`, builds a fresh LLM client against the local Ollama daemon, and calls `replayBundle` with `tolerateHashMismatch: true` (so divergence is observed, not aborted). The script records per-agent recorded vs replay hashes and reports the per-run divergence fraction.

Target bundle: `bundles/236da0e43efbf4a88fd10366c29c25b6483c6ac7dc6177ef53937f4e10dff37b.verdict` — fresh sample-patch run on current HEAD with all Phase 2 flags off (legacy path).

### CI runner — stub LLM

CI does not have Ollama installed. The cross-machine test in `src/runtime/cross-machine-replay.test.ts` instead loads the committed `test-fixtures/replay-fixture.verdict`, reconstructs the same canned agent responses via the deterministic stub (`scripts/regenerate-replay-fixture.ts`), and asserts a strict-tolerance replay (`tolerance=0`) is bit-identical. The fixture exercises the same codepath as a real replay; what it cannot measure is true LLM-level quantization variance, only that the replay infrastructure survives a cross-machine round trip.

A full real-Ollama variance measurement on CI is deferred (would require setting up a 33 GB model download and a multi-minute GPU/CPU job per workflow run).

## Results

### Developer machine — Bradleys-MacBook-Pro.local (10-replay run on 2026-05-08)

- **Bundle:** `bundles/236da0e43efbf4a88fd10366c29c25b6483c6ac7dc6177ef53937f4e10dff37b.verdict` (fresh sample-patch, legacy path, baseSeed `run-sample-patch`).
- **Ollama version:** 0.23.1 (matches `runtime.ollama.version` in the bundle).
- **Node version:** 24.15.0.
- **Models:** all three pinned digests in `runtime.lock.json` matched at replay time (no runtime drift).
- **N runs:** 10.
- **Full-match runs:** **10/10**.
- **Per-agent mismatch count (out of 10):** prosecutor 0, defender 0, courtReporter 0, jury 0.
- **Per-run divergence fraction:** [0, 0, 0, 0, 0, 0, 0, 0, 0, 0].
- **Recommended `--tolerance`:** **0.0** — zero residual quantized variance observed on this hardware for the sample-patch fixture.

Raw JSON sidecar: `docs/variance-236da0e43efb.json` (regeneratable via
`pnpm tsx scripts/measure-variance.ts <bundle> --n 10`).

### CI runner

- **Host:** GitHub Actions `ubuntu-latest`.
- **LLM:** stub (canned per-agent responses).
- **N runs:** every CI run executes the cross-machine replay test once.
- **Tolerance:** 0 (strict). Any divergence fails CI.
- **Result:** see the latest `Unit + smoke tests` step in CI.

## Loud failure path

The CLI's `replay` subcommand emits an actionable error when the digest mismatch exceeds tolerance. The error names every divergent agent and surfaces both the recorded and replay hashes so the operator can act. The exact format below was captured by `pnpm tsx scripts/demo-loud-failure.ts` against a synthetic divergent stub:

```
replay: digest mismatch on 1/4 agent(s); observed divergence fraction 0.250 (tolerance 0.000)
  jury: recorded=bf9496e893a02c8b4d6f30f81459bf888aa14ac8c6bd0f8d84ab5886bd3af9fd replay=adf295592a947e8af241a47ea5909e5ae2c59b44016dd247713880d83628afec
either re-record the bundle on this hardware or pass --tolerance <fraction> with a value at least equal to the observed divergence
```

The same format is exercised by `src/runtime/replay-tolerance.test.ts` (test: "renderDigestMismatchError produces an actionable error naming the divergent agent and hashes") and reproducibly via `scripts/demo-loud-failure.ts`.

## How to use the tolerance flag

- `--tolerance 0` (default): strict, any agent divergence is a failure.
- `--tolerance 0.25`: tolerate up to 25% of agents diverging (1-of-4 mismatches pass).
- `--tolerance 1`: equivalent to the legacy `--tolerate-hash` boolean.

The default is conservative on purpose: replay refuses by default and the operator must explicitly opt in to tolerance. The dev-machine numbers above set the _recommended_ tolerance for routine replays on this hardware; bundles generated on different hardware should be re-measured.
