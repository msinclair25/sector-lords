import { countSectorsOwned } from './map';
import { livingGangsOf } from './combat';
import type {
  GameState,
  PlayerId,
  StyleProfile,
  TurnLogEntry,
  TurnSnapshot,
} from './types';

export type { StyleProfile, TurnSnapshot };

export interface DebriefReport {
  winnerId: PlayerId | null;
  winnerName: string;
  turnsPlayed: number;
  summary: string;
  reasons: string[];
  timeline: string[];
  finalScores: Array<{
    playerId: PlayerId;
    name: string;
    cash: number;
    sectors: number;
    gangs: number;
    support: number;
  }>;
  playerStyle: string;
}

export function emptyStyle(): StyleProfile {
  return { attacks: 0, claims: 0, unrest: 0, research: 0, influence: 0, scouts: 0 };
}

export function recordStyleFromOrders(
  state: GameState,
  style: StyleProfile,
  playerId: PlayerId,
): void {
  for (const o of state.orders) {
    if (o.playerId !== playerId) continue;
    switch (o.type) {
      case 'attack':
        style.attacks += 1;
        break;
      case 'claim':
        style.claims += 1;
        break;
      case 'unrest':
        style.unrest += 1;
        break;
      case 'research':
        style.research += 1;
        break;
      case 'influence':
        style.influence += 1;
        break;
      case 'scout':
        style.scouts += 1;
        break;
      default:
        break;
    }
  }
}

export function captureSnapshot(state: GameState): TurnSnapshot {
  const cash: Record<string, number> = {};
  const sectors: Record<string, number> = {};
  const gangs: Record<string, number> = {};
  const support: Record<string, number> = {};
  for (const pid of state.playerOrder) {
    const p = state.players[pid];
    if (!p) continue;
    cash[pid] = p.cash;
    sectors[pid] = countSectorsOwned(state.sectors, pid);
    gangs[pid] = livingGangsOf(state, pid).length;
    support[pid] = p.support;
  }
  return {
    turn: state.turn,
    cash,
    sectors,
    gangs,
    support,
    cityHeat: state.cityHeat,
  };
}

function styleLabel(style: StyleProfile): string {
  const entries: Array<[string, number]> = [
    ['warmonger', style.attacks],
    ['expansionist', style.claims],
    ['unrest merchant', style.unrest],
    ['tech baron', style.research],
    ['racketeer', style.influence],
    ['spymaster', style.scouts],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  const top = entries[0]!;
  if (top[1] === 0) return 'cautious operator';
  const second = entries[1]!;
  if (second[1] > 0 && second[1] >= top[1] * 0.7) {
    return `${top[0]} / ${second[0]}`;
  }
  return top[0];
}

function decisiveCombats(log: TurnLogEntry[]): string[] {
  return log
    .filter((e) => e.kind === 'combat' && e.combat)
    .slice(-5)
    .map((e) => e.message);
}

function biggestSwing(history: TurnSnapshot[], humanId: PlayerId): string | null {
  if (history.length < 2) return null;
  let best: { turn: number; delta: number } | null = null;
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1]!;
    const cur = history[i]!;
    const delta = (cur.sectors[humanId] ?? 0) - (prev.sectors[humanId] ?? 0);
    if (!best || Math.abs(delta) > Math.abs(best.delta)) {
      best = { turn: cur.turn, delta };
    }
  }
  if (!best || best.delta === 0) return null;
  if (best.delta > 0) {
    return `Biggest surge: +${best.delta} sectors around turn ${best.turn}.`;
  }
  return `Biggest setback: ${best.delta} sectors around turn ${best.turn}.`;
}

