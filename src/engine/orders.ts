import { gangDefById } from '../content';
import { areAdjacent } from './map';
import { canResearchItem } from './research';
import type { GameState, Order, OrderType, PlayerId, SectorId } from './types';

let orderSeq = 0;

export function nextOrderId(): string {
  orderSeq += 1;
  return `ord_${orderSeq}`;
}

export function resetOrderSeq(n = 0): void {
  orderSeq = n;
}

export function createOrder(
  partial: Omit<Order, 'id'> & { id?: string },
): Order {
  return {
    id: partial.id ?? nextOrderId(),
    playerId: partial.playerId,
    type: partial.type,
    gangId: partial.gangId,
    targetSectorId: partial.targetSectorId,
    siteSlot: partial.siteSlot,
    itemId: partial.itemId,
  };
}

export function validateOrder(state: GameState, order: Order): string | null {
  if (state.winnerId) return 'Game already over.';
  const player = state.players[order.playerId];
  if (!player || player.eliminated) return 'Player eliminated.';

  const gang = state.gangs[order.gangId];
  if (!gang) return 'Gang not found.';
  if (gang.ownerId !== order.playerId) return 'Not your gang.';
  if (gang.hp <= 0) return 'Gang is destroyed.';

  // One order per gang per turn
  if (state.orders.some((o) => o.gangId === order.gangId)) {
    return 'Gang already has an order.';
  }

  const from = gang.sectorId;

  switch (order.type) {
    case 'idle':
    case 'defend':
    case 'unrest':
      return null;
    case 'move':
    case 'claim':
    case 'attack': {
      if (!order.targetSectorId) return 'Missing target sector.';
      if (!state.sectors[order.targetSectorId]) return 'Invalid sector.';
      if (!areAdjacent(from, order.targetSectorId)) return 'Target not adjacent.';
      if (order.type === 'move') {
        const target = state.sectors[order.targetSectorId]!;
        // Own or empty only — rival territory needs Attack
        if (target.owner && target.owner !== order.playerId) {
          return 'Use Attack to enter rival territory.';
        }
      }
      if (order.type === 'claim') {
        const target = state.sectors[order.targetSectorId]!;
        if (target.owner) return 'Sector already owned — move or attack.';
      }
      if (order.type === 'attack') {
        const target = state.sectors[order.targetSectorId]!;
        if (!target.owner || target.owner === order.playerId) {
          // Can attack empty neutral with gangs? treat as claim
          if (!target.owner && target.gangIds.length === 0) {
            return 'Nothing to attack — claim instead.';
          }
          if (target.owner === order.playerId) return 'Cannot attack your own sector.';
        }
      }
      return null;
    }
    case 'influence': {
      if (order.siteSlot === undefined) return 'Pick a site slot.';
      const sector = state.sectors[from]!;
      if (sector.owner !== order.playerId) return 'Must own sector to influence sites.';
      const site = sector.sites[order.siteSlot];
      if (!site) return 'Invalid site.';
      if (site.influencer === order.playerId) return 'Already influenced.';
      return null;
    }
    case 'research': {
      if (!order.itemId) return 'Pick an item to research.';
      const player = state.players[order.playerId]!;
      // Continuing current project is always ok if item matches
      if (player.researchProgress?.itemId === order.itemId) return null;
      return canResearchItem(state, order.playerId, order.gangId, order.itemId);
    }
    case 'scout': {
      if (!order.targetSectorId) return 'Pick a sector to scout.';
      if (!state.sectors[order.targetSectorId]) return 'Invalid sector.';
      if (!areAdjacent(from, order.targetSectorId) && from !== order.targetSectorId) {
        // Allow scout of adjacent only
        return 'Can only scout adjacent sectors.';
      }
      if (from === order.targetSectorId) return 'Already there — pick an adjacent sector.';
      return null;
    }
    default:
      return 'Unknown order type.';
  }
}

export function queueOrder(state: GameState, order: Order): GameState {
  const err = validateOrder(state, order);
  if (err) throw new Error(err);
  return {
    ...state,
    orders: [...state.orders, order],
  };
}

export function cancelLastOrder(state: GameState, playerId: PlayerId): GameState {
  const idx = [...state.orders].map((o, i) => ({ o, i })).reverse().find((x) => x.o.playerId === playerId)?.i;
  if (idx === undefined) return state;
  const orders = state.orders.filter((_, i) => i !== idx);
  return { ...state, orders };
}

export function cancelOrder(state: GameState, orderId: string, playerId: PlayerId): GameState {
  return {
    ...state,
    orders: state.orders.filter((o) => !(o.id === orderId && o.playerId === playerId)),
  };
}

/** Stable unique id — never reuse after deaths (length-based ids used to collide). */
export function nextHireGangId(
  state: GameState,
  playerId: PlayerId,
): string {
  let n = Object.keys(state.gangs).length + 1;
  let id = `gang_${playerId}_${n}_${state.turn}`;
  while (state.gangs[id]) {
    n += 1;
    id = `gang_${playerId}_${n}_${state.turn}`;
  }
  return id;
}

export function hireGang(
  state: GameState,
  playerId: PlayerId,
  defId: string,
  sectorId: SectorId,
): GameState {
  const player = state.players[playerId];
  if (!player || player.eliminated) throw new Error('Invalid player.');
  const def = gangDefById(defId);
  if (player.cash < def.hireCost) throw new Error('Not enough cash.');
  const sector = state.sectors[sectorId];
  if (!sector || sector.owner !== playerId) throw new Error('Must hire into owned sector.');
  if (!state.hirePool.some((h) => h.defId === defId)) throw new Error('Gang not in hire pool.');

  const id = nextHireGangId(state, playerId);
  const gangs = {
    ...state.gangs,
    [id]: {
      id,
      defId,
      ownerId: playerId,
      sectorId,
      hp: 100,
      ordersDone: false,
      equipped: [],
    },
  };
  const sectors = {
    ...state.sectors,
    [sectorId]: {
      ...sector,
      // Drop stale ids first so re-hires never leave ghost stacks
      gangIds: [...sector.gangIds.filter((g) => g !== id && state.gangs[g]), id],
    },
  };
  const players = {
    ...state.players,
    [playerId]: {
      ...player,
      cash: player.cash - def.hireCost,
    },
  };
  const hirePool = state.hirePool.filter((h) => h.defId !== defId);

  return {
    ...state,
    gangs,
    sectors,
    players,
    hirePool,
    log: [
      ...state.log,
      {
        turn: state.turn,
        kind: 'info',
        message: `${player.name} hired ${def.name} in ${sectorId}.`,
      },
    ],
  };
}

export const ORDER_LABELS: Record<OrderType, string> = {
  move: 'Move',
  attack: 'Attack',
  claim: 'Claim',
  unrest: 'Raise Unrest',
  influence: 'Influence Site',
  defend: 'Defend',
  idle: 'Idle',
  research: 'Research',
  scout: 'Scout',
};
