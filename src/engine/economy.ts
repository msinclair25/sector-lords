import { gangDefById, siteDefById } from '../content';
import { countSectorsOwned } from './map';
import type {
  CrackdownResult,
  GameState,
  HeatBand,
  PlayerId,
  SectorId,
  TurnForecast,
} from './types';
import { previewAttackWithIntel } from './intel';

/** Balance: territory pays; pure unrest is weaker and heat-heavier late. */
const BASE_SECTOR_INCOME = 18;
const UNREST_CASH_PER_POINT = 5;

/** Heat breakpoints (0–100) for UI + crackdown trigger */
export const HEAT_BANDS = {
  calmMax: 24,
  watchMax: 49,
  elevatedMax: 69,
  /** Crackdown fires at this heat when cool-off is over */
  crackdownAt: 70,
  criticalMax: 100,
} as const;

export const CRACKDOWN_COOLDOWN_TURNS = 3;
export const CRACKDOWN_TILE_TURNS = 3;
export const CRACKDOWN_HIT_SECTORS = 4;
export const CRACKDOWN_HP_DAMAGE = 40;
export const CRACKDOWN_UNREST_DROP = 3;
export const CRACKDOWN_HEAT_AFTER = 22;

export function heatBand(heat: number): HeatBand {
  if (heat >= HEAT_BANDS.crackdownAt) return 'critical';
  if (heat > HEAT_BANDS.elevatedMax) return 'critical';
  if (heat > HEAT_BANDS.watchMax) return 'elevated';
  if (heat > HEAT_BANDS.calmMax) return 'watch';
  return 'calm';
}

export function heatBandLabel(band: HeatBand): string {
  switch (band) {
    case 'calm':
      return 'Calm';
    case 'watch':
      return 'Watch';
    case 'elevated':
      return 'Elevated';
    case 'critical':
      return 'Critical';
    case 'crackdown':
      return 'Crackdown';
  }
}

/** Short UI line for the current heat state */
export function describeHeatState(state: GameState): string {
  const h = state.cityHeat;
  const cd = state.crackdownCooldown ?? 0;
  if (cd > 0) {
    return `Cool-off ${cd}t · Heat ${h}`;
  }
  const band = heatBand(h);
  if (band === 'critical' || h >= HEAT_BANDS.crackdownAt) {
    return `CRACKDOWN RISK · ${h}/${HEAT_BANDS.crackdownAt}`;
  }
  if (band === 'elevated') return `Elevated · ${h} → crack at ${HEAT_BANDS.crackdownAt}`;
  if (band === 'watch') return `Watch · ${h}`;
  return `Calm · ${h}`;
}

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

export function applyEconomy(state: GameState): {
  messages: string[];
  crackdown: CrackdownResult | null;
} {
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

  if (typeof state.crackdownCooldown !== 'number') state.crackdownCooldown = 0;

  // Tile residual fades each economy tick
  for (const sector of Object.values(state.sectors)) {
    if ((sector.crackdownTurns ?? 0) > 0) {
      sector.crackdownTurns = Math.max(0, (sector.crackdownTurns ?? 0) - 1);
    }
  }

  // Unrest pressure can climb heat (spikes from Raise Unrest already applied earlier in the turn)
  const totalUnrest = Object.values(state.sectors).reduce((s, sec) => s + sec.unrest, 0);
  const pressure = Math.floor(totalUnrest * 1.5);
  const coolOff = state.crackdownCooldown > 0;
  if (pressure > state.cityHeat) {
    const climbRaw = Math.max(1, Math.ceil((pressure - state.cityHeat) * 0.45));
    const climb = coolOff ? Math.max(1, Math.floor(climbRaw * 0.4)) : climbRaw;
    state.cityHeat = Math.min(100, state.cityHeat + climb);
  }
  state.cityHeat = Math.min(100, Math.max(0, state.cityHeat));

  // Fire crackdown while heat is still at the peak for this tick
  let crackdown: CrackdownResult | null = null;
  if (
    state.crackdownCooldown === 0 &&
    state.cityHeat >= HEAT_BANDS.crackdownAt
  ) {
    crackdown = policeCrackdown(state);
    messages.push(...crackdown.messages);
  } else if (state.crackdownCooldown > 0) {
    state.crackdownCooldown = Math.max(0, state.crackdownCooldown - 1);
    if (state.crackdownCooldown === 0) {
      messages.push('Police cool-off ends — the city can crack down again if Heat climbs.');
    } else {
      messages.push(
        `Police cool-off: ${state.crackdownCooldown} turn${state.crackdownCooldown === 1 ? '' : 's'} left (no crackdown).`,
      );
    }
    // Cool-off: heat bleeds faster
    if (state.cityHeat > pressure + 1) {
      state.cityHeat = Math.max(pressure, state.cityHeat - 4);
    }
  } else {
    // Natural cool only when not cracking this turn
    if (state.cityHeat > pressure + 1) {
      state.cityHeat = Math.max(pressure, state.cityHeat - 2);
    }
    const band = heatBand(state.cityHeat);
    if (band === 'critical' || state.cityHeat >= HEAT_BANDS.elevatedMax) {
      messages.push(
        `Heat ${state.cityHeat}: CRITICAL — crackdown at ${HEAT_BANDS.crackdownAt}. Stop raising unrest or pay the price.`,
      );
    } else if (band === 'elevated') {
      messages.push(
        `Heat ${state.cityHeat}: elevated. Patrols thicken — crackdown at ${HEAT_BANDS.crackdownAt}.`,
      );
    } else if (band === 'watch') {
      messages.push(`Heat ${state.cityHeat}: watch list. Unrest is feeding the scanners.`);
    }
  }
  state.cityHeat = Math.min(100, Math.max(0, state.cityHeat));

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

  return { messages, crackdown };
}

