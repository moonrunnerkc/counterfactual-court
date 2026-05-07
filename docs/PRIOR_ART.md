# Prior Art

This document credits prior systems in the same neighborhood and enumerates the explicit deltas Counterfactual Court contributes. Citing prior work is not a weakness; it is how the design rationale earns trust.

The four contributions Counterfactual Court claims as novel: (1) signed, bit-identical replayable verdict bundles; (2) cross-repository precedent ledger with citable evidence chains; (3) structured, machine-queryable evidence graph as primary output; (4) dynamic adversarial compute budget allocated by a UCB bandit. (5, supporting) full-monorepo impact tracing inside a 128k context window. (6, supporting) capability-matched assignment of every Gemma 4 variant to a job designed for its strengths.

## Swarm Orchestrator

https://github.com/moonrunnerkc/swarm-orchestrator

A multi-agent orchestrator that runs an "adversarial battery" of LLM critics over a target. The primary inspiration for the multi-agent shape and the adversarial framing.

**What it does:** Fixed-cardinality battery of critics with a final reconciler. Useful as a one-shot review tool.

**Counterfactual Court delta:** The battery is replaced by a court with role specialization, a dynamic UCB-allocated budget rather than a fixed pipeline, replayable signed bundles instead of plain logs, a cross-repo precedent ledger, and a structured evidence graph as the primary output.

## CodeAgora

A debate-style code review pipeline organized as a roundtable of generic LLM agents.

**What it does:** Multiple agents take turns critiquing and defending a patch; a moderator summarizes.

**Counterfactual Court delta:** Roles are matched to specific Gemma 4 variants by capability rather than identical generic agents; the Jury reads the entire repository at HEAD inside a 128k window rather than summarizing; outputs are signed and replayable; precedent is reused across PRs.

## diffray

A diff-aware reviewer that focuses on producing concise, targeted feedback per hunk.

**What it does:** Per-hunk inline review using a single model with structured prompts.

**Counterfactual Court delta:** Multi-agent adversarial structure rather than single-shot; 128k Jury reasons about cross-file ripple effects rather than per-hunk; output is a structured evidence graph with cited prior verdicts rather than inline comments; bundles replay offline.

## Generic LangGraph debate pipelines

Reference implementations using LangGraph nodes to wire prosecution, defense, and judge roles around hosted models.

**What they do:** Prove the pattern. Useful didactically.

**Counterfactual Court delta:** Local-first; no hosted SDKs; specific Gemma 4 variant per role; replayable bundles; precedent ledger; UCB bandit budget rather than fixed pipeline; benchmark-backed claims via MaliciousPatch-Bench.

## CodeRabbit

https://coderabbit.ai

Hosted AI reviewer. The December 2025 _State of AI vs Human Code Generation Report_ (https://coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report) provided the failure-pattern taxonomy that seeds MaliciousPatch-Bench.

**What it does:** High-quality inline reviews via hosted models.

**Counterfactual Court delta:** Local-first and offline-capable; no data leaves the developer's machine; replayable bundles let auditors reproduce a review on Wi-Fi off; cross-PR precedent across repositories; structured evidence graph for downstream agent use.

## GreptileAI

https://greptile.com

Hosted AI reviewer with a strong codebase-context story.

**What it does:** Indexes the whole repo and provides PR comments grounded in that context.

**Counterfactual Court delta:** Local-first; the 128k Jury holds repo HEAD inline rather than retrieving slices; no hosted indexer; signed replayable bundles; no data leaves the user's machine.

---

## How the deltas combine

Any single delta is matchable by a sufficiently determined competitor. The combination is not, in the contest window:

- Replay + signed bundles → an auditable artifact, not a chat log.
- Replay + precedent ledger → reused, citable judicial memory across PRs and repos.
- Evidence graph + monorepo tracing → machine-queryable cross-file reasoning.
- Capability-matched variants + UCB budget → every Gemma 4 model used for the job it is best at, with compute allocated to where it pays off.

The deltas are not independent claims; they reinforce each other.
