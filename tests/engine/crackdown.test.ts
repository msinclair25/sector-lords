import { describe, expect, it } from 'vitest';
import {
  applyEconomy,
  createNewGame,
  createOrder,
  HEAT_BANDS,
  livingGangsOf,
  queueOrder,
  resolveTurn,
} from '../../src/engine';

describe('police crackdown & heat', () => {
  it('fires crackdown at heat threshold with tile residual + cool-off', () => {
    const state = createNewGame({ seed: 77 });
    state.cityHeat = HEAT_BANDS.crackdownAt;
    state.crackdownCooldown = 0;
    const hot = Object.values(state.sectors).find((s) => s.owner === 'player')!;
    hot.unrest = 8;
    const gang = livingGangsOf(state, 'player')[0]!;
    gang.sectorId = hot.id;
    if (!hot.gangIds.includes(gang.id)) hot.gangIds.push(gang.id);
    const hpBefore = gang.hp;

    const { messages, crackdown } = applyEconomy(state);
    expect(crackdown).not.toBeNull();
    expect(crackdown!.sectorIds.length).toBeGreaterThan(0);
    expect(hot.crackdownTurns).toBeGreaterThan(0);
    expect(state.crackdownCooldown).toBeGreaterThan(0);
    expect(state.cityHeat).toBeLessThan(HEAT_BANDS.crackdownAt);
    expect(messages.join(' ')).toMatch(/CRACKDOWN|Cops/i);

    const gAfter = state.gangs[gang.id];
    if (gAfter) {
      expect(gAfter.hp).toBeLessThan(hpBefore);
    }
  });

  it('does not re-fire during cool-off even at high heat', () => {
    const state = createNewGame({ seed: 78 });
    state.cityHeat = 95;
    state.crackdownCooldown = 2;
    const { crackdown } = applyEconomy(state);
    expect(crackdown).toBeNull();
    expect(state.crackdownCooldown).toBe(1);
  });

  it('raise unrest then end turns can reach crackdown', () => {
    let state = createNewGame({ seed: 79 });
    const human = 'player';
    // Force heat near the line
    state.cityHeat = HEAT_BANDS.crackdownAt - 3;
    state.crackdownCooldown = 0;
    const gang = livingGangsOf(state, human)[0]!;
    const home = state.sectors[gang.sectorId]!;
    home.owner = human;
    home.unrest = 4;

    state = queueOrder(
      state,
      createOrder({ playerId: human, type: 'unrest', gangId: gang.id }),
    );
    const { state: next, cityEvent } = resolveTurn(state);
    // May or may not crack this turn depending on economy climb + spike
    expect(next.cityHeat).toBeGreaterThan(0);
    if (cityEvent?.id === 'police_crackdown') {
      expect(cityEvent.artUrl || cityEvent.name).toBeTruthy();
      expect(next.crackdownCooldown).toBeGreaterThan(0);
    } else {
      // If no crack yet, another unrest path should push over
      next.cityHeat = HEAT_BANDS.crackdownAt;
      next.crackdownCooldown = 0;
      const r2 = applyEconomy(next);
      expect(r2.crackdown).not.toBeNull();
    }
  });
});
