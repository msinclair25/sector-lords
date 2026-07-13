import { gangDefById, itemDefById, itemIconUrl, siteDefById } from '../content';
import { equipmentBonuses } from './research';
import type {
  CombatFightStyle,
  CombatResult,
  GameState,
  GangInstance,
  PlayerId,
  SectorId,
} from './types';
import { createRng } from './rng';

/** Infer arena animation style from equipped gear + gang tags. */
export function fightStyleFor(
  state: GameState,
  gangIds: string[],
): CombatFightStyle {
  let melee = 0;
  let ranged = 0;
  let tech = 0;
  for (const id of gangIds) {
    const g = state.gangs[id];
    if (!g || g.hp <= 0) continue;
    const def = gangDefById(g.defId);
    for (const tag of def.tags) {
      const t = tag.toLowerCase();
      if (t.includes('gun') || t.includes('sniper') || t.includes('range')) ranged += 1;
      if (t.includes('blade') || t.includes('brawl') || t.includes('melee')) melee += 1;
      if (t.includes('hack') || t.includes('tech') || t.includes('chrome')) tech += 1;
    }
    for (const eq of g.equipped ?? []) {
      try {
        const item = itemDefById(eq);
        if (item.type === 'melee') melee += 2;
        else if (item.type === 'ranged') ranged += 2;
        else if (item.type === 'armor') melee += 0.5;
        else if (item.type === 'misc') {
          if (item.tags.some((x) => /emp|hack|drone|propaganda/i.test(x))) tech += 2;
          else tech += 1;
        }
      } catch {
        /* ignore unknown */
      }
    }
  }
  if (melee === 0 && ranged === 0 && tech === 0) return 'melee';
  const top = Math.max(melee, ranged, tech);
  const contenders = [
    melee >= top * 0.85 ? 1 : 0,
    ranged >= top * 0.85 ? 1 : 0,
    tech >= top * 0.85 ? 1 : 0,
  ].reduce((a, b) => a + b, 0);
  if (contenders >= 2) return 'hybrid';
  if (ranged === top) return 'ranged';
  if (tech === top) return 'tech';
  return 'melee';
}

function gearIconsFor(state: GameState, gangIds: string[]): string[] {
  const icons: string[] = [];
  for (const id of gangIds) {
    const g = state.gangs[id];
    if (!g) continue;
    for (const eq of g.equipped ?? []) {
      try {
        icons.push(itemIconUrl(itemDefById(eq)));
      } catch {
        /* skip */
      }
      if (icons.length >= 3) return icons;
    }
  }
  return icons;
}

function strikeLabelsFor(
  atk: CombatFightStyle,
  def: CombatFightStyle,
): string[] {
  const atkSet: Record<CombatFightStyle, string[]> = {
    melee: ['SLASH', 'HOOK', 'CROSSCUT', 'HEAVY', 'CLASH'],
    ranged: ['SUPPRESS', 'BURST', 'VOLLEY', 'PIERCE', 'EXECUTE'],
    tech: ['SPIKE', 'JAM', 'OVERLOAD', 'CASCADE', 'BLACKOUT'],
    hybrid: ['BREACH', 'STRAFE', 'EMP', 'CROSSFIRE', 'FINISH'],
  };
  const defSet: Record<CombatFightStyle, string[]> = {
    melee: ['PARRY', 'COUNTER', 'GUARD', 'REVERSAL', 'CLASH'],
    ranged: ['RETURN FIRE', 'SUPPRESS', 'COVER', 'SNAP SHOT', 'FINISH'],
    tech: ['FIREWALL', 'SCRAMBLE', 'DUMP', 'LOOP', 'BLACKOUT'],
    hybrid: ['HACK', 'SLUG', 'SHIELD', 'BREACH', 'CLASH'],
  };
  const a = atkSet[atk];
  const d = defSet[def];
  // Alternating flavor: ATK, DEF, both, ATK, finale
  return [a[0]!, d[1]!, a[2]!, a[3]!, a[4]!];
}

