import { describe, expect, it } from 'vitest';
import {
  banditStateFromHistory,
  emptyBanditState,
  pickArm,
  recordReward,
  ucbScore,
} from './ucb-bandit.js';

describe('emptyBanditState', () => {
  it('rejects an empty arm list', () => {
    expect(() => emptyBanditState([])).toThrow(/at least one arm/);
  });

  it('rejects duplicate arm names', () => {
    expect(() => emptyBanditState(['a', 'b', 'a'])).toThrow(/duplicate arm/);
  });

  it('rejects empty arm names', () => {
    expect(() => emptyBanditState(['a', ''])).toThrow(/non-empty/);
  });

  it('initializes pull and reward counters to zero', () => {
    const s = emptyBanditState(['a', 'b']);
    expect(s.totalPulls).toBe(0);
    expect(s.arms.every((a) => a.pulls === 0 && a.totalReward === 0)).toBe(true);
  });
});

describe('UCB1 textbook example', () => {
  // Reference: standard textbook UCB1 walkthrough. With c=2, three arms, after
  // the first round of pulls (one per arm) yielding rewards 1, 0.5, 0, the
  // mean estimates are 1, 0.5, 0 and the exploration term is the same for
  // every arm because each has been pulled once and N=3. So arm 0 has the
  // highest UCB and wins the next pick.
  it('selects the highest-mean arm when exploration ties cancel', () => {
    const state = banditStateFromHistory(
      [
        { name: 'a', pulls: 1, totalReward: 1 },
        { name: 'b', pulls: 1, totalReward: 0.5 },
        { name: 'c', pulls: 1, totalReward: 0 },
      ],
      2,
    );
    const { armIndex, scores } = pickArm(state);
    expect(armIndex).toBe(0);
    // mean + sqrt(2*ln(N)/n_i) for arm 0 = 1 + sqrt(2*ln(3)/1)
    const expected = 1 + Math.sqrt((2 * Math.log(3)) / 1);
    expect(scores[0]).toBeCloseTo(expected, 9);
  });

  it('explores any unpulled arm before relying on the mean (UCB returns +Infinity for n=0)', () => {
    const state = emptyBanditState(['a', 'b', 'c']);
    expect(ucbScore(state, 0)).toBe(Number.POSITIVE_INFINITY);
    const { armIndex } = pickArm(state);
    expect(armIndex).toBe(0); // ties broken by lowest index when multiple arms are at +Inf
  });

  it('after exploring arm 0 once, picks arm 1 next', () => {
    let state = emptyBanditState(['a', 'b', 'c']);
    state = recordReward(state, 0, 0.7);
    expect(pickArm(state).armIndex).toBe(1);
  });

  it('after exploring all three arms once, picks the arm with the highest mean (no ties in exploration)', () => {
    let state = emptyBanditState(['a', 'b', 'c']);
    state = recordReward(state, 0, 0.2);
    state = recordReward(state, 1, 0.9);
    state = recordReward(state, 2, 0.5);
    expect(pickArm(state).armIndex).toBe(1);
  });
});

describe('recordReward', () => {
  it('returns a new state and never mutates the input', () => {
    const before = emptyBanditState(['a', 'b']);
    const beforeSnap = JSON.stringify(before);
    const after = recordReward(before, 0, 0.5);
    expect(after).not.toBe(before);
    expect(JSON.stringify(before)).toBe(beforeSnap);
    expect(after.arms[0]!.pulls).toBe(1);
    expect(after.arms[0]!.totalReward).toBeCloseTo(0.5, 12);
    expect(after.totalPulls).toBe(1);
  });

  it('rejects out-of-range arm indexes', () => {
    const state = emptyBanditState(['a', 'b']);
    expect(() => recordReward(state, 5, 0.5)).toThrow(/out of range/);
  });
});
