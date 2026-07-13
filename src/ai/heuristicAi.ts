import { gangDefById, siteDefById } from '../content';
import {
  adaptiveWeights,
  aiAcceptJobs,
  createOrder,
  emptyStyle,
  equipItem,
  fabricateItem,
  hireGang,
  livingGangsOf,
  neighbors4,
  parseSectorId,
  previewAttack,
  researchableItems,
  sectorId,
  type Difficulty,
  type GameState,
  type Order,
  type PlayerId,
  type SiteSlot,
} from '../engine';

/** Score an open site for AI influence (higher = better). */
function scoreSiteForAi(
  state: GameState,
  playerId: PlayerId,
  defId: string,
  weights: { expand: number; aggression: number; unrest: number; tech: number },
): number {
  const def = siteDefById(defId);
  const player = state.players[playerId]!;
  let score = 0;
  // Cash pressure
  if (player.cash < 200) score += def.cashBonus * 2.5;
  else score += def.cashBonus * 1.2;
  score += def.supportBonus * (weights.expand * 4 + 2);
  score += def.researchBonus * (weights.tech * 8 + 3);
  score += def.combatBonus * (weights.aggression * 5 + 2);
  score += (def.healBonus ?? 0) * 0.8;
  return score;
}

function bestInfluenceSlot(
  state: GameState,
  playerId: PlayerId,
  sectorSites: GameState['sectors'][string]['sites'],
  weights: { expand: number; aggression: number; unrest: number; tech: number },
): SiteSlot | null {
  let best: { slot: SiteSlot; score: number } | null = null;
  for (let i = 0; i < sectorSites.length; i++) {
    const site = sectorSites[i]!;
    if (site.influencer === playerId) continue;
    const score = scoreSiteForAi(state, playerId, site.defId, weights);
    // Slight penalty if contesting rival
    const adjusted = site.influencer ? score * 0.85 : score;
    if (!best || adjusted > best.score) best = { slot: i as SiteSlot, score: adjusted };
  }
  return best?.slot ?? null;
}

function attackThreshold(difficulty: Difficulty, aggression: number): number {
  let base = 0.55;
  switch (difficulty) {
    case 'easy':
      base = 0.65;
      break;
    case 'normal':
      base = 0.55;
      break;
    case 'hard':
      base = 0.48;
      break;
    case 'overlord':
      base = 0.42;
      break;
  }
  // Higher aggression → lower win% required to attack
  return Math.max(0.35, base - (aggression - 0.4) * 0.2);
}

/**
 * Heuristic AI with adaptive counter-weights from human play style.
 */
