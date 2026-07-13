import { GANG_DEFS, scenarioById, SITE_DEFS } from '../content';
import { captureSnapshot, emptyStyle } from './debrief';
import { refreshJobBoard } from './jobs';
import { createEmptyMap, sectorId } from './map';
import { createRng, shuffleInPlace } from './rng';
import type { Difficulty, GameState, HirePoolEntry, PlayerId, PlayerState } from './types';
import { resetOrderSeq } from './orders';

const PLAYER_COLORS = [0x2bf0ff, 0xff2bd6, 0xffc14a, 0x7dff6b, 0xc58cff, 0xff6b4a];

function refreshHirePool(seed: number, turn: number, count: number): HirePoolEntry[] {
  const rng = createRng(seed + turn * 1337);
  const ids = shuffleInPlace(
    rng,
    GANG_DEFS.map((g) => g.id),
  );
  return ids.slice(0, count).map((defId) => ({ defId, turnsLeft: 3 }));
}

const DIFFICULTY_AI_CASH: Record<Difficulty, number> = {
  easy: 0.85,
  normal: 1,
  hard: 1.15,
  overlord: 1.3,
};

export function createNewGame(options?: {
  scenarioId?: string;
  seed?: number;
  humanName?: string;
  difficulty?: Difficulty;
}): GameState {
  const scenario = scenarioById(options?.scenarioId ?? 'kill_em_all');
  const seed = options?.seed ?? (Date.now() % 1_000_000);
  const difficulty = options?.difficulty ?? 'normal';
  resetOrderSeq(0);

  const humanId: PlayerId = 'player';
  const players: Record<PlayerId, PlayerState> = {
    [humanId]: {
      id: humanId,
      name: options?.humanName ?? 'You',
      color: PLAYER_COLORS[0]!,
      isHuman: true,
      cash: scenario.startingCash,
      support: 5,
      eliminated: false,
      knownGangDefs: GANG_DEFS.map((g) => g.id),
      researchedItemIds: [],
      researchProgress: null,
      inventory: {},
    },
  };
  const playerOrder: PlayerId[] = [humanId];

  const aiCash = Math.floor(scenario.startingCash * DIFFICULTY_AI_CASH[difficulty]);

  for (let i = 0; i < scenario.aiCount; i++) {
    const id = `ai_${i + 1}`;
    players[id] = {
      id,
      name: i === 0 ? 'Rival Overlord' : `Rival ${i + 1}`,
      color: PLAYER_COLORS[(i + 1) % PLAYER_COLORS.length]!,
      isHuman: false,
      cash: aiCash,
      support: 5,
      eliminated: false,
      knownGangDefs: GANG_DEFS.map((g) => g.id),
      researchedItemIds: [],
      researchProgress: null,
      inventory: {},
    };
    playerOrder.push(id);
  }

  const sectors = createEmptyMap(scenario.mapWidth, scenario.mapHeight, SITE_DEFS, seed);
  const rng = createRng(seed);

  // Corner-ish starts
  const starts: Array<{ pid: PlayerId; x: number; y: number }> = [
    { pid: humanId, x: 1, y: 1 },
  ];
  if (playerOrder[1]) starts.push({ pid: playerOrder[1], x: scenario.mapWidth - 2, y: scenario.mapHeight - 2 });
  if (playerOrder[2]) starts.push({ pid: playerOrder[2], x: scenario.mapWidth - 2, y: 1 });
  if (playerOrder[3]) starts.push({ pid: playerOrder[3], x: 1, y: scenario.mapHeight - 2 });

  const state: GameState = {
    turn: 1,
    mapWidth: scenario.mapWidth,
    mapHeight: scenario.mapHeight,
    sectors,
    players,
    playerOrder,
    gangs: {},
    orders: [],
    hirePool: refreshHirePool(seed, 1, 6),
    scenarioId: scenario.id,
    victory: scenario.victory,
    winnerId: null,
    log: [
      {
        turn: 1,
        kind: 'info',
        message: `${scenario.name}: ${scenario.description}`,
      },
    ],
    cityHeat: 10,
    seed,
    difficulty,
    scoutReveal: {},
    jobBoard: [],
    activeJobs: [],
    eventCooldown: 2,
    lastEventId: null,
    history: [],
    humanStyle: emptyStyle(),
    version: 1,
  };

  refreshJobBoard(state, 3);
  state.history.push(captureSnapshot(state));

  // Place starting sectors + gangs
  const starterDefs = shuffleInPlace(
    rng,
    GANG_DEFS.map((g) => g.id),
  );

  starts.forEach((start, idx) => {
    const sid = sectorId(start.x, start.y);
    const sector = state.sectors[sid]!;
    sector.owner = start.pid;
    for (let g = 0; g < scenario.startingGangs; g++) {
      const defId = starterDefs[(idx + g) % starterDefs.length]!;
      const gid = `gang_${start.pid}_start_${g}`;
      state.gangs[gid] = {
        id: gid,
        defId,
        ownerId: start.pid,
        sectorId: sid,
        hp: 100,
        ordersDone: false,
        equipped: [],
      };
      sector.gangIds.push(gid);
    }
  });

  return state;
}

export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

export function serializeState(state: GameState): string {
  return JSON.stringify(state);
}

export function deserializeState(json: string): GameState {
  return JSON.parse(json) as GameState;
}

export function advanceHirePool(state: GameState): void {
  state.hirePool = refreshHirePool(state.seed, state.turn, 6);
}
