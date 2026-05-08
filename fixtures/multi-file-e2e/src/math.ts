/**
 * Tiny math primitives the rest of the fixture monorepo depends on. The
 * Phase 2 final-acceptance e2e patches this file so every Phase 2 feature
 * fires: graph (logic-error exhibits), precedent (matches the ledger seed),
 * ripple (propagates to calculator + index + cli + report), bandit
 * (additional rollouts under --budget).
 */
export const add = (a: number, b: number): number => a + b;
export const sub = (a: number, b: number): number => a - b;