export function generateAiOrders(state: GameState, playerId: PlayerId): Order[] {
  const player = state.players[playerId];
  if (!player || player.eliminated) return [];

  const orders: Order[] = [];
  const usedGangs = new Set<string>();
  const gangs = livingGangsOf(state, playerId);
  const weights = adaptiveWeights(state.humanStyle ?? emptyStyle());
  const thresh = attackThreshold(state.difficulty, weights.aggression);

  // Tech priority rises when adaptive tech weight high or human is warmonger
  const techGang = gangs
    .slice()
    .sort((a, b) => gangDefById(b.defId).tech - gangDefById(a.defId).tech)[0];
  const wantResearch =
    techGang &&
    gangDefById(techGang.defId).tech >= 3 &&
    (weights.tech > 0.35 || (player.researchProgress !== null));
  if (wantResearch && techGang) {
    const target =
      player.researchProgress?.itemId ??
      researchableItems(state, playerId, techGang.id)[0]?.id;
    if (target) {
      orders.push(
        createOrder({
          playerId,
          type: 'research',
          gangId: techGang.id,
          itemId: target,
        }),
      );
      usedGangs.add(techGang.id);
    }
  }

  for (const gang of gangs) {
    if (usedGangs.has(gang.id)) continue;
    const sector = state.sectors[gang.sectorId]!;
    const { x, y } = parseSectorId(gang.sectorId);
    const adj = neighbors4(x, y, state.mapWidth, state.mapHeight);

    // Expand first if expand weight high
    const empty = adj.find((p) => {
      const s = state.sectors[sectorId(p.x, p.y)]!;
      return !s.owner;
    });
    if (empty && weights.expand >= 0.35) {
      orders.push(
        createOrder({
          playerId,
          type: 'claim',
          gangId: gang.id,
          targetSectorId: sectorId(empty.x, empty.y),
        }),
      );
      usedGangs.add(gang.id);
      continue;
    }

    let bestAttack: { target: string; chance: number } | null = null;
    for (const p of adj) {
      const tid = sectorId(p.x, p.y);
      const s = state.sectors[tid]!;
      if (!s.owner || s.owner === playerId) continue;
      const prev = previewAttack(state, [gang.id], tid, playerId);
      if (
        prev.winChance >= thresh - 0.1 &&
        (!bestAttack || prev.winChance > bestAttack.chance)
      ) {
        bestAttack = { target: tid, chance: prev.winChance };
      }
    }

    // Defend-first when human is aggressive: keep a garrison if alone on border
    if (weights.defend > 0.45 && sector.owner === playerId) {
      const threatened = adj.some((p) => {
        const s = state.sectors[sectorId(p.x, p.y)]!;
        return s.owner && s.owner !== playerId && s.gangIds.length > 0;
      });
      if (threatened && sector.gangIds.length <= 1 && bestAttack && bestAttack.chance < thresh + 0.1) {
        orders.push(createOrder({ playerId, type: 'defend', gangId: gang.id }));
        usedGangs.add(gang.id);
        continue;
      }
    }

    if (bestAttack && bestAttack.chance >= thresh) {
      orders.push(
        createOrder({
          playerId,
          type: 'attack',
          gangId: gang.id,
          targetSectorId: bestAttack.target,
        }),
      );
      usedGangs.add(gang.id);
      continue;
    }

    if (bestAttack && bestAttack.chance < thresh) {
      orders.push(
        createOrder({
          playerId,
          type: 'scout',
          gangId: gang.id,
          targetSectorId: bestAttack.target,
        }),
      );
      usedGangs.add(gang.id);
      continue;
    }

    if (empty) {
      orders.push(
        createOrder({
          playerId,
          type: 'claim',
          gangId: gang.id,
          targetSectorId: sectorId(empty.x, empty.y),
        }),
      );
      usedGangs.add(gang.id);
      continue;
    }

    if (sector.owner === playerId) {
      const slot = bestInfluenceSlot(state, playerId, sector.sites, weights);
      if (slot !== null) {
        orders.push(
          createOrder({
            playerId,
            type: 'influence',
            gangId: gang.id,
            siteSlot: slot,
          }),
        );
        usedGangs.add(gang.id);
        continue;
      }
    }

    if (weights.unrest > 0.25 && player.cash < 180 && sector.owner === playerId) {
      orders.push(createOrder({ playerId, type: 'unrest', gangId: gang.id }));
      usedGangs.add(gang.id);
      continue;
    }

    if (player.cash < 150 && sector.owner === playerId) {
      orders.push(createOrder({ playerId, type: 'unrest', gangId: gang.id }));
      usedGangs.add(gang.id);
      continue;
    }

    const frontier = adj.find((p) => {
      const s = state.sectors[sectorId(p.x, p.y)]!;
      return s.owner !== playerId;
    });
    if (frontier) {
      const tid = sectorId(frontier.x, frontier.y);
      const s = state.sectors[tid]!;
      if (!s.owner) {
        orders.push(
          createOrder({
            playerId,
            type: 'claim',
            gangId: gang.id,
            targetSectorId: tid,
          }),
        );
      } else if (s.owner !== playerId) {
        orders.push(
          createOrder({
            playerId,
            type: 'attack',
            gangId: gang.id,
            targetSectorId: tid,
          }),
        );
      }
      usedGangs.add(gang.id);
      continue;
    }

    orders.push(createOrder({ playerId, type: 'defend', gangId: gang.id }));
    usedGangs.add(gang.id);
  }

  return orders;
}

export function aiMaybeHire(state: GameState, playerId: PlayerId): GameState {
  const player = state.players[playerId];
  if (!player || player.eliminated) return state;

  const owned = Object.values(state.sectors).filter((s) => s.owner === playerId);
  if (owned.length === 0) return state;

  const weights = adaptiveWeights(state.humanStyle ?? emptyStyle());
  const reserve =
    state.difficulty === 'easy' ? 80 : state.difficulty === 'overlord' ? 20 : 40;

  // Prefer combat gangs if human expands, tech if human attacks
  const pool = [...state.hirePool].sort((a, b) => {
    const da = gangDefById(a.defId);
    const db = gangDefById(b.defId);
    const score = (d: typeof da) =>
      d.combat * (0.5 + weights.aggression) + d.tech * weights.tech + d.defense * weights.defend;
    return score(db) - score(da);
  });

  for (const entry of pool) {
    const def = gangDefById(entry.defId);
    if (player.cash < def.hireCost + reserve) continue;
    const home = owned[0]!;
    try {
      return hireGang(state, playerId, entry.defId, home.id);
    } catch {
      continue;
    }
  }
  return state;
}

export function aiMaybeGear(state: GameState, playerId: PlayerId): GameState {
  let next = state;
  const player = next.players[playerId];
  if (!player || player.eliminated) return next;

  for (const itemId of player.researchedItemIds) {
    if ((player.inventory[itemId] ?? 0) > 0) continue;
    const msg = fabricateItem(next, playerId, itemId);
    if (msg.startsWith('Need') || msg.startsWith('Not')) continue;
    break;
  }

  for (const [itemId, count] of Object.entries(next.players[playerId]!.inventory)) {
    if (count < 1) continue;
    const gang = livingGangsOf(next, playerId).find((g) => g.equipped.length < 2);
    if (!gang) break;
    equipItem(next, playerId, gang.id, itemId);
  }

  return next;
}

export function recommendOrders(state: GameState, playerId: PlayerId): Order[] {
  return generateAiOrders(state, playerId);
}

export function fillAllAiOrders(state: GameState): GameState {
  let next = state;
  for (const pid of state.playerOrder) {
    if (next.players[pid]?.isHuman) continue;
    if (next.players[pid]?.eliminated) continue;
    aiAcceptJobs(next, pid);
    next = aiMaybeHire(next, pid);
    next = aiMaybeGear(next, pid);
    const orders = generateAiOrders(next, pid);
    next = {
      ...next,
      orders: [...next.orders, ...orders],
    };
  }
  return next;
}
