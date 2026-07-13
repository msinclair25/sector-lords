import { countSectorsOwned } from './map';
import { livingGangsOf } from './combat';
import type { GameState, PlayerId } from './types';

export function markEliminations(state: GameState): void {
  for (const pid of state.playerOrder) {
    const p = state.players[pid];
    if (!p || p.eliminated) continue;
    const gangs = livingGangsOf(state, pid);
    const sectors = countSectorsOwned(state.sectors, pid);
    if (gangs.length === 0 && sectors === 0) {
      p.eliminated = true;
      state.log.push({
        turn: state.turn,
        kind: 'info',
        message: `${p.name} has been wiped off the map.`,
      });
    }
  }
}

export function checkVictory(state: GameState): PlayerId | null {
  const alive = state.playerOrder.filter((pid) => !state.players[pid]?.eliminated);

  if (state.victory.type === 'elimination') {
    if (alive.length === 1) return alive[0]!;
    if (alive.length === 0) return null;
    return null;
  }

  const turnLimit =
    state.victory.type === 'most_sectors' ||
    state.victory.type === 'most_cash' ||
    state.victory.type === 'combined'
      ? state.victory.turns
      : null;

  if (turnLimit !== null && state.turn >= turnLimit) {
    return pickLeader(state, state.victory.type);
  }

  // Also allow early elimination win on timed modes if only one left
  if (alive.length === 1) return alive[0]!;

  return null;
}

function pickLeader(
  state: GameState,
  mode: 'most_sectors' | 'most_cash' | 'combined',
): PlayerId | null {
  let best: PlayerId | null = null;
  let bestScore = -Infinity;
  for (const pid of state.playerOrder) {
    const p = state.players[pid];
    if (!p || p.eliminated) continue;
    const sectors = countSectorsOwned(state.sectors, pid);
    let score = 0;
    if (mode === 'most_sectors') score = sectors;
    else if (mode === 'most_cash') score = p.cash;
    else score = sectors * 50 + p.cash + p.support * 10;
    if (score > bestScore) {
      bestScore = score;
      best = pid;
    }
  }
  return best;
}

export function pathsToVictory(state: GameState): {
  label: string;
  scores: Array<{ playerId: PlayerId; name: string; value: number; unit: string }>;
} {
  const scores = state.playerOrder.map((pid) => {
    const p = state.players[pid]!;
    const sectors = countSectorsOwned(state.sectors, pid);
    if (state.victory.type === 'most_cash') {
      return { playerId: pid, name: p.name, value: p.cash, unit: 'cash' };
    }
    if (state.victory.type === 'combined') {
      return {
        playerId: pid,
        name: p.name,
        value: sectors * 50 + p.cash + p.support * 10,
        unit: 'score',
      };
    }
    // elimination + most_sectors: show sectors
    return { playerId: pid, name: p.name, value: sectors, unit: 'sectors' };
  });

  const label =
    state.victory.type === 'elimination'
      ? 'Eliminate all rivals'
      : state.victory.type === 'most_sectors'
        ? `Most sectors by turn ${state.victory.turns}`
        : state.victory.type === 'most_cash'
          ? `Most cash by turn ${state.victory.turns}`
          : `Highest combined score by turn ${state.victory.turns}`;

  return { label, scores };
}
