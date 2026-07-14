import { gangDefById, siteDefById } from '../content';
import { countSectorsOwned } from './map';
import type { GameState, PlayerId, TurnForecast } from './types';
import { previewAttackWithIntel } from './intel';

/** Balance: territory pays; pure unrest is weaker and heat-heavier late. */
const BASE_SECTOR_INCOME = 18;
const UNREST_CASH_PER_POINT = 5;

export interface IncomeBreakdown {
  total: number;
  territory: number;
  sites: number;
  unrest: number;
  landmarks: number;
}

export function computeIncomeBreakdown(state: GameState, playerId: PlayerId): IncomeBreakdown {
  const territory = countSectorsOwned(state.sectors, playerId) * BASE_SECTOR_INCOME;
  let sites = 0;
  let unrest = 0;
  let landmarks = 0;
  for (const sector of Object.values(state.sectors)) {
    if (sector.owner !== playerId) continue;
    unrest += Math.floor(sector.unrest * UNREST_CASH_PER_POINT * 0.25);
    for (const site of sector.sites) {
      if (site.influencer === playerId) {
        sites += siteDefById(site.defId).cashBonus;
      }
    }
    if (sector.landmark) landmarks += sector.landmark.cashBonus;
  }
  return {
    territory,
    sites,
    unrest,
    landmarks,
    total: territory + sites + unrest + landmarks,
  };
}

export function computeIncome(state: GameState, playerId: PlayerId): number {
  return computeIncomeBreakdown(state, playerId).total;
}

/** Preview cash / unrest / heat for a Raise Unrest order (mirrors resolveTurn). */
export function previewUnrestOrder(
  state: GameState,
  gangId: string,
): { cash: number; unrestGain: number; heatSpike: number; sectorId: string; unrestNow: number } | null {
  const gang = state.gangs[gangId];
  if (!gang) return null;
  const sector = state.sectors[gang.sectorId];
  if (!sector || sector.owner !== gang.ownerId) return null;
  if (sector.unrest >= 10) {
    return {
      cash: 0,
      unrestGain: 0,
      heatSpike: 0,
      sectorId: sector.id,
      unrestNow: sector.unrest,
    };
  }
  const def = gangDefById(gang.defId);
  const unrestMult = 1 - sector.unrest * 0.06;
  let unrestGain = 2;
  let cash = Math.floor((18 + def.combat * 3) * Math.max(0.5, unrestMult));
  let heatSpike = 4;
  if (def.id === 'static_kids') {
    unrestGain += 1;
    heatSpike += 1;
  }
  if (def.id === 'ledger_saints') cash += 12;
  if (def.id === 'moon_debtors') {
    cash += 10;
    heatSpike += 1;
  }
  unrestGain = Math.min(unrestGain, 10 - sector.unrest);
  return {
    cash,
    unrestGain,
    heatSpike,
    sectorId: sector.id,
    unrestNow: sector.unrest,
  };
}

export function computeUpkeep(state: GameState, playerId: PlayerId): number {
  let upkeep = 0;
  for (const g of Object.values(state.gangs)) {
    if (g.ownerId !== playerId) continue;
    upkeep += gangDefById(g.defId).upkeep;
  }
  return upkeep;
}

