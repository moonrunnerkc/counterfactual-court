# Demo Script

Six beats. Total target 90 seconds. Each beat below has the exact CLI command, expected terminal output, target seconds, caption text, and an ASCII frame Brad can size the recording window against. Captions are overlay text added in post; the terminal output is what the camera sees.

The terminal session for beats 1 to 6 should be one continuous shell with the showcase fixture already prepared (`bin/run-showcase.sh` was run once before recording). Beats 5 and 6 run from the same shell with Wi-Fi off.

Total target: 14 + 14 + 14 + 16 + 16 + 16 = 90 seconds.

---

## Beat 1: PR opens, court invoked

Target: 14 seconds.

Caption: "Local agents. Real Gemma 4. No data leaves the laptop."

Command:

```
pnpm gemmacourt run \
  --fixture showcase-vite-rsc \
  --evidence-graph --precedent --impact \
  --budget 50m
```

Expected terminal output (first frames; the run continues into beat 2):

<!-- placeholder: the streaming lines below are taken from a Phase 2F dry run; -->
<!-- the showcase run will produce the same shape with showcase-vite-rsc paths.   -->

```
[run] fixture=showcase-vite-rsc seed=run-showcase-vite-rsc
[run] features evidenceGraph=on precedent=on monorepoImpact=on
[run] budget 50m (3000000 ms) bandit=real
[run] linear pipeline: prosecutor -> defender -> court-reporter -> jury
```

ASCII frame:

```
+----------------------------------------------------------------+
| $ pnpm gemmacourt run --fixture showcase-vite-rsc \           |
|     --evidence-graph --precedent --impact --budget 50m         |
| [run] fixture=showcase-vite-rsc seed=run-showcase-vite-rsc     |
| [run] features evidenceGraph=on precedent=on monorepoImpact=on |
| [run] budget 50m (3000000 ms) bandit=real                      |
| [run] linear pipeline: prosecutor -> defender -> court-...     |
+----------------------------------------------------------------+
```

---

## Beat 2: Prosecutor exhibits stream live

Target: 14 seconds.

Caption: "Prosecutor: Gemma 4 e4b. Builds the case."

