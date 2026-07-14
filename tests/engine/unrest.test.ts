import { describe, expect, it } from 'vitest';
import {
  createNewGame,
  createOrder,
  livingGangsOf,
  previewUnrestOrder,
  queueOrder,
  resolveTurn,
  validateOrder,
} from '../../src/engine';

describe('unrest orders', () => {
  it('raises sector unrest, pays cash, and spikes city heat on End Turn', () => {
    let state = createNewGame({ seed: 21 });
    const human = 'player';
    const gang = livingGangsOf(state, human)[0]!;
    const home = state.sectors[gang.sectorId]!;
    expect(home.owner).toBe(human);

    const prev = previewUnrestOrder(state, gang.id);
    expect(prev).not.toBeNull();
    expect(prev!.unrestGain).toBeGreaterThan(0);
    expect(prev!.cash).toBeGreaterThan(0);

    const cashBefore = state.players[human]!.cash;
    const heatBefore = state.cityHeat;
    const unrestBefore = home.unrest;

    state = queueOrder(
      state,
      createOrder({ playerId: human, type: 'unrest', gangId: gang.id }),
    );
    // Queuing alone does not change the sector
    expect(state.sectors[gang.sectorId]!.unrest).toBe(unrestBefore);

    const { state: next } = resolveTurn(state);
    const after = next.sectors[gang.sectorId]!;
    expect(after.unrest).toBe(unrestBefore + prev!.unrestGain);
    expect(next.players[human]!.cash).toBeGreaterThan(cashBefore);
    expect(next.cityHeat).toBeGreaterThan(heatBefore);

    const log = next.log.map((l) => l.message).join('\n');
    expect(log).toMatch(/raises unrest/i);
    expect(log).toMatch(/\$/);
  });

  it('rejects unrest when crew is not on owned turf', () => {
    let state = createNewGame({ seed: 22 });
    const human = 'player';
    const gang = livingGangsOf(state, human)[0]!;
    // Park on a neutral empty tile if we can find one adjacent-ish; force owner null
    const foreign = Object.values(state.sectors).find(
      (s) => s.owner && s.owner !== human,
    );
    if (foreign) {
      // Move gang reference onto enemy tile without ownership
      const old = state.sectors[gang.sectorId]!;
      old.gangIds = old.gangIds.filter((id) => id !== gang.id);
      gang.sectorId = foreign.id;
      foreign.gangIds = [...foreign.gangIds, gang.id];
    } else {
      // Fallback: strip home ownership
      const home = state.sectors[gang.sectorId]!;
      home.owner = null;
    }

    const err = validateOrder(
      state,
      createOrder({ playerId: human, type: 'unrest', gangId: gang.id }),
    );
    expect(err).toMatch(/own/i);
  });

  it('rejects unrest at max sector unrest', () => {
    const state = createNewGame({ seed: 23 });
    const human = 'player';
    const gang = livingGangsOf(state, human)[0]!;
    state.sectors[gang.sectorId]!.unrest = 10;
    const err = validateOrder(
      state,
      createOrder({ playerId: human, type: 'unrest', gangId: gang.id }),
    );
    expect(err).toMatch(/max/i);
  });
});
