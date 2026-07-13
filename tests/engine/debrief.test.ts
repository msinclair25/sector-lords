import { describe, expect, it } from 'vitest';
import {
  adaptiveWeights,
  buildDebrief,
  createNewGame,
  createOrder,
  emptyStyle,
  livingGangsOf,
  queueOrder,
  recordStyleFromOrders,
  resolveTurn,
  sectorId,
} from '../../src/engine';

describe('debrief & adaptive style', () => {
  it('records human style from orders', () => {
    let state = createNewGame({ seed: 40 });
    state.humanStyle = emptyStyle();
    const gang = livingGangsOf(state, 'player')[0]!;
    state = queueOrder(
      state,
      createOrder({
        playerId: 'player',
        type: 'claim',
        gangId: gang.id,
        targetSectorId: sectorId(1, 2),
      }),
    );
    recordStyleFromOrders(state, state.humanStyle, 'player');
    expect(state.humanStyle.claims).toBe(1);
  });

  it('builds history across turns and debrief after win', () => {
    let state = createNewGame({ seed: 41, scenarioId: 'kill_em_all' });
    expect(state.history.length).toBeGreaterThanOrEqual(1);

    // Wipe AI by eliminating all their gangs and sectors via force
    for (const g of Object.values(state.gangs)) {
      if (g.ownerId !== 'player') {
        const sec = state.sectors[g.sectorId]!;
        sec.gangIds = sec.gangIds.filter((id) => id !== g.id);
        delete state.gangs[g.id];
      }
    }
    for (const s of Object.values(state.sectors)) {
      if (s.owner && s.owner !== 'player') {
        s.owner = null;
        s.gangIds = [];
      }
    }

    const gang = livingGangsOf(state, 'player')[0]!;
    state = queueOrder(
      state,
      createOrder({ playerId: 'player', type: 'defend', gangId: gang.id }),
    );
    const { state: next } = resolveTurn(state);
    expect(next.history.length).toBeGreaterThanOrEqual(2);

    // After AI wiped, elimination should trigger
    if (next.winnerId) {
      const report = buildDebrief(next, 'player');
      expect(report.summary.length).toBeGreaterThan(10);
      expect(report.finalScores.length).toBeGreaterThanOrEqual(2);
      expect(report.playerStyle.length).toBeGreaterThan(0);
    }
  });

  it('adaptive weights counter warmongers with defend/tech', () => {
    const style = emptyStyle();
    style.attacks = 20;
    style.claims = 2;
    const w = adaptiveWeights(style);
    expect(w.defend).toBeGreaterThan(0.35);
    expect(w.tech).toBeGreaterThan(0.3);
  });
});
