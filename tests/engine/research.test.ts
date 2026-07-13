import { describe, expect, it } from 'vitest';
import { ITEM_DEFS } from '../../src/content';
import {
  applyResearchOrder,
  createNewGame,
  createOrder,
  equipItem,
  fabricateItem,
  livingGangsOf,
  queueOrder,
  resolveTurn,
} from '../../src/engine';

describe('research & equipment', () => {
  it('completes research after enough points', () => {
    const state = createNewGame({ seed: 11 });
    const gang = livingGangsOf(state, 'player')[0]!;
    gang.defId = 'chrome_choir';
    const item = ITEM_DEFS.find((i) => i.techLevel <= 5)!;
    let msgs: string[] = [];
    for (let i = 0; i < 30; i++) {
      msgs = applyResearchOrder(state, 'player', gang.id, item.id);
      if (state.players.player!.researchedItemIds.includes(item.id)) break;
    }
    expect(state.players.player!.researchedItemIds).toContain(item.id);
    expect(msgs.some((m) => m.includes('unlocks'))).toBe(true);
  });

  it('fabricate and equip improve gear loadout', () => {
    const state = createNewGame({ seed: 12 });
    const gang = livingGangsOf(state, 'player')[0]!;
    const item = ITEM_DEFS.find((i) => i.id === 'pipe_wrench')!;
    state.players.player!.researchedItemIds.push(item.id);
    state.players.player!.cash = 500;
    const fab = fabricateItem(state, 'player', item.id);
    expect(fab).toContain('Fabricated');
    const eq = equipItem(state, 'player', gang.id, item.id);
    expect(eq).toContain('Equipped');
    expect(gang.equipped).toContain(item.id);
  });

  it('research order resolves in turn pipeline', () => {
    let state = createNewGame({ seed: 13 });
    const gang = livingGangsOf(state, 'player')[0]!;
    gang.defId = 'chrome_choir';
    const itemId = 'cool_shades';
    state = queueOrder(
      state,
      createOrder({
        playerId: 'player',
        type: 'research',
        gangId: gang.id,
        itemId,
      }),
    );
    const { state: next } = resolveTurn(state);
    expect(
      next.players.player!.researchProgress?.itemId === itemId ||
        next.players.player!.researchedItemIds.includes(itemId),
    ).toBe(true);
  });
});