export function buildDebrief(state: GameState, humanId: PlayerId = 'player'): DebriefReport {
  const winnerId = state.winnerId;
  const winnerName = winnerId ? (state.players[winnerId]?.name ?? winnerId) : 'Nobody';
  const humanWon = winnerId === humanId;
  const history = state.history ?? [];
  const style = state.humanStyle ?? emptyStyle();

  const finalScores = state.playerOrder.map((pid) => {
    const p = state.players[pid]!;
    return {
      playerId: pid,
      name: p.name,
      cash: p.cash,
      sectors: countSectorsOwned(state.sectors, pid),
      gangs: livingGangsOf(state, pid).length,
      support: p.support,
    };
  });

  const human = finalScores.find((s) => s.playerId === humanId);
  const rival = finalScores
    .filter((s) => s.playerId !== humanId)
    .sort((a, b) => b.sectors - a.sectors)[0];

  const reasons: string[] = [];
  if (humanWon) {
    reasons.push('You eliminated or outscored every rival under the scenario rules.');
    if (human && rival && human.sectors > rival.sectors + 2) {
      reasons.push(`Territory edge: ${human.sectors} vs ${rival.name}'s ${rival.sectors} sectors.`);
    }
    if (style.attacks >= style.claims) {
      reasons.push('Aggressive pressure kept rivals on the back foot.');
    } else {
      reasons.push('Expansion and economy outpaced pure violence.');
    }
  } else {
    reasons.push(`${winnerName} closed the game before you could recover.`);
    if (human && rival) {
      if (rival.sectors > human.sectors) {
        reasons.push(
          `Sector deficit: you held ${human.sectors}, ${rival.name} held ${rival.sectors}.`,
        );
      }
      if (rival.gangs > human.gangs) {
        reasons.push(`Manpower: ${human.gangs} gangs vs ${rival.gangs}.`);
      }
      if (human.cash < rival.cash * 0.6) {
        reasons.push('Cash drought limited hiring and gear.');
      }
    }
    if (style.unrest > style.influence + style.research) {
      reasons.push('Heavy unrest play may have fed police heat without enough sites.');
    }
    if (style.attacks < 2 && (history[history.length - 1]?.turn ?? 0) > 8) {
      reasons.push('Low attack count — rivals were free to expand.');
    }
  }

  const swing = biggestSwing(history, humanId);
  if (swing) reasons.push(swing);

  const policeHits = state.log.filter((l) => l.kind === 'police').length;
  if (policeHits >= 2) {
    reasons.push(`Police cracked down ${policeHits} times — heat management mattered.`);
  }

  const timeline: string[] = [];
  for (const snap of history
    .filter((_, i) => i % 3 === 0 || i === history.length - 1)
    .slice(-8)) {
    const parts = state.playerOrder.map((pid) => {
      const name = state.players[pid]?.name ?? pid;
      return `${name}:${snap.sectors[pid] ?? 0}s/$${snap.cash[pid] ?? 0}`;
    });
    timeline.push(`T${snap.turn} heat${snap.cityHeat} · ${parts.join(' · ')}`);
  }
  for (const c of decisiveCombats(state.log)) {
    timeline.push(c);
  }

  const turnsPlayed = history.length > 0 ? history[history.length - 1]!.turn : state.turn;

  return {
    winnerId,
    winnerName,
    turnsPlayed,
    summary: humanWon
      ? `Victory! You took the city in ${turnsPlayed} turns as a ${styleLabel(style)}.`
      : `Defeat. ${winnerName} won after ${turnsPlayed} turns. You played as a ${styleLabel(style)}.`,
    reasons,
    timeline,
    finalScores,
    playerStyle: styleLabel(style),
  };
}

/** Adaptive weights derived from human style. */
export function adaptiveWeights(style: StyleProfile): {
  aggression: number;
  expand: number;
  tech: number;
  unrest: number;
  defend: number;
} {
  const total =
    style.attacks +
    style.claims +
    style.unrest +
    style.research +
    style.influence +
    style.scouts +
    1;
  const attackShare = style.attacks / total;
  const claimShare = style.claims / total;
  const unrestShare = style.unrest / total;
  const techShare = style.research / total;

  return {
    aggression: 0.35 + claimShare * 0.4 + (1 - attackShare) * 0.15,
    expand: 0.4 + (1 - claimShare) * 0.25,
    tech: 0.25 + attackShare * 0.35 + techShare * 0.1,
    unrest: 0.2 + (unrestShare < 0.2 ? 0.15 : 0),
    defend: 0.2 + attackShare * 0.45,
  };
}