function policeCrackdown(state: GameState): CrackdownResult {
  const heatBefore = state.cityHeat;
  const messages: string[] = [
    `WUS POLICE CRACKDOWN! Heat ${heatBefore} — neon cages drop on the hottest blocks.`,
  ];
  const ranked = Object.values(state.sectors)
    .filter((s) => s.unrest > 0 || s.gangIds.length > 0)
    .sort((a, b) => b.unrest - a.unrest || b.gangIds.length - a.gangIds.length)
    .slice(0, CRACKDOWN_HIT_SECTORS);

  const hitIds: SectorId[] = [];
  const fines: Record<string, number> = {};

  for (const sector of ranked) {
    hitIds.push(sector.id);
    sector.crackdownTurns = CRACKDOWN_TILE_TURNS;
    sector.unrest = Math.max(0, sector.unrest - CRACKDOWN_UNREST_DROP);

    for (const gid of [...sector.gangIds]) {
      const g = state.gangs[gid];
      if (!g) continue;
      g.hp = Math.max(0, g.hp - CRACKDOWN_HP_DAMAGE);
      // Cash fine to the owner for each crew hit
      const owner = state.players[g.ownerId];
      if (owner && !owner.eliminated) {
        const fine = 18;
        const paid = Math.min(owner.cash, fine);
        owner.cash -= paid;
        fines[g.ownerId] = (fines[g.ownerId] ?? 0) + paid;
      }
      if (g.hp <= 0) {
        sector.gangIds = sector.gangIds.filter((x) => x !== gid);
        delete state.gangs[gid];
        messages.push(
          `Cops wipe out a crew on ${sector.id} (${state.players[g.ownerId]?.name ?? g.ownerId}).`,
        );
      } else {
        messages.push(
          `Cops maul a crew on ${sector.id} → HP ${g.hp} (${state.players[g.ownerId]?.name ?? g.ownerId}).`,
        );
      }
    }
    if (sector.gangIds.length === 0 && sector.unrest === 0) {
      messages.push(`Block ${sector.id} locked down (crackdown residual ${CRACKDOWN_TILE_TURNS} turns).`);
    } else {
      messages.push(
        `Block ${sector.id}: unrest down, crackdown mark ${CRACKDOWN_TILE_TURNS} turns.`,
      );
    }
  }

  for (const [pid, amt] of Object.entries(fines)) {
    if (amt > 0) {
      messages.push(`${state.players[pid]?.name ?? pid} pays $${amt} in “processing fees”.`);
    }
  }

  state.cityHeat = CRACKDOWN_HEAT_AFTER;
  state.crackdownCooldown = CRACKDOWN_COOLDOWN_TURNS;
  messages.push(
    `Heat collapses to ${state.cityHeat}. Cool-off ${CRACKDOWN_COOLDOWN_TURNS} turns — no second crackdown until then.`,
  );

  if (hitIds.length === 0) {
    messages.push('No hot blocks found — citywide scare only. Heat still resets.');
  }

  return {
    sectorIds: hitIds,
    heatBefore,
    heatAfter: state.cityHeat,
    cooldownTurns: state.crackdownCooldown,
    messages,
  };
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

  const cd = state.crackdownCooldown ?? 0;
  let policeRisk: TurnForecast['policeRisk'] = 'low';
  if (cd > 0) {
    policeRisk = heat >= 50 ? 'medium' : 'low';
  } else if (heat >= HEAT_BANDS.crackdownAt) {
    policeRisk = 'critical';
  } else if (heat >= 55) {
    policeRisk = 'high';
  } else if (heat >= 35) {
    policeRisk = 'medium';
  }

  return {
    projectedCash,
    projectedHeat: heat,
    pendingBattles,
    policeRisk,
  };
}