export function stackPower(
  state: GameState,
  gangIds: string[],
  mode: 'combat' | 'defense',
  enemyGangIds: string[] = [],
): number {
  let total = 0;
  const enemyTags = new Set<string>();
  for (const id of enemyGangIds) {
    for (const t of equipmentBonuses(state, id).tags) enemyTags.add(t);
  }

  for (const id of gangIds) {
    const g = state.gangs[id];
    if (!g || g.hp <= 0) continue;
    const def = gangDefById(g.defId);
    const eq = equipmentBonuses(state, id);
    const base = mode === 'combat' ? def.combat + eq.combat : def.defense + eq.defense;
    const hpFactor = g.hp / 100;
    let bonus = 0;

    // EMP reduces high-tech enemy gear contribution (applied as bonus when we have EMP vs tech enemies)
    if (mode === 'combat' && eq.tags.includes('emp')) {
      for (const eid of enemyGangIds) {
        const edef = state.gangs[eid] ? gangDefById(state.gangs[eid]!.defId) : null;
        if (edef && edef.tech >= 4) bonus += 1.5;
      }
    }
    if (mode === 'combat' && eq.tags.includes('anti_armor')) {
      for (const eid of enemyGangIds) {
        const eeq = equipmentBonuses(state, eid);
        if (eeq.defense >= 2) bonus += 1.5;
      }
    }
    // Enemy EMP softens our power slightly if we are high tech
    if (enemyTags.has('emp') && def.tech >= 4) {
      bonus -= 1;
    }

    total += Math.max(0.5, (base + bonus) * hpFactor);
  }
  return total;
}

export function siteCombatBonus(state: GameState, sectorId: SectorId, ownerId: PlayerId): number {
  const sector = state.sectors[sectorId];
  if (!sector) return 0;
  let bonus = 0;
  for (const site of sector.sites) {
    if (site.influencer === ownerId) {
      bonus += siteDefById(site.defId).combatBonus;
    }
  }
  return bonus;
}

export function estimateWinChance(attackerPower: number, defenderPower: number): number {
  if (attackerPower <= 0 && defenderPower <= 0) return 0.5;
  if (defenderPower <= 0) return 0.95;
  if (attackerPower <= 0) return 0.05;
  const ratio = attackerPower / (attackerPower + defenderPower);
  return Math.min(0.95, Math.max(0.05, 0.15 + ratio * 0.7));
}

export function previewAttack(
  state: GameState,
  attackerGangIds: string[],
  sectorId: SectorId,
  attackerId: PlayerId,
): { attackerPower: number; defenderPower: number; winChance: number; defenderId: PlayerId | null } {
  const sector = state.sectors[sectorId]!;
  const defenders = sector.gangIds.filter((id) => state.gangs[id]?.ownerId !== attackerId);
  const defenderId = defenders.length
    ? state.gangs[defenders[0]!]!.ownerId
    : sector.owner !== attackerId
      ? sector.owner
      : null;

  let attackerPower = stackPower(state, attackerGangIds, 'combat', defenders);
  for (const id of attackerGangIds) {
    const g = state.gangs[id];
    if (!g) continue;
    const def = gangDefById(g.defId);
    if (def.id === 'neon_jackals') attackerPower += 2 * (g.hp / 100);
    if (def.id === 'void_contractors' && defenders.length > 0) attackerPower += 1 * (g.hp / 100);
    if (def.id === 'razor_ballet' && g.hp > 70) attackerPower += 1 * (g.hp / 100);
  }
  attackerPower += siteCombatBonus(state, sectorId, attackerId) * 0.5;

  let defenderPower = stackPower(state, defenders, 'defense', attackerGangIds);
  if (defenderId) {
    defenderPower += siteCombatBonus(state, sectorId, defenderId);
    // Glass Pilots overwatch: adjacent allied glass pilots buff defense
    defenderPower += glassPilotsOverwatch(state, sectorId, defenderId);
  }
  if (defenders.length === 0 && sector.owner && sector.owner !== attackerId) {
    defenderPower += 2; // empty sector militia slightly stronger
  }

  return {
    attackerPower,
    defenderPower,
    winChance: estimateWinChance(attackerPower, defenderPower),
    defenderId,
  };
}

