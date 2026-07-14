/**
 * Simultaneous orders, then combat in contested sectors.
 * All players' orders are collected before resolution.
 */
import { gangDefById, siteDefById } from '../content';
import { resolveCombat } from './combat';
import { captureSnapshot, emptyStyle, recordStyleFromOrders } from './debrief';
import { applyEconomy } from './economy';
import { maybeFireCityEvent } from './events';
import { applyScout } from './intel';
import { noteJobAction, tickJobs } from './jobs';
import { areAdjacent } from './map';
import { applyResearchOrder } from './research';
import { createRng } from './rng';
import { advanceHirePool, cloneState } from './state';
import type { CombatResult, GameState, Order, ResolveTurnResult, SectorId } from './types';
import { checkVictory, markEliminations } from './victory';

export function resolveTurn(input: GameState): ResolveTurnResult {
  const state = cloneState(input);
  const rng = createRng(state.seed + state.turn * 7919);
  const combats: CombatResult[] = [];

  // Track human style before orders clear
  if (!state.humanStyle) state.humanStyle = emptyStyle();
  const humanId = state.playerOrder.find((id) => state.players[id]?.isHuman) ?? 'player';
  recordStyleFromOrders(state, state.humanStyle, humanId);

  const moves: Order[] = [];
  const claims: Order[] = [];
  const attacks: Order[] = [];
  const unrestOrders: Order[] = [];
  const influence: Order[] = [];
  const research: Order[] = [];
  const scouts: Order[] = [];

  for (const o of state.orders) {
    switch (o.type) {
      case 'move':
        moves.push(o);
        break;
      case 'claim':
        claims.push(o);
        break;
      case 'attack':
        attacks.push(o);
        break;
      case 'unrest':
        unrestOrders.push(o);
        break;
      case 'influence':
        influence.push(o);
        break;
      case 'research':
        research.push(o);
        break;
      case 'scout':
        scouts.push(o);
        break;
      default:
        break;
    }
  }

  // 0) Scouts first (intel for later UI; combat already uses true numbers server-side)
  for (const o of scouts) {
    const gang = state.gangs[o.gangId];
    if (!gang || !o.targetSectorId) continue;
    if (!areAdjacent(gang.sectorId, o.targetSectorId)) continue;
    applyScout(state, o.playerId, o.targetSectorId, 4);
    state.log.push({
      turn: state.turn,
      kind: 'info',
      message: `${state.players[o.playerId]?.name} scouts sector ${o.targetSectorId}.`,
    });
  }

  // 1) Moves into friendly/empty
  for (const o of moves) {
    const gang = state.gangs[o.gangId];
    if (!gang || !o.targetSectorId) continue;
    if (!areAdjacent(gang.sectorId, o.targetSectorId)) continue;
    const target = state.sectors[o.targetSectorId]!;
    if (target.owner && target.owner !== o.playerId) continue;
    const from = state.sectors[gang.sectorId]!;
    from.gangIds = from.gangIds.filter((id) => id !== gang.id);
    // Strip stale copies of this gang anywhere else (defensive)
    for (const s of Object.values(state.sectors)) {
      if (s.id !== o.targetSectorId && s.gangIds.includes(gang.id)) {
        s.gangIds = s.gangIds.filter((id) => id !== gang.id);
      }
    }
    gang.sectorId = o.targetSectorId;
    if (!target.gangIds.includes(gang.id)) target.gangIds.push(gang.id);
    if (!target.owner) target.owner = o.playerId;
  }

  // 2) Claims on empty neutrals
  for (const o of claims) {
    const gang = state.gangs[o.gangId];
    if (!gang || !o.targetSectorId) continue;
    if (!areAdjacent(gang.sectorId, o.targetSectorId)) continue;
    const target = state.sectors[o.targetSectorId]!;
    if (target.owner) continue;
    const from = state.sectors[gang.sectorId]!;
    from.gangIds = from.gangIds.filter((id) => id !== gang.id);
    for (const s of Object.values(state.sectors)) {
      if (s.id !== o.targetSectorId && s.gangIds.includes(gang.id)) {
        s.gangIds = s.gangIds.filter((id) => id !== gang.id);
      }
    }
    gang.sectorId = o.targetSectorId;
    if (!target.gangIds.includes(gang.id)) target.gangIds.push(gang.id);
    target.owner = o.playerId;
    state.log.push({
      turn: state.turn,
      kind: 'info',
      message: `${state.players[o.playerId]?.name} claims sector ${o.targetSectorId}.`,
    });
    for (const m of noteJobAction(state, o.playerId, { type: 'claim' })) {
      state.log.push({ turn: state.turn, kind: 'job', message: m });
    }
  }

  // 3) Attacks
  const attackGroups = new Map<string, { attackerId: string; sectorId: SectorId; gangIds: string[] }>();
  for (const o of attacks) {
    const gang = state.gangs[o.gangId];
    if (!gang || !o.targetSectorId) continue;
    if (!areAdjacent(gang.sectorId, o.targetSectorId)) continue;
    const key = `${o.playerId}|${o.targetSectorId}`;
    const g = attackGroups.get(key) ?? {
      attackerId: o.playerId,
      sectorId: o.targetSectorId,
      gangIds: [],
    };
    g.gangIds.push(o.gangId);
    attackGroups.set(key, g);
  }

  for (const group of attackGroups.values()) {
    const result = resolveCombat(state, group.sectorId, group.attackerId, group.gangIds, rng);
    combats.push(result);
    state.log.push({
      turn: state.turn,
      kind: 'combat',
      message: result.summary,
      combat: result,
    });
    // Scout reveal after fight
    applyScout(state, group.attackerId, group.sectorId, 2);
    if (result.attackerWon) {
      for (const m of noteJobAction(state, group.attackerId, { type: 'win_attack' })) {
        state.log.push({ turn: state.turn, kind: 'job', message: m });
      }
    }
  }

  // 4) Influence
  for (const o of influence) {
    const gang = state.gangs[o.gangId];
    if (!gang || o.siteSlot === undefined) continue;
    const sector = state.sectors[gang.sectorId];
    if (!sector || sector.owner !== o.playerId) continue;
    const site = sector.sites[o.siteSlot];
    if (!site) continue;
    site.influencer = o.playerId;
    const def = gangDefById(gang.defId);
    const siteDef = siteDefById(site.defId);
    if (def.id === 'pollen_syndicate') {
      state.players[o.playerId]!.support += 1;
    }
    if (def.id === 'holy_voltage' && site.defId === 'media_hub') {
      state.players[o.playerId]!.support += 2;
    }
    const payoff: string[] = [];
    if (siteDef.cashBonus) payoff.push(`+$${siteDef.cashBonus}/turn`);
    if (siteDef.supportBonus) payoff.push(`+${siteDef.supportBonus} support/turn`);
    if (siteDef.researchBonus) payoff.push(`+${siteDef.researchBonus} research`);
    if (siteDef.combatBonus) payoff.push(`+${siteDef.combatBonus} combat`);
    if (siteDef.healBonus) payoff.push(`+${siteDef.healBonus} HP heal/turn`);
    const payoffStr = payoff.length ? ` (${payoff.join(', ')})` : '';
    state.log.push({
      turn: state.turn,
      kind: 'info',
      message: `${state.players[o.playerId]?.name} influences ${siteDef.name} in ${sector.id}${payoffStr}.`,
    });
    for (const m of noteJobAction(state, o.playerId, {
      type: 'influence',
      siteDefId: site.defId,
    })) {
      state.log.push({ turn: state.turn, kind: 'job', message: m });
    }
  }

  // 4b) Research
  for (const o of research) {
    if (!o.itemId) continue;
    const before = [...(state.players[o.playerId]?.researchedItemIds ?? [])];
    const msgs = applyResearchOrder(state, o.playerId, o.gangId, o.itemId);
    for (const m of msgs) {
      state.log.push({ turn: state.turn, kind: 'info', message: m });
    }
    const after = state.players[o.playerId]?.researchedItemIds ?? [];
    if (after.length > before.length) {
      for (const m of noteJobAction(state, o.playerId, { type: 'research_complete' })) {
        state.log.push({ turn: state.turn, kind: 'job', message: m });
      }
    }
  }

  // 5) Unrest — cash + sector unrest + city heat (must own the block)
  for (const o of unrestOrders) {
    const gang = state.gangs[o.gangId];
    if (!gang) continue;
    const sector = state.sectors[gang.sectorId];
    const who = state.players[o.playerId]?.name ?? o.playerId;
    if (!sector || sector.owner !== o.playerId) {
      state.log.push({
        turn: state.turn,
        kind: 'info',
        message: `${who}'s unrest fizzles — crew must stand on turf they own.`,
      });
      continue;
    }
    if (sector.unrest >= 10) {
      state.log.push({
        turn: state.turn,
        kind: 'info',
        message: `${who} tries to stir ${sector.id} but unrest is already maxed (10).`,
      });
      continue;
    }
    const def = gangDefById(gang.defId);
    // Diminishing returns: high sector unrest pays less cash
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
    const before = sector.unrest;
    sector.unrest = Math.min(10, sector.unrest + unrestGain);
    const gained = sector.unrest - before;
    state.players[o.playerId]!.cash += cash;
    state.cityHeat = Math.min(100, state.cityHeat + heatSpike);
    state.log.push({
      turn: state.turn,
      kind: 'economy',
      message: `${who} raises unrest in ${sector.id}: +$${cash}, unrest ${before}→${sector.unrest} (+${gained}), city Heat +${heatSpike} (now ${state.cityHeat}).`,
    });
    for (const m of noteJobAction(state, o.playerId, { type: 'unrest' })) {
      state.log.push({ turn: state.turn, kind: 'job', message: m });
    }
  }

  // 6) Economy + police
  const econMsgs = applyEconomy(state);
  for (const m of econMsgs) {
    state.log.push({
      turn: state.turn,
      kind: m.includes('POLICE') || m.includes('Police') ? 'police' : 'economy',
      message: m,
    });
  }

  // 6b) City events
  const cityEventResult = maybeFireCityEvent(state);
  for (const m of cityEventResult.messages) {
    state.log.push({ turn: state.turn, kind: 'event', message: m });
  }
  const cityEvent = cityEventResult.def
    ? {
        id: cityEventResult.def.id,
        name: cityEventResult.def.name,
        description: cityEventResult.def.description,
        tone: cityEventResult.def.tone,
        messages: cityEventResult.messages.filter((m) => !m.startsWith('CITY EVENT')),
      }
    : null;

  // 6c) Jobs tick / expire
  for (const m of tickJobs(state)) {
    state.log.push({ turn: state.turn, kind: 'job', message: m });
  }

  // 7) Eliminations + victory
  markEliminations(state);
  const winner = checkVictory(state);
  if (winner) {
    state.winnerId = winner;
    state.log.push({
      turn: state.turn,
      kind: 'victory',
      message: `${state.players[winner]?.name} wins the city!`,
    });
  }

  // Snapshot for debrief (post-resolution state)
  if (!state.history) state.history = [];
  state.history.push(captureSnapshot(state));
  if (state.history.length > 80) state.history = state.history.slice(-80);

  // 8) Advance turn
  if (!state.winnerId) {
    state.turn += 1;
    state.orders = [];
    for (const g of Object.values(state.gangs)) g.ordersDone = false;
    advanceHirePool(state);
  } else {
    state.orders = [];
  }

  if (state.log.length > 220) {
    state.log = state.log.slice(-220);
  }

  return { state, combats, cityEvent };
}
