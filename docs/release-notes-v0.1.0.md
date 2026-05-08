# v0.1.0

First public release. Local-first PR review with four Gemma 4 agents and a signed, replayable verdict bundle.

## What lands in v0.1.0

The Phase 1 core loop and the Phase 2 differentiators, all behind feature flags so a smaller subset of the system is one CLI run away.

- Four agents wired through a single `AgentContext` with a seeded RNG, frozen clock, and a single LLM gateway.
- Ed25519-signed `.verdict` bundles. `gemmacourt verify` checks the signature offline; `gemmacourt replay` re-runs the agents and reports per-agent hash matches.
- Evidence graph as the Jury's primary output. Typed nodes (exhibit, citation, test-case, precedent, verdict) and typed edges (supports, refutes, depends-on), validated by zod at the model boundary.
- Local content-addressed precedent ledger at `~/.gemmacourt/ledger/`. Cosine similarity over TS SyntaxKind histograms. Tests assert every cited precedent has a justifying graph edge.
- Monorepo impact tracing. TS Compiler API extracts the import + re-export graph for the patched files; the Jury cites the ripple set as `monorepo:<path>` nodes.
- UCB1 budget bandit over three arms (`prosecution-rollout`, `defense-rebuttal`, `jury-round`) with a deterministic reward signal (ADR-003). Allocation trace is embedded in the bundle.
- Multimodal Court Reporter on Gemma 4 e4b's native vision: PNG OCR, Mermaid extraction from PR descriptions, ffmpeg frame samples, divergence exhibit when the diagram and the diff disagree.
- MaliciousPatch-Bench corpus: 100 real OSS PRs (MIT / Apache-2.0 / BSD-3) plus 100 deterministically poisoned counterparts across five categories.

## Model variants used

| Agent          | Variant                                                                | Pinned tag           |
| -------------- | ---------------------------------------------------------------------- | -------------------- |
| Prosecutor     | 4B-class edge instruction-tuned q8_0                                   | `gemma4:e4b-it-q8_0` |
| Defender       | 4B-class edge instruction-tuned q8_0 (distinct prompt + seed; ADR-004) | `gemma4:e4b-it-q8_0` |
| Court Reporter | 4B-class edge instruction-tuned q8_0 (native vision)                   | `gemma4:e4b-it-q8_0` |
| Jury           | 31B dense instruction-tuned q8_0, 128k context                         | `gemma4:31b-it-q8_0` |

The 26B MoE variant (`gemma4:26b-a4b-it-q8_0`) is documented in `runtime.lock.json` as a legacy reference. It was retired from production paths in ADR-004 after Phase 2F surfaced VRAM thrash on consumer 64 GB Macs.

## Runtime requirements

- Node 20 or newer (the lockfile records 24.15.0 as the developer-machine version).
- Ollama 0.23.1 with the three pinned digests in [`runtime.lock.json`](../runtime.lock.json) pulled. `pnpm gemmacourt replay` refuses to run on a different digest unless `--tolerate-runtime` is passed.
- Mac with at least 64 GB unified memory for the 31B Jury at q8_0. Smaller machines can run the smoke fixtures with `--budget` omitted.

## Residual variance

Replay is bit-identical on the developer machine (10/10 full match across `docs/runtime-variance.md`). On other hardware, residual quantized-inference variance is expected; the `--tolerance` flag exposes the documented per-platform number to replay so a small per-agent divergence does not look like a contract break. Set `tolerance` to the value documented for your platform; never silently smooth higher numbers.

## Showcase bundle

Showcase verdict from [vitejs/vite-plugin-react#1192](https://github.com/vitejs/vite-plugin-react/pull/1192) (`fix(rsc): include bundled server CSS when cssCodeSplit is false`):

```
bundle id: <fill in after running bin/run-showcase.sh>
sha-256:   <fill in after running bin/run-showcase.sh>
```

The bundle file is attached to this release. So is `runtime.lock.json`. Re-run the verdict locally:

```bash
pnpm gemmacourt verify ./<bundle>.verdict
pnpm gemmacourt replay ./<bundle>.verdict
```

## Bench numbers

The full 200-patch run (Court vs raw 31B single-shot) is queued; numbers land in `bench/RESULTS.md` as soon as the run completes. The 10-patch smoke (after the ADR-004 Defender swap closed the Ollama-overload error path) had Court at F1 0.947 against raw 31B's 0.947, with the gap dominated by errors in the original Court setup rather than accuracy.

## Known limitations

- The hosted GPT-4-class baseline in `bench/` is deferred per the BUILD_PLAN cuts list (cut #3 of 2F).
- The optional public ledger push (Phase 2B last task) is deferred to a later release; the local cache is the only ledger surface in v0.1.0.
- The contest demo runs on a 64 GB-class Mac. The 26B MoE variant remains an option on hardware with more headroom; ADR-001's rationale for the MoE assignment is preserved in ADR-004 and can be re-activated.

## Links

- Repo: <https://github.com/moonrunnerkc/counterfactual-court>
- Prior art and deltas: [`docs/PRIOR_ART.md`](./PRIOR_ART.md)
- Architectural decisions: [`docs/DECISIONS.md`](./DECISIONS.md)
- Runtime variance log: [`docs/runtime-variance.md`](./runtime-variance.md)