function applyLosses(
  state: GameState,
  gangIds: string[],
  lossFraction: number,
): { destroyed: string[]; remainingHpLoss: number } {
  const destroyed: string[] = [];
  let totalLoss = 0;
  for (const id of gangIds) {
    const g = state.gangs[id];
    if (!g) continue;
    const eq = equipmentBonuses(state, id);
    const armorMitigation = Math.min(15, eq.defense * 3);
    let dmg = Math.round(20 + lossFraction * 50 + (1 - g.hp / 100) * 10 - armorMitigation);
    dmg = Math.max(5, dmg);

    // Iron Nuns: ignore first lethal blow once per fight if HP would hit 0 with remaining pad
    const def = gangDefById(g.defId);
    if (def.id === 'iron_nuns' && g.hp - dmg <= 0 && g.hp > 15) {
      dmg = g.hp - 10;
    }

    g.hp = Math.max(0, g.hp - dmg);
    totalLoss += dmg;
    if (g.hp <= 0) destroyed.push(id);
  }
  return { destroyed, remainingHpLoss: totalLoss };
}

function removeDestroyed(state: GameState, ids: string[]): void {
  for (const id of ids) {
    const g = state.gangs[id];
    if (!g) continue;
    // Return equipment to owner inventory
    const player = state.players[g.ownerId];
    if (player) {
      for (const itemId of g.equipped) {
        player.inventory[itemId] = (player.inventory[itemId] ?? 0) + 1;
      }
    }
    const sector = state.sectors[g.sectorId];
    if (sector) {
      sector.gangIds = sector.gangIds.filter((x) => x !== id);
    }
    delete state.gangs[id];
  }
}

