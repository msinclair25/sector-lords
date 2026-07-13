import { gangDefById, itemDefById, siteDefById, ITEM_DEFS } from '../content';
import type { GameState, ItemDef, PlayerId, SectorId } from './types';

export function playerLabBonus(state: GameState, playerId: PlayerId): number {
  let bonus = 0;
  for (const sector of Object.values(state.sectors)) {
    for (const site of sector.sites) {
      if (site.influencer === playerId) {
        bonus += siteDefById(site.defId).researchBonus;
      }
    }
  }
  return bonus;
}

export function effectiveTech(state: GameState, gangId: string): number {
  const gang = state.gangs[gangId];
  if (!gang) return 0;
  const def = gangDefById(gang.defId);
  let tech = def.tech;
  if (def.id === 'chrome_choir') tech += 1;
  return tech;
}

export function canResearchItem(
  state: GameState,
  playerId: PlayerId,
  gangId: string,
  itemId: string,
): string | null {
  const player = state.players[playerId];
  if (!player) return 'Invalid player.';
  if (player.researchedItemIds.includes(itemId)) return 'Already researched.';
  const item = itemDefById(itemId);
  const tech = effectiveTech(state, gangId);
  if (tech < item.techLevel) return `Needs tech ${item.techLevel} (gang has ${tech}).`;
  return null;
}

export function researchPointsThisAction(state: GameState, playerId: PlayerId, gangId: string): number {
  const tech = effectiveTech(state, gangId);
  const labs = playerLabBonus(state, playerId);
  return Math.max(1, tech + labs);
}

/** Apply research progress; returns messages. */
export function applyResearchOrder(
  state: GameState,
  playerId: PlayerId,
  gangId: string,
  itemId: string,
): string[] {
  const messages: string[] = [];
  const player = state.players[playerId]!;
  const err = canResearchItem(state, playerId, gangId, itemId);
  if (err && !player.researchProgress) return [err];

  // If switching projects without completing, restart
  if (player.researchProgress && player.researchProgress.itemId !== itemId) {
    player.researchProgress = { itemId, points: 0 };
  }
  if (!player.researchProgress) {
    const startErr = canResearchItem(state, playerId, gangId, itemId);
    if (startErr) return [startErr];
    player.researchProgress = { itemId, points: 0 };
  }

  const item = itemDefById(player.researchProgress.itemId);
  const pts = researchPointsThisAction(state, playerId, gangId);
  player.researchProgress.points += pts;
  messages.push(
    `${player.name} researches ${item.name} (+${pts}, ${player.researchProgress.points}/${item.researchCost}).`,
  );

  if (player.researchProgress.points >= item.researchCost) {
    player.researchedItemIds.push(item.id);
    player.researchProgress = null;
    messages.push(`${player.name} unlocks ${item.name}!`);
  }
  return messages;
}

export function fabricateItem(state: GameState, playerId: PlayerId, itemId: string): string {
  const player = state.players[playerId];
  if (!player) return 'Invalid player.';
  if (!player.researchedItemIds.includes(itemId)) return 'Not researched yet.';
  const item = itemDefById(itemId);
  if (player.cash < item.fabricateCost) return `Need $${item.fabricateCost}.`;
  player.cash -= item.fabricateCost;
  player.inventory[itemId] = (player.inventory[itemId] ?? 0) + 1;
  return `Fabricated ${item.name} (−$${item.fabricateCost}).`;
}

export function equipItem(
  state: GameState,
  playerId: PlayerId,
  gangId: string,
  itemId: string,
): string {
  const player = state.players[playerId];
  const gang = state.gangs[gangId];
  if (!player || !gang || gang.ownerId !== playerId) return 'Invalid gang.';
  if ((player.inventory[itemId] ?? 0) < 1) return 'Not in inventory.';
  const item = itemDefById(itemId);

  // One item per type slot
  const existingOfType = gang.equipped.find((id) => itemDefById(id).type === item.type);
  if (existingOfType) {
    // return old to inventory
    player.inventory[existingOfType] = (player.inventory[existingOfType] ?? 0) + 1;
    gang.equipped = gang.equipped.filter((id) => id !== existingOfType);
  }

  player.inventory[itemId] -= 1;
  if (player.inventory[itemId] <= 0) delete player.inventory[itemId];
  gang.equipped.push(itemId);
  return `Equipped ${item.name} on ${gangDefById(gang.defId).name}.`;
}

export function unequipItem(
  state: GameState,
  playerId: PlayerId,
  gangId: string,
  itemId: string,
): string {
  const player = state.players[playerId];
  const gang = state.gangs[gangId];
  if (!player || !gang || gang.ownerId !== playerId) return 'Invalid gang.';
  if (!gang.equipped.includes(itemId)) return 'Not equipped.';
  gang.equipped = gang.equipped.filter((id) => id !== itemId);
  player.inventory[itemId] = (player.inventory[itemId] ?? 0) + 1;
  return `Unequipped ${itemDefById(itemId).name}.`;
}

export function equipmentBonuses(state: GameState, gangId: string): {
  combat: number;
  defense: number;
  tags: string[];
} {
  const gang = state.gangs[gangId];
  if (!gang) return { combat: 0, defense: 0, tags: [] };
  let combat = 0;
  let defense = 0;
  const tags: string[] = [];
  for (const id of gang.equipped) {
    const item = itemDefById(id);
    combat += item.combatBonus;
    defense += item.defenseBonus;
    tags.push(...item.tags);
  }
  return { combat, defense, tags };
}

export function researchableItems(state: GameState, playerId: PlayerId, gangId: string): ItemDef[] {
  const tech = effectiveTech(state, gangId);
  const researched = new Set(state.players[playerId]?.researchedItemIds ?? []);
  return ITEM_DEFS.filter((i) => i.techLevel <= tech && !researched.has(i.id));
}

export function totalResearchSpeedInSector(
  state: GameState,
  sectorId: SectorId,
  playerId: PlayerId,
): number {
  const sector = state.sectors[sectorId];
  if (!sector) return 0;
  let n = 0;
  for (const gid of sector.gangIds) {
    const g = state.gangs[gid];
    if (g?.ownerId === playerId) n += effectiveTech(state, gid);
  }
  return n + playerLabBonus(state, playerId);
}
