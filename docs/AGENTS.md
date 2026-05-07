# AGENTS

Reference document the Jury reads at deliberation time. Terse, structured, machine-targeted. Update when an agent's IO contract changes; do not let it drift from `src/agents/`.

## Roster

Four agents. Each is a single Gemma 4 variant, chosen for capability fit per ADR-001.

### Prosecutor

- **Variant:** `gemma4:e4b-it-q8_0` (4B-class edge, instruction-tuned, q8_0 quant).
- **Role:** Generates adversarial mutations, failing inputs, and cheat-pattern probes against the patch under review.
- **Inputs:** the PR patch, a working set of repo snippets the orchestrator has selected, the agent context (`ctx.rng`, `ctx.clock`, `ctx.modelConfig`).
- **Outputs:** `ProsecutionDossier`: a list of typed exhibits, each with a hypothesis, supporting quote, and severity score.
- **Sees:** the patch, plus its own working set. **Does not see** the rest of the repo, the Defender's draft, or the Jury's deliberation.

### Defender

- **Variant:** `gemma4:26b-a4b-it-q8_0` (26B Mixture-of-Experts, 4B active, instruction-tuned, q8_0 quant).
- **Role:** Generates rebuttals to each exhibit. Argues legitimate-refactor explanations, false-positive flags, and counter-evidence.
- **Inputs:** the PR patch, the `ProsecutionDossier`, the agent context.
- **Outputs:** `DefenseDossier`: per-exhibit rebuttal nodes with severity reduction, citations, and (optional) counter-tests.
- **Sees:** the patch and the Prosecutor's dossier. **Does not see** the rest of the repo or the Jury's deliberation.

### Court Reporter

- **Variant:** `gemma4:e4b-it-q8_0` (4B-class edge, native multimodal). Same model file as the Prosecutor; different role and prompts. Gemma 4 ships native vision per the model card; there is no separate vision-only tag.
- **Role:** Converts attached images, diagrams, and frame-sampled video into structured exhibits via OCR and chart understanding.
- **Inputs:** the multimodal attachments on the PR (PNG/JPEG, sequence diagrams, Mermaid renders, sampled frames).
- **Outputs:** zero or more exhibit nodes with extracted text, intent summary, and a cross-reference field for the Jury to compare against the diff.
- **Sees:** only the multimodal attachments. **Does not see** the patch, the dossiers, or the repo.

### Jury

- **Variant:** `gemma4:31b-it-q8_0` (31B dense, instruction-tuned, q8_0 quant, 128k context).
- **Role:** Deliberates and renders the verdict. Only agent with the full picture.
- **Inputs:** repo HEAD snapshot, the PR patch, both dossiers, all Court Reporter exhibits, AGENTS.md (this file), CONTRIBUTING.md, STYLE_GUIDE.md, and any cited precedents.
- **Outputs:** `JuryOpinion`: majority verdict, dissents, cited evidence graph nodes, numeric confidence score; the evidence graph is the primary machine-readable output, the prose opinion is generated from it.
- **Sees:** everything listed above, simultaneously, in a single 128k context window. The 128k window is doing real work: the repo snapshot is not summarized.

## Determinism contract (binding on all four)

Every agent runs through `src/runtime/llm-client.ts` with explicit temperature, top-p, top-k, and seed. No agent reads `Math.random`, `Date.now`, env vars, or the filesystem outside its returned value. See `docs/DECISIONS.md` ADR-002.

## Output handoff

Agents return values; they do not write files. `src/runtime/bundle-writer.ts` is the only path to disk. Schemas for every output live in `src/evidence/schema.ts`; raw model output is parsed via zod, never `JSON.parse`.