Command: none (continuation of Beat 1's process).

Expected terminal output:

```
[prosecutor] exhibit-1: server-css bundling drops style sheets when cssCodeSplit=false
[prosecutor] exhibit-2: cssCodeSplit=true regression: server links may double-emit
[prosecutor] exhibit-3: e2e covers cssCodeSplit=false only; cssCodeSplit=true uncovered
[prosecutor] dossier: 3 exhibits, mean severity 0.62
```

<!-- placeholder: the four lines above are illustrative. The recorded output  -->
<!-- replaces them once Brad runs bin/run-showcase.sh against vitejs/vite-plugin-react#1192. -->

ASCII frame:

```
+----------------------------------------------------------------+
| [prosecutor] exhibit-1: server-css bundling drops style sheets |
|              when cssCodeSplit=false                           |
| [prosecutor] exhibit-2: cssCodeSplit=true regression: server   |
|              links may double-emit                             |
| [prosecutor] exhibit-3: e2e covers cssCodeSplit=false only;    |
|              cssCodeSplit=true uncovered                       |
| [prosecutor] dossier: 3 exhibits, mean severity 0.62           |
+----------------------------------------------------------------+
```

---

## Beat 3: Defender rebuttals stream live

Target: 14 seconds.

Caption: "Defender: same e4b file, different prompt and seed."

Command: none.

Expected terminal output:

```
[defender] rebut exhibit-1: bundling change is gated on cssCodeSplit=false; safe by construction
[defender] rebut exhibit-2: existing helper deduplicates server links; no double-emit observed
[defender] rebut exhibit-3: covered by sibling test in e2e/css-code-split-true.test.ts
[defender] dossier: 3 rebuttals, mean severity reduction 0.34
```

<!-- placeholder: same caveat as beat 2 -->

ASCII frame:

```
+----------------------------------------------------------------+
| [defender] rebut exhibit-1: bundling change is gated on        |
|            cssCodeSplit=false; safe by construction            |
| [defender] rebut exhibit-2: existing helper deduplicates       |
|            server links; no double-emit observed               |
| [defender] rebut exhibit-3: covered by sibling test in         |
|            e2e/css-code-split-true.test.ts                     |
| [defender] dossier: 3 rebuttals, mean reduction 0.34           |
+----------------------------------------------------------------+
```

---

## Beat 4: Jury renders opinion with dissent

Target: 16 seconds.

Caption: "Jury: 31B, 128k. Reads the whole repo at HEAD."

Command: none.

Expected terminal output:

```
[jury] reading repo HEAD + patch + dossiers + style docs (~118k tokens)
[jury] verdict: approve-with-conditions, confidence 0.78
[jury]   condition: add e2e for cssCodeSplit=true to close exhibit-3
[jury]   dissent: 1 juror flags exhibit-2 (cssCodeSplit=true regression risk)
[jury] graph: 11 nodes, 14 edges, 2 monorepo citations, 1 precedent placeholder
wrote bundle 7c0d94991db8fdce837101334ed0f7438e7cc67064df135a62a610dca6a129fb
```

<!-- placeholder bundle id reused from Phase 1 first verdict; the showcase run -->
<!-- writes its own id which Brad pastes into release notes after recording.   -->

ASCII frame:

```
+----------------------------------------------------------------+
| [jury] verdict: approve-with-conditions, confidence 0.78       |
|   condition: add e2e for cssCodeSplit=true to close exhibit-3  |
|   dissent: 1 juror flags exhibit-2 (cssCodeSplit=true risk)    |
| [jury] graph: 11 nodes, 14 edges, 2 monorepo citations         |
| wrote bundle 7c0d9499...                                       |
+----------------------------------------------------------------+
```

---

## Beat 5: Wi-Fi off, replay reproduces bit-identical

Target: 16 seconds.

Caption: "Wi-Fi off. The bundle replays bit-identical."

Command:

```
bin/demo-replay.sh ./bundles/showcase/<id>.verdict
```

Expected terminal output:

```
[demo-replay] guard: confirming network is offline
[demo-replay] guard: curl --max-time 2 https://example.com failed as required
[demo-replay] running gemmacourt replay against ./bundles/showcase/7c0d9499...verdict
replay: bit-identical
prosecutor: match (recorded=8a3f... replay=8a3f...)
defender: match (recorded=ec02... replay=ec02...)
court-reporter: match (recorded=null replay=null)
jury: match (recorded=4d11... replay=4d11...)
```

<!-- placeholder hashes; real values land when Brad runs the showcase -->

ASCII frame:

```
+----------------------------------------------------------------+
| $ bin/demo-replay.sh ./bundles/showcase/7c0d9499...verdict     |
| [demo-replay] guard: confirming network is offline             |
| [demo-replay] running gemmacourt replay ...                    |
| replay: bit-identical                                          |
| prosecutor: match  defender: match  jury: match                |
+----------------------------------------------------------------+
```

---

## Beat 6: Second similar PR, jury cites precedent from first

Target: 16 seconds.

Caption: "Same neighborhood of the codebase. The Jury cites the first verdict."

Command:

```
pnpm gemmacourt run \
  --fixture showcase-vite-rsc-followup \
  --evidence-graph --precedent --impact \
  --budget 50m
```

Expected terminal output (only the precedent-relevant lines; the rest looks like beats 1 to 4):

```
[ledger] querying ~/.gemmacourt/ledger for prior verdicts (threshold 0.85)
[ledger] hit: bundle 7c0d9499... similarity 0.93 (showcase-vite-rsc)
[jury] citing precedent 7c0d9499... in evidence graph (node precedent-1)
[jury] verdict: approve, confidence 0.84
[jury]   precedent-1 cited by exhibit "css-code-split bundling change" (supports)
wrote bundle <new-id>.verdict
```

<!-- placeholder: the follow-up fixture is Brad's choice on demo day. -->
<!-- A small change to packages/plugin-rsc/src/plugin.ts (e.g., a tweak to     -->
<!-- the new helper introduced by #1192) makes the similarity score crisp.    -->

ASCII frame:

```
+----------------------------------------------------------------+
| [ledger] hit: bundle 7c0d9499... similarity 0.93               |
| [jury] citing precedent 7c0d9499... in evidence graph          |
| [jury] verdict: approve, confidence 0.84                       |
|   precedent-1 cited by exhibit                                 |
|     "css-code-split bundling change" (supports)                |
| wrote bundle <new-id>.verdict                                  |
+----------------------------------------------------------------+
```

---

## Final frame (overlay only, no command)

Caption: bundle hash + GitHub link, on screen for 2 seconds inside the last beat (no separate clip).

```
bundle  7c0d9499...
github  github.com/bradkinnard/counterfactual-court
```

---

## Notes for Brad

1. Beat 6 needs a follow-up fixture. Easiest path: copy `fixtures/showcase-vite-rsc/` to `fixtures/showcase-vite-rsc-followup/`, edit one helper inside `repo-snippet.ts`, regenerate `patch.diff` so it touches the same surface lightly. Run the first showcase fully so the ledger has the precedent before recording beat 6.
2. Placeholders inside the expected-output blocks are marked with `<!-- placeholder -->`. After the real run, paste the actual lines over each placeholder block before posting the demo doc anywhere.
3. The total target is 90 seconds; aim for crisp typing in beats 1, 5, and 6 (commands carry information), and slow scroll through beats 2 to 4 (LLM streams carry information).