export function resolveCombat(
  state: GameState,
  sectorId: SectorId,
  attackerId: PlayerId,
  attackerGangIds: string[],
  rng: () => number = createRng(state.seed + state.turn * 997 + sectorId.length),
): CombatResult {
  const preview = previewAttack(state, attackerGangIds, sectorId, attackerId);
  const roll = rng();
  const attackerWon = roll < preview.winChance;

  const sector = state.sectors[sectorId]!;
  const defenderIds = sector.gangIds.filter((id) => state.gangs[id]?.ownerId !== attackerId);

  // Capture presentation data before gangs are destroyed / moved
  const portraitOf = (gid: string): string | undefined => {
    const g = state.gangs[gid];
    if (!g) return undefined;
    const p = gangDefById(g.defId).art.portrait;
    return p ? (p.startsWith('/') ? p : `/${p}`) : undefined;
  };
  const nameOf = (gid: string): string => {
    const g = state.gangs[gid];
    return g ? gangDefById(g.defId).name : 'Unknown';
  };
  const attackerNames = attackerGangIds.map(nameOf);
  const defenderNames = defenderIds.map(nameOf);
  const attackerPortrait = attackerGangIds.map(portraitOf).find(Boolean);
  const defenderPortrait = defenderIds.map(portraitOf).find(Boolean);
  const attackerPlayerName = state.players[attackerId]?.name ?? 'Attacker';
  const defenderPlayerName = preview.defenderId
    ? (state.players[preview.defenderId]?.name ?? 'Defender')
    : 'Empty block';
  const attackerStyle = fightStyleFor(state, attackerGangIds);
  const defenderStyle =
    defenderIds.length > 0 ? fightStyleFor(state, defenderIds) : 'melee';
  const attackerGearIcons = gearIconsFor(state, attackerGangIds);
  const defenderGearIcons = gearIconsFor(state, defenderIds);
  const strikeLabels = strikeLabelsFor(attackerStyle, defenderStyle);

  for (const id of attackerGangIds) {
    const g = state.gangs[id];
    if (!g) continue;
    const from = state.sectors[g.sectorId];
    if (from) from.gangIds = from.gangIds.filter((x) => x !== id);
    g.sectorId = sectorId;
    if (!sector.gangIds.includes(id)) sector.gangIds.push(id);
  }

  let attackerLosses = 0;
  let defenderLosses = 0;
  const destroyed: string[] = [];

  if (attackerWon) {
    const defLoss = applyLosses(state, defenderIds, 0.7 + (1 - preview.winChance) * 0.3);
    const atkLoss = applyLosses(state, attackerGangIds, 0.25 * (1 - preview.winChance + 0.2));
    attackerLosses = atkLoss.remainingHpLoss;
    defenderLosses = defLoss.remainingHpLoss;
    destroyed.push(...defLoss.destroyed, ...atkLoss.destroyed);
    removeDestroyed(state, destroyed);

    const remainingDef = sector.gangIds.some(
      (id) => state.gangs[id] && state.gangs[id]!.ownerId !== attackerId,
    );
    if (!remainingDef) {
      sector.owner = attackerId;
    }
  } else {
    const atkLoss = applyLosses(state, attackerGangIds, 0.7 + preview.winChance * 0.2);
    const defLoss = applyLosses(state, defenderIds, 0.25 * preview.winChance + 0.15);
    attackerLosses = atkLoss.remainingHpLoss;
    defenderLosses = defLoss.remainingHpLoss;
    destroyed.push(...defLoss.destroyed, ...atkLoss.destroyed);
    removeDestroyed(state, destroyed);
  }

  // Scrap Angels salvage when they hold the sector after the fight
  for (const g of Object.values(state.gangs)) {
    if (g.defId !== 'scrap_angels' || g.sectorId !== sectorId || g.hp <= 0) continue;
    if (sector.owner === g.ownerId) {
      state.players[g.ownerId]!.cash += 8;
    }
  }

  const summary = attackerWon
    ? `${state.players[attackerId]?.name ?? 'Attacker'} seizes ${sectorId} (roll ${(roll * 100).toFixed(0)}% < ${(preview.winChance * 100).toFixed(0)}%).`
    : `${state.players[attackerId]?.name ?? 'Attacker'} fails to take ${sectorId} (roll ${(roll * 100).toFixed(0)}% ≥ ${(preview.winChance * 100).toFixed(0)}%).`;

  return {
    sectorId,
    attackerId,
    defenderId: preview.defenderId,
    attackerPower: preview.attackerPower,
    defenderPower: preview.defenderPower,
    attackerWinChance: preview.winChance,
    attackerWon,
    attackerLosses,
    defenderLosses,
    summary,
    destroyedGangIds: destroyed,
    roll,
    attackerNames,
    defenderNames,
    attackerPortrait,
    defenderPortrait,
    attackerPlayerName,
    defenderPlayerName,
    attackerStyle,
    defenderStyle,
    attackerGearIcons,
    defenderGearIcons,
    strikeLabels,
  };
}

export function livingGangsOf(state: GameState, playerId: PlayerId): GangInstance[] {
  return Object.values(state.gangs).filter((g) => g.ownerId === playerId && g.hp > 0);
}

function glassPilotsOverwatch(
  state: GameState,
  sectorId: SectorId,
  ownerId: PlayerId,
): number {
  const { x, y } = (() => {
    const [xs, ys] = sectorId.split(',');
    return { x: Number(xs), y: Number(ys) };
  })();
  let bonus = 0;
  for (const g of Object.values(state.gangs)) {
    if (g.ownerId !== ownerId || g.defId !== 'glass_pilots' || g.hp <= 0) continue;
    const [gx, gy] = g.sectorId.split(',').map(Number);
    if (Math.abs((gx ?? 0) - x) + Math.abs((gy ?? 0) - y) === 1) bonus += 1;
  }
  return bonus;
}
