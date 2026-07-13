import { describe, expect, it } from 'vitest';
import {
  createNewGame,
  hireGang,
  livingGangsOf,
  nextHireGangId,
} from '../../src/engine';

describe('hire placement', () => {
  it('places hired gang on the chosen owned sector', () => {
    let state = createNewGame({ seed: 42, scenarioId: 'kill_em_all' });
    const human = 'player';
    const home = livingGangsOf(state, human)[0]!.sectorId;
    // Claim-ish: pick any owned sector (home)
    const entry = state.hirePool[0]!;
    const before = Object.keys(state.gangs).length;
    state = hireGang(state, human, entry.defId, home);
    expect(Object.keys(state.gangs).length).toBe(before + 1);
    const hired = Object.values(state.gangs).find(
      (g) => g.ownerId === human && g.defId === entry.defId && g.sectorId === home,
    );
    expect(hired).toBeTruthy();
    expect(state.sectors[home]!.gangIds).toContain(hired!.id);
  });

  it('never reuses an existing gang id after deaths', () => {
    let state = createNewGame({ seed: 7, scenarioId: 'kill_em_all' });
    const human = 'player';
    const home = livingGangsOf(state, human)[0]!.sectorId;
    // Kill one gang to shrink the key count (old bug used length+1)
    const victim = livingGangsOf(state, human)[0]!;
    const remaining = livingGangsOf(state, human).filter((g) => g.id !== victim.id);
    delete state.gangs[victim.id];
    state.sectors[victim.sectorId]!.gangIds = state.sectors[victim.sectorId]!.gangIds.filter(
      (id) => id !== victim.id,
    );
    // Force hire pool to have something
    if (state.hirePool.length === 0) {
      state.hirePool = [{ defId: 'neon_jackals', turnsLeft: 3 }];
    }
    const entry = state.hirePool[0]!;
    // Ensure player can afford
    state.players[human]!.cash = 9999;
    const id = nextHireGangId(state, human);
    expect(state.gangs[id]).toBeUndefined();
    state = hireGang(state, human, entry.defId, home);
    // All remaining starters still exist
    for (const g of remaining) {
      expect(state.gangs[g.id]).toBeTruthy();
      expect(state.gangs[g.id]!.defId).toBe(g.defId);
    }
    const hiredIds = Object.keys(state.gangs).filter(
      (k) => !remaining.some((r) => r.id === k) && k !== victim.id,
    );
    expect(hiredIds.length).toBeGreaterThanOrEqual(1);
  });
});
