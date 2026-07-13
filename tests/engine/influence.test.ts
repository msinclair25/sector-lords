import { describe, expect, it } from 'vitest';
import { formatSiteBonuses, siteDefById } from '../../src/content';
import {
  computeIncome,
  computeIncomeBreakdown,
  createNewGame,
  createOrder,
  livingGangsOf,
  queueOrder,
  resolveTurn,
} from '../../src/engine';

describe('influence & sites', () => {
  it('formats site bonuses for UI', () => {
    const casino = siteDefById('casino');
    expect(formatSiteBonuses(casino)).toContain('$25');
    const clinic = siteDefById('clinic');
    expect(formatSiteBonuses(clinic)).toMatch(/heal/i);
  });

  it('site cash applies only when influenced', () => {
    let state = createNewGame({ seed: 42 });
    const human = 'player';
    const home = Object.values(state.sectors).find((s) => s.owner === human)!;
    // Force a casino in slot 0
    home.sites[0] = { defId: 'casino', influencer: null };
    const before = computeIncome(state, human);

    home.sites[0]!.influencer = human;
    const after = computeIncome(state, human);
    expect(after - before).toBe(25);

    const br = computeIncomeBreakdown(state, human);
    expect(br.sites).toBeGreaterThanOrEqual(25);
  });

  it('influence order claims a chosen site with payoff log', () => {
    let state = createNewGame({ seed: 7 });
    const human = 'player';
    const gang = livingGangsOf(state, human)[0]!;
    const home = state.sectors[gang.sectorId]!;
    home.sites[1] = { defId: 'lab', influencer: null };

    state = queueOrder(
      state,
      createOrder({
        playerId: human,
        type: 'influence',
        gangId: gang.id,
        siteSlot: 1,
      }),
    );
    const { state: next } = resolveTurn(state);
    expect(next.sectors[gang.sectorId]!.sites[1]!.influencer).toBe(human);
    const log = next.log.map((l) => l.message).join(' ');
    expect(log.toLowerCase()).toMatch(/black lab|lab/);
    expect(log).toMatch(/research/i);
  });

  it('clinic healBonus restores HP on influenced sector', () => {
    let state = createNewGame({ seed: 11 });
    const human = 'player';
    const gang = livingGangsOf(state, human)[0]!;
    gang.hp = 40;
    const home = state.sectors[gang.sectorId]!;
    home.sites[0] = { defId: 'clinic', influencer: human };

    // Economy runs as part of resolve with a defend order
    state = queueOrder(
      state,
      createOrder({ playerId: human, type: 'defend', gangId: gang.id }),
    );
    const { state: next } = resolveTurn(state);
    const g2 = next.gangs[gang.id]!;
    expect(g2.hp).toBeGreaterThan(40);
  });
});
