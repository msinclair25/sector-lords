import { describe, expect, it } from 'vitest';
import {
  createNewGame,
  createOrder,
  queueOrder,
  resolveTurn,
  serializeState,
  deserializeState,
  livingGangsOf,
  countSectorsOwned,
} from '../../src/engine';
import { fillAllAiOrders } from '../../src/ai/heuristicAi';

describe('turn pipeline', () => {
  it('creates a valid starting state', () => {
    const state = createNewGame({ seed: 1 });
    expect(state.mapWidth).toBe(8);
    expect(state.mapHeight).toBe(8);
    expect(livingGangsOf(state, 'player').length).toBeGreaterThan(0);
    expect(countSectorsOwned(state.sectors, 'player')).toBe(1);
  });

  it('claims an empty adjacent sector', () => {
    let state = createNewGame({ seed: 99 });
    const gang = livingGangsOf(state, 'player')[0]!;
    // Start is 1,1 — claim 1,2
    const target = '1,2';
    state = queueOrder(
      state,
      createOrder({
        playerId: 'player',
        type: 'claim',
        gangId: gang.id,
        targetSectorId: target,
      }),
    );
    const { state: next } = resolveTurn(state);
    expect(next.sectors[target]!.owner).toBe('player');
    expect(next.turn).toBe(2);
  });

  it('serializes and deserializes', () => {
    const state = createNewGame({ seed: 3 });
    const round = deserializeState(serializeState(state));
    expect(round.seed).toBe(state.seed);
    expect(Object.keys(round.sectors).length).toBe(64);
  });

  it('AI can produce orders and resolve without throwing', () => {
    let state = createNewGame({ seed: 5 });
    state = fillAllAiOrders(state);
    // Also give human a defend order so pipeline runs
    const gang = livingGangsOf(state, 'player')[0]!;
    state = queueOrder(
      state,
      createOrder({ playerId: 'player', type: 'defend', gangId: gang.id }),
    );
    const { state: next } = resolveTurn(state);
    expect(next.turn).toBeGreaterThanOrEqual(2);
  });
});
