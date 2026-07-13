import { siteDefById } from '../content';
import { neighbors4, parseSectorId, sectorId } from './map';
import { previewAttack } from './combat';
import type {
  Difficulty,
  GameState,
  IntelLevel,
  OddsPreview,
  PlayerId,
  SectorId,
} from './types';

/** Hard+ AI cheats slightly more fog visibility. */
export function difficultyIntelBonus(difficulty: Difficulty): number {
  switch (difficulty) {
    case 'easy':
      return 0;
    case 'normal':
      return 0;
    case 'hard':
      return 1;
    case 'overlord':
      return 1;
    default:
      return 0;
  }
}

export function hasMediaInfluence(state: GameState, playerId: PlayerId): boolean {
  for (const sector of Object.values(state.sectors)) {
    for (const site of sector.sites) {
      if (site.influencer === playerId && siteDefById(site.defId).id === 'media_hub') {
        return true;
      }
    }
  }
  return false;
}

/**
 * 2 = full intel, 1 = partial (adjacent), 0 = fog.
 */
export function intelLevel(
  state: GameState,
  viewerId: PlayerId,
  targetSectorId: SectorId,
): IntelLevel {
  const sector = state.sectors[targetSectorId];
  if (!sector) return 0;

  if (sector.owner === viewerId) return 2;

  const reveal = state.scoutReveal[viewerId]?.[targetSectorId] ?? 0;
  if (reveal >= state.turn) return 2;

  // Adjacent to any owned sector or own gang
  const { x, y } = parseSectorId(targetSectorId);
  const adj = neighbors4(x, y, state.mapWidth, state.mapHeight);
  let adjacentToSelf = false;
  for (const p of adj) {
    const sid = sectorId(p.x, p.y);
    const s = state.sectors[sid];
    if (!s) continue;
    if (s.owner === viewerId) {
      adjacentToSelf = true;
      break;
    }
    if (s.gangIds.some((gid) => state.gangs[gid]?.ownerId === viewerId)) {
      adjacentToSelf = true;
      break;
    }
  }

  // Own gangs adjacent from target side already covered; also check if any of our gangs is next door
  if (!adjacentToSelf) {
    for (const g of Object.values(state.gangs)) {
      if (g.ownerId !== viewerId) continue;
      const gp = parseSectorId(g.sectorId);
      if (Math.abs(gp.x - x) + Math.abs(gp.y - y) === 1) {
        adjacentToSelf = true;
        break;
      }
    }
  }

  if (adjacentToSelf) {
    // Media hubs upgrade adjacent intel to full
    if (hasMediaInfluence(state, viewerId)) return 2;
    return 1;
  }

  // Difficulty cheat for AI viewers only
  const viewer = state.players[viewerId];
  if (viewer && !viewer.isHuman) {
    const bonus = difficultyIntelBonus(state.difficulty);
    if (bonus > 0 && adjacentToSelf) return 2;
    // Hard AI sees partial on any sector with gangs (not full fog)
    if (state.difficulty === 'overlord' && sector.gangIds.length > 0) return 1;
  }

  return 0;
}

export function applyScout(
  state: GameState,
  playerId: PlayerId,
  sectorIdTarget: SectorId,
  durationTurns = 3,
): void {
  if (!state.scoutReveal[playerId]) state.scoutReveal[playerId] = {};
  state.scoutReveal[playerId]![sectorIdTarget] = state.turn + durationTurns;

  // Data Widows: also reveal adjacent enemy sectors
  const hasWidows = Object.values(state.gangs).some(
    (g) => g.ownerId === playerId && g.defId === 'data_widows' && g.hp > 0,
  );
  if (hasWidows) {
    const { x, y } = parseSectorId(sectorIdTarget);
    for (const p of neighbors4(x, y, state.mapWidth, state.mapHeight)) {
      const sid = sectorId(p.x, p.y);
      state.scoutReveal[playerId]![sid] = state.turn + durationTurns;
    }
  }
}

export function previewAttackWithIntel(
  state: GameState,
  attackerGangIds: string[],
  sectorIdTarget: SectorId,
  attackerId: PlayerId,
): OddsPreview {
  const base = previewAttack(state, attackerGangIds, sectorIdTarget, attackerId);
  const intel = intelLevel(state, attackerId, sectorIdTarget);
  const fogged = intel < 2;
  let spread = 0;
  if (intel === 0) spread = 0.28;
  else if (intel === 1) spread = 0.14;

  const winChanceMin = Math.max(0.05, base.winChance - spread);
  const winChanceMax = Math.min(0.95, base.winChance + spread);

  return {
    ...base,
    winChanceMin,
    winChanceMax,
    intel,
    fogged,
  };
}

export function formatOdds(preview: OddsPreview): string {
  if (!preview.fogged) {
    return `~${Math.round(preview.winChance * 100)}% win`;
  }
  return `~${Math.round(preview.winChanceMin * 100)}–${Math.round(preview.winChanceMax * 100)}% win (intel ${preview.intel}/2)`;
}

/** Visible enemy gang count string for UI. */
export function fogGangLabel(
  state: GameState,
  viewerId: PlayerId,
  sectorIdTarget: SectorId,
): string {
  const sector = state.sectors[sectorIdTarget];
  if (!sector) return '?';
  const intel = intelLevel(state, viewerId, sectorIdTarget);
  if (intel === 2) return String(sector.gangIds.length);
  if (intel === 1) {
    const n = sector.gangIds.length;
    if (n === 0) return '~0';
    if (n <= 2) return '1-2';
    return '3+';
  }
  return '?';
}