export function applyEconomy(state: GameState): string[] {
  const messages: string[] = [];
  for (const pid of state.playerOrder) {
    const p = state.players[pid];
    if (!p || p.eliminated) continue;
    const income = computeIncome(state, pid);
    const upkeep = computeUpkeep(state, pid);
    const delta = income - upkeep;
    p.cash += delta;

    // Support from sites + sectors + landmarks
    let supportGain = Math.floor(countSectorsOwned(state.sectors, pid) * 0.5);
    for (const sector of Object.values(state.sectors)) {
      for (const site of sector.sites) {
        if (site.influencer === pid) {
          supportGain += siteDefById(site.defId).supportBonus;
        }
      }
      if (sector.owner === pid && sector.landmark) {
        supportGain += sector.landmark.supportBonus;
      }
    }
    // Overextension: sectors without gangs bleed support
    let emptyOwned = 0;
    for (const sector of Object.values(state.sectors)) {
      if (sector.owner === pid && sector.gangIds.length === 0) emptyOwned++;
    }
    supportGain -= emptyOwned;
    p.support = Math.max(0, p.support + supportGain);

    const br = computeIncomeBreakdown(state, pid);
    messages.push(
      `${p.name}: +$${income} income (turf $${br.territory} · sites $${br.sites} · Unrest $${br.unrest} · landmarks $${br.landmarks}), -$${upkeep} upkeep (net ${delta >= 0 ? '+' : ''}${delta}), support ${p.support}.`,
    );

    // Street clinics & heal sites patch your gangs standing on influenced blocks
    for (const sector of Object.values(state.sectors)) {
      let heal = 0;
      for (const site of sector.sites) {
        if (site.influencer !== pid) continue;
        heal += siteDefById(site.defId).healBonus ?? 0;
      }
      if (heal <= 0) continue;
      let patched = 0;
      for (const gid of sector.gangIds) {
        const g = state.gangs[gid];
        if (!g || g.ownerId !== pid || g.hp <= 0) continue;
        const before = g.hp;
        g.hp = Math.min(100, g.hp + heal);
        if (g.hp > before) patched += 1;
      }
      if (patched > 0) {
        messages.push(
          `${p.name}: clinic care in ${sector.id} patches ${patched} crew(s) (+${heal} HP).`,
        );
      }
    }

    if (p.cash < 0) {
      // Debt: damage random gang upkeep pressure
      p.cash = 0;
      messages.push(`${p.name} is broke — unpaid gangs lose morale.`);
      for (const g of Object.values(state.gangs)) {
        if (g.ownerId === pid) g.hp = Math.max(1, g.hp - 10);
      }
    }
  }

  // City heat: drift toward unrest pressure (do NOT hard-reset — action spikes would vanish)
  const totalUnrest = Object.values(state.sectors).reduce((s, sec) => s + sec.unrest, 0);
  const pressure = Math.floor(totalUnrest * 1.35);
  if (pressure > state.cityHeat) {
    // Climb toward pressure so map-wide unrest bites
    const climb = Math.max(1, Math.ceil((pressure - state.cityHeat) * 0.4));
    state.cityHeat = Math.min(100, state.cityHeat + climb);
  } else if (state.cityHeat > pressure + 2) {
    // Cool slowly when the streets calm
    state.cityHeat = Math.max(pressure, state.cityHeat - 2);
  }
  state.cityHeat = Math.min(100, Math.max(0, state.cityHeat));

  // Slightly earlier police pressure so unrest snowballing is riskier
  if (state.cityHeat >= 75) {
    messages.push(...policeCrackdown(state));
  } else if (state.cityHeat >= 55) {
    messages.push(`Police scanners light up the skyline. Heat ${state.cityHeat} — high.`);
  } else if (state.cityHeat >= 35) {
    messages.push(`Heat ${state.cityHeat}: patrols thicken. Keep pushing unrest and they'll come hard.`);
  }

  // Empty sector decay: unoccupied owned sectors may go neutral
  for (const sector of Object.values(state.sectors)) {
    if (sector.owner && sector.gangIds.length === 0 && sector.unrest < 2) {
      // soft decay chance baked as deterministic every 3 turns
      if (state.turn % 3 === 0) {
        const prev = sector.owner;
        sector.owner = null;
        for (const site of sector.sites) {
          if (site.influencer === prev) site.influencer = null;
        }
        messages.push(`Sector ${sector.id} slips from ${state.players[prev]?.name ?? prev}'s grip.`);
      }
    }
  }

  return messages;
}

function policeCrackdown(state: GameState): string[] {
  const messages: string[] = ['WUS POLICE CRACKDOWN! Neon cages drop across the hottest blocks.'];
  // Hit highest unrest sectors
  const ranked = Object.values(state.sectors).sort((a, b) => b.unrest - a.unrest).slice(0, 4);
  for (const sector of ranked) {
    sector.unrest = Math.max(0, sector.unrest - 3);
    for (const gid of [...sector.gangIds]) {
      const g = state.gangs[gid];
      if (!g) continue;
      g.hp = Math.max(0, g.hp - 35);
      if (g.hp <= 0) {
        sector.gangIds = sector.gangIds.filter((x) => x !== gid);
        delete state.gangs[gid];
        messages.push(`Police wipe out a gang in ${sector.id}.`);
      } else {
        messages.push(`Police maul a gang in ${sector.id} (HP ${g.hp}).`);
      }
    }
  }
  state.cityHeat = Math.max(40, state.cityHeat - 25);
  return messages;
}

export function forecastTurn(state: GameState): TurnForecast {
  const projectedCash: Record<string, number> = {};
  for (const pid of state.playerOrder) {
    const p = state.players[pid];
    if (!p) continue;
    projectedCash[pid] = p.cash + computeIncome(state, pid) - computeUpkeep(state, pid);
  }

  const pendingBattles: TurnForecast['pendingBattles'] = [];
  for (const order of state.orders) {
    if (order.type !== 'attack' || !order.targetSectorId) continue;
    const prev = previewAttackWithIntel(
      state,
      [order.gangId],
      order.targetSectorId,
      order.playerId,
    );
    pendingBattles.push({
      sectorId: order.targetSectorId,
      attackerId: order.playerId,
      defenderId: prev.defenderId,
      winChance: prev.winChance,
      winChanceMin: prev.winChanceMin,
      winChanceMax: prev.winChanceMax,
      fogged: prev.fogged,
    });
  }

  // Project heat if unrest orders fire (matches resolveTurn spikes)
  let heat = state.cityHeat;
  for (const order of state.orders) {
    if (order.type === 'unrest') heat += 4;
  }
  heat = Math.min(100, heat);

  let policeRisk: TurnForecast['policeRisk'] = 'low';
  if (heat >= 80) policeRisk = 'critical';
  else if (heat >= 60) policeRisk = 'high';
  else if (heat >= 40) policeRisk = 'medium';

  return {
    projectedCash,
    projectedHeat: heat,
    pendingBattles,
    policeRisk,
  };
}
