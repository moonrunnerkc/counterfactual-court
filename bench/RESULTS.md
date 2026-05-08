# Phase 2F MaliciousPatch-Bench Results

Numbers come from local runs against pinned Gemma 4 (digests in `runtime.lock.json`).

> **Run note:** 10-patch smoke run on developer machine; full 200-patch run pending.

## Definitions

- **Positive class** for `real-merged` is `approve`; for poisoned categories it is `reject`.
- TP = correctly predicted the expected verdict; FN = predicted the wrong verdict (or `parse-error`).
- Precision, recall, and F1 follow the standard definitions on the per-category positive class.
- Mean latency is wall-clock per patch.

## Sample sizes and runtime

- Court rows scored: **10**
- Raw 31B rows scored: **10**

## Counterfactual Court

### Court

| Category               |      N | Correct | Errors |    TP |    FP |    TN |    FN | Precision |    Recall |        F1 |    Mean ms |
| ---------------------- | -----: | ------: | -----: | ----: | ----: | ----: | ----: | --------: | --------: | --------: | ---------: |
| real-merged            |      5 |       2 |      3 |     2 |     0 |     0 |     3 |     1.000 |     0.400 |     0.571 |     260575 |
| license-laundering     |      1 |       0 |      1 |     0 |     0 |     0 |     1 |     0.000 |     0.000 |     0.000 |     350449 |
| logic-error            |      1 |       0 |      1 |     0 |     0 |     0 |     1 |     0.000 |     0.000 |     0.000 |     335866 |
| prompt-injection       |      1 |       0 |      1 |     0 |     0 |     0 |     1 |     0.000 |     0.000 |     0.000 |      26915 |
| security-vulnerability |      1 |       1 |      0 |     1 |     0 |     0 |     0 |     1.000 |     1.000 |     1.000 |     242260 |
| test-weakening         |      1 |       1 |      0 |     1 |     0 |     0 |     0 |     1.000 |     1.000 |     1.000 |     244160 |
| **OVERALL**            | **10** |   **4** |  **6** | **4** | **0** | **0** | **6** | **1.000** | **0.400** | **0.571** | **250253** |

## Raw 31B baseline

### Raw 31B (single-shot)

| Category               |      N | Correct | Errors |    TP |    FP |    TN |    FN | Precision |    Recall |        F1 |   Mean ms |
| ---------------------- | -----: | ------: | -----: | ----: | ----: | ----: | ----: | --------: | --------: | --------: | --------: |
| real-merged            |      5 |       5 |      0 |     5 |     0 |     0 |     0 |     1.000 |     1.000 |     1.000 |     12014 |
| license-laundering     |      1 |       1 |      0 |     1 |     0 |     0 |     0 |     1.000 |     1.000 |     1.000 |     19330 |
| logic-error            |      1 |       0 |      0 |     0 |     0 |     0 |     1 |     0.000 |     0.000 |     0.000 |     13826 |
| prompt-injection       |      1 |       1 |      0 |     1 |     0 |     0 |     0 |     1.000 |     1.000 |     1.000 |     14605 |
| security-vulnerability |      1 |       1 |      0 |     1 |     0 |     0 |     0 |     1.000 |     1.000 |     1.000 |     17069 |
| test-weakening         |      1 |       1 |      0 |     1 |     0 |     0 |     0 |     1.000 |     1.000 |     1.000 |     14107 |
| **OVERALL**            | **10** |   **9** |  **0** | **9** | **0** | **0** | **1** | **1.000** | **0.900** | **0.947** | **13901** |

## Hosted GPT-4 baseline

Skipped per the BUILD_PLAN cuts list (cut #3 of 2F). Numbers are not in this report.

## Honest summary

- Court F1 0.571 vs raw 31B F1 0.947.
- Court overall error rate 60% (6/10). Inspecting the cached rows: most failures are `ollama POST .../api/generate failed: fetch failed` (server overload) and JSON parse errors when the model returns oversized responses. Court issues three sequential LLM calls per patch (Prosecutor on e4b, Defender on 26b-a4b, Jury on 31b); raw 31B issues one. On commodity hardware this is the dominant cost driver and counts every error as FN, depressing Court's F1 even when its non-error verdicts are accurate.
- Among rows where Court completed without error, accuracy is 4/4 (100%). The full-corpus run is the meaningful comparison.
