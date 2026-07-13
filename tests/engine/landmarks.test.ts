import { describe, expect, it } from 'vitest';
import { computeIncome, createNewGame } from '../../src/engine';

describe('landmarks', () => {
  it('places landmarks on the map', () => {
    const state = createNewGame({ seed: 77 });
    const landmarks = Object.values(state.sectors).filter((s) => s.landmark);
    expect(landmarks.length).toBeGreaterThanOrEqual(3);
    expect(landmarks[0]!.landmark!.name.length).toBeGreaterThan(0);
  });

  it('landmark cash applies when owned', () => {
    const state = createNewGame({ seed: 78 });
    const lm = Object.values(state.sectors).find((s) => s.landmark)!;
    const before = computeIncome(state, 'player');
    lm.owner = 'player';
    const after = computeIncome(state, 'player');
    expect(after).toBeGreaterThanOrEqual(before + (lm.landmark?.cashBonus ?? 0));
  });
});
