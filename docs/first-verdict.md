# First Verdict

The first end-to-end run of Counterfactual Court against a real, public OSS TypeScript pull request.

## Target PR

- **Repository:** [`colinhacks/zod`](https://github.com/colinhacks/zod)
- **PR:** [#5945: `fix(v4): cidrv6 JSON schema pattern matches runtime`](https://github.com/colinhacks/zod/pull/5945)
- **Base SHA:** `1fb56a5c18c27102dbc92260a4007c7732a0ccca`
- **Head SHA:** `45710f029e668b9daa8dd192f1a198c7428f0e5b`
- **Merge commit:** `f29f2a6db443284eff44db181dbe146df98f92c2`
- **Size:** +9 / -1 across 2 files. Production change is single-file: `packages/zod/src/v4/core/regexes.ts` (1 line replaced); the rest is new test coverage.
- **Real-world outcome:** merged.

The fixture lives at `fixtures/zod-5945-cidrv6/`. `repo-snippet.ts` is the verbatim contents of `regexes.ts` at the base SHA; `patch.diff` is the unified diff fetched via `gh api`. No multimodal attachments.

## Run

```sh
GEMMACOURT_SEED=zod-5945 \
GEMMACOURT_RUN_TIMESTAMP=2026-05-07T15:30:00Z \
pnpm gemmacourt run --fixture zod-5945-cidrv6
```

- **Bundle id (content hash):** `7c0d94991db8fdce837101334ed0f7438e7cc67064df135a62a610dca6a129fb`
- **Bundle SHA-256 on disk:** `2c9a4f7f982f60a190ed23521397bd3a317e7c8afe8381eadd70d9debed6cef1`
- **Bundle file size:** 92,366 bytes (`bundles/<id>.verdict`, gitignored)
- **Run timestamp (frozen clock):** `2026-05-07T15:30:00Z`
- **Wall start:** `2026-05-07T21:24:24Z`
- **Wall end:** `2026-05-07T21:29:23Z` (≈5 min, dominated by the 31B Jury call)

### LLM call summary

| Agent          | Model                     | Seed         | Prompt tokens | Completion tokens |
| -------------- | ------------------------- | ------------ | ------------: | ----------------: |
| Prosecutor     | `gemma4:e4b-it-q8_0`      | `1191238005` |         6,084 |             2,561 |
| Defender       | `gemma4:26b-a4b-it-q8_0`  | `1923793293` |         2,561 |             1,449 |
| Court Reporter | (skipped, no attachments) | (n/a)        |         (n/a) |             (n/a) |
| Jury           | `gemma4:31b-it-q8_0`      | `990525511`  |         9,904 |             1,623 |

Every model digest is the one pinned in `runtime.lock.json` (Ollama 0.23.1, Node 24.15.0).

## Jury opinion

- **Verdict:** `approve`
- **Confidence:** 0.9
- **Dissents:** 0
- **Citations:** `p1`, `p2`

> The patch corrects a significant deficiency in the CIDR v6 validation regex, which previously failed to account for many valid IPv6 address permutations defined in RFC 4291. By explicitly enumerating the valid structural patterns for compressed and uncompressed addresses, the new regex ensures higher precision and correctness.
>
> The concerns regarding performance and logic errors are mitigated by the structure of the regex; it utilizes non-nested alternations, which prevents catastrophic backtracking and ensures linear time complexity relative to the input length. The added test cases in `string.test.ts` verify that a wider range of valid IPv6 CIDR notations are now correctly identified.

The verdict matches the real-world outcome (the PR was merged into upstream zod), and the rationale demonstrates that the 128k-context Jury actually reasoned about the diff rather than rubber-stamping it (it picked up on the catastrophic-backtracking concern and explained why the structure of the new pattern avoids it).

### Prosecution exhibits

- `p1` (logic-error, conf 0.9): "The significantly expanded and complex regular expression for CIDR v6 introduces a high risk of subtle logic errors or unintended over-matching."
- `p2` (other, conf 0.75): "The extreme complexity of the new CIDR v6 regex will likely lead to performance degradation when used repeatedly for validation."

### Defense rebuttals

- `p1` (refutes=true, conf 0.85): the new regex mitigates errors in the prior implementation rather than introducing them; explicit alternation models the RFC 4291 grammar correctly.
- `p2` (refutes=true, conf 0.8): non-nested alternations let the engine fail fast on invalid inputs and avoid catastrophic backtracking; runtime is linear in input length.

## Replay (bit-identity)

```sh
GEMMACOURT_SEED=zod-5945 \
GEMMACOURT_RUN_TIMESTAMP=2026-05-07T15:30:00Z \
pnpm gemmacourt replay ./bundles/7c0d94991db8fdce837101334ed0f7438e7cc67064df135a62a610dca6a129fb.verdict
```

```
replay: bit-identical
prosecutor: match (recorded=8239a56b... replay=8239a56b...)
defender:   match (recorded=90d63318... replay=90d63318...)
courtReporter: match (recorded=<no-call> replay=<no-call>)
jury:       match (recorded=5b2addc5... replay=5b2addc5...)
```

Every response hash matched byte-for-byte. **No quantization variance observed** on this hardware (Apple Silicon, Ollama 0.23.1, the digests in `runtime.lock.json`). The bundle is gitignored, but its content-addressed id is captured in this document and pinned in commit history.

## Signature verification (no LLM calls)

```sh
pnpm gemmacourt verify ./bundles/7c0d94991db8fdce837101334ed0f7438e7cc67064df135a62a610dca6a129fb.verdict
# signature OK for bundle 7c0d94991db8fdce837101334ed0f7438e7cc67064df135a62a610dca6a129fb
```

Ed25519 signature derived deterministically from `sha256(baseSeed + ":bundle-signing")`. Replay regenerates the same keypair, so the bundle's bytes are stable across replays as long as the body is.

## Things that surprised me

- **Bit-identity held on the first try.** With three real Gemma 4 variants on Apple Silicon at Q8_0, with `temperature=0` plus a fixed seed, all three response hashes matched exactly across two runs separated by minutes. We may still hit residual variance across hardware classes (different GPU, different driver), but on this single platform replay was a clean bit-equality, not a tolerance match.
- **Ollama's `format: "json"` constraint produced degenerate output on the 26B-MoE model at `temperature=0`.** Removing the constraint and relying on the system prompt plus `parseJsonResponse` (which strips Markdown code fences) produced clean JSON from all three models. The change is local to the four agent files and is documented in code comments only by virtue of its absence.
- **Initial run failed because the Prosecutor returned 4 exhibits and 2 of them omitted `confidence`.** Schema validation caught it (a typed error, not a crash), and a one-line tightening of the system prompt ("EVERY exhibit object MUST include all five fields") fixed it. This is exactly the failure mode the zod boundary is meant to catch and it caught it.
- **The Jury actually engaged with the technical argument.** Its rationale references RFC 4291 and catastrophic backtracking by name, not as boilerplate but as an explicit response to `p2`. This is what motivated the 31B / 128k context choice, and it paid off on the very first run.

## Cuts applied

None. The Court Reporter ran (it short-circuited because there are no attachments), the Defender ran, and the target was a real merged OSS PR rather than a hand-crafted fixture.

## Reproduce

```sh
# Pull the pinned models (digests in runtime.lock.json):
pnpm install
ollama pull gemma4:e4b-it-q8_0
ollama pull gemma4:26b-a4b-it-q8_0
ollama pull gemma4:31b-it-q8_0

pnpm build
GEMMACOURT_SEED=zod-5945 \
GEMMACOURT_RUN_TIMESTAMP=2026-05-07T15:30:00Z \
pnpm gemmacourt run --fixture zod-5945-cidrv6
```
