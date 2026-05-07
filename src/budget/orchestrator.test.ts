import { describe, expect, it } from 'vitest';
import {
  AllocationTraceSchema,
  BUDGET_ARMS,
  parseBudgetSpec,
  runBanditLoop,
  type ArmExecutor,
} from './orchestrator.js';

describe('parseBudgetSpec', () => {
  it('parses minute, hour, and second forms', () => {
    expect(parseBudgetSpec('5m')).toBe(5 * 60 * 1000);
    expect(parseBudgetSpec('50m')).toBe(50 * 60 * 1000);
    expect(parseBudgetSpec('2h')).toBe(2 * 60 * 60 * 1000);
    expect(parseBudgetSpec('30s')).toBe(30 * 1000);
    expect(parseBudgetSpec('30')).toBe(30 * 1000);
  });

  it('parses the literal "overnight" as 8h', () => {
    expect(parseBudgetSpec('overnight')).toBe(8 * 60 * 60 * 1000);
  });

  it('rejects malformed values', () => {
    expect(() => parseBudgetSpec('5x')).toThrow(/cannot parse/);
    expect(() => parseBudgetSpec('-5m')).toThrow();
    expect(() => parseBudgetSpec('')).toThrow();
  });
});

describe('runBanditLoop', () => {
  it('respects the budget within one action of overrun', async () => {
    let stepCount = 0;
    const executor: ArmExecutor = async () => {
      stepCount++;
      return { reward: 0.5, durationMs: 1000 };
    };
    const { trace } = await runBanditLoop({
      budgetMs: 5000,
      executor,
    });
    // Overrun is allowed by exactly one step because the budget check happens
    // at the start of a step. With each step costing 1000ms and a 5000ms
    // budget, the loop runs 5 or 6 steps depending on how the check lands.
    expect(trace.steps.length).toBeGreaterThanOrEqual(5);
    expect(trace.steps.length).toBeLessThanOrEqual(6);
    expect(stepCount).toBe(trace.steps.length);
  });

  it('explores every arm at least once before relying on the mean', async () => {
    const calls: string[] = [];
    const executor: ArmExecutor = async (arm) => {
      calls.push(arm);
      return { reward: arm === 'jury-round' ? 0.9 : 0.1, durationMs: 1 };
    };
    const { trace } = await runBanditLoop({ budgetMs: 100, executor, maxSteps: 50 });
    const firstThree = trace.steps.slice(0, 3).map((s) => s.arm);
    expect(new Set(firstThree).size).toBe(3); // each arm pulled exactly once first
  });

  it('records the per-arm UCB scores at every step', async () => {
    const executor: ArmExecutor = async () => ({ reward: 0.3, durationMs: 100 });
    const { trace } = await runBanditLoop({ budgetMs: 1000, executor });
    for (const step of trace.steps) {
      expect(step.scores.length).toBe(BUDGET_ARMS.length);
    }
  });

  it('produces a trace that round-trips through the zod schema (canonical-JSON safe)', async () => {
    const executor: ArmExecutor = async () => ({ reward: 0.42, durationMs: 50 });
    const { trace } = await runBanditLoop({ budgetMs: 500, executor });
    const reparsed = AllocationTraceSchema.parse(JSON.parse(JSON.stringify(trace)));
    expect(reparsed).toEqual(trace);
  });

  it('terminates at maxSteps when executor reports zero duration (safety bound)', async () => {
    let calls = 0;
    const executor: ArmExecutor = async () => {
      calls++;
      return { reward: 0.5, durationMs: 0 };
    };
    const { trace } = await runBanditLoop({ budgetMs: 60_000, executor, maxSteps: 7 });
    expect(trace.steps.length).toBe(7);
    expect(calls).toBe(7);
  });
});
