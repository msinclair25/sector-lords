import { gangDefById } from '../content';
import type { GameState, PlayerId, SectorId } from '../engine';

export type ActionFxKind =
  | 'move'
  | 'claim'
  | 'attack'
  | 'scout'
  | 'unrest'
  | 'influence'
  | 'research'
  | 'defend';

export interface TurnActionFx {
  type: ActionFxKind;
  from: SectorId;
  to: SectorId;
  playerId: PlayerId;
  gangId: string;
  isHuman: boolean;
  gangName: string;
  playerName: string;
}

const TYPE_ORDER: Record<string, number> = {
  scout: 0,
  move: 1,
  claim: 2,
  attack: 3,
  influence: 4,
  research: 5,
  unrest: 6,
  defend: 7,
};

/** Build a playable FX list from queued orders (pre-resolve positions). */
export function buildTurnActionFx(state: GameState): TurnActionFx[] {
  const out: TurnActionFx[] = [];
  for (const o of state.orders) {
    const gang = state.gangs[o.gangId];
    if (!gang) continue;
    const type = o.type as ActionFxKind;
    if (!(type in TYPE_ORDER)) continue;
    // Skip pure defend (no visual travel)
    if (type === 'defend') continue;
    const to = o.targetSectorId ?? gang.sectorId;
    const def = gangDefById(gang.defId);
    out.push({
      type,
      from: gang.sectorId,
      to,
      playerId: o.playerId,
      gangId: o.gangId,
      isHuman: !!state.players[o.playerId]?.isHuman,
      gangName: def.name,
      playerName: state.players[o.playerId]?.name ?? 'Rival',
    });
  }
  out.sort((a, b) => {
    const ta = TYPE_ORDER[a.type] ?? 99;
    const tb = TYPE_ORDER[b.type] ?? 99;
    if (ta !== tb) return ta - tb;
    // Humans first within same type for readability
    if (a.isHuman !== b.isHuman) return a.isHuman ? -1 : 1;
    return a.gangName.localeCompare(b.gangName);
  });
  return out;
}

export function describeActionFx(a: TurnActionFx): string {
  const who = a.isHuman ? a.gangName : `${a.playerName} · ${a.gangName}`;
  switch (a.type) {
    case 'move':
      return `${who} moves ${a.from} → ${a.to}`;
    case 'claim':
      return `${who} claims ${a.to}`;
    case 'attack':
      return `${who} attacks ${a.to}`;
    case 'scout':
      return `${who} scouts ${a.to}`;
    case 'unrest':
      return `${who} stirs unrest in ${a.from}`;
    case 'influence':
      return `${who} influences a site in ${a.from}`;
    case 'research':
      return `${who} researches`;
    default:
      return `${who}: ${a.type}`;
  }
}
