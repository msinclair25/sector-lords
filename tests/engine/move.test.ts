import { describe, expect, it } from 'vitest';
import {
  createNewGame,
  createOrder,
  livingGangsOf,
  queueOrder,
  resolveTurn,
  sectorId,
} from '../../src/engine';

describe('gang movement', () => {
  it('moves a gang into an adjacent empty sector on end turn', () => {
    let state = createNewGame({ seed: 101 });
    const gang = livingGangsOf(state, 'player')[0]!;
    // Start is 1,1 — move/claim to 1,2
    const dest = sectorId(1, 2);
    expect(state.sectors[dest]!.owner).toBeNull();

    state = queueOrder(
      state,
      createOrder({
        playerId: 'player',
        type: 'move',
        gangId: gang.id,
        targetSectorId: dest,
      }),
    );

    const { state: next } = resolveTurn(state);
    expect(next.gangs[gang.id]!.sectorId).toBe(dest);
    expect(next.sectors[dest]!.gangIds).toContain(gang.id);
    expect(next.sectors[dest]!.owner).toBe('player');
  });

  it('claims adjacent empty sector', () => {
    let state = createNewGame({ seed: 102 });
    const gang = livingGangsOf(state, 'player')[0]!;
    const dest = sectorId(2, 1);
    state = queueOrder(
      state,
      createOrder({
        playerId: 'player',
        type: 'claim',
        gangId: gang.id,
        targetSectorId: dest,
      }),
    );
    const { state: next } = resolveTurn(state);
    expect(next.sectors[dest]!.owner).toBe('player');
    expect(next.gangs[gang.id]!.sectorId).toBe(dest);
  });
});
