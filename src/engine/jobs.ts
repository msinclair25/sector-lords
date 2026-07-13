import { JOB_DEFS, jobDefById } from '../content';
import { countSectorsOwned } from './map';
import { createRng, shuffleInPlace } from './rng';
import type { ActiveJob, GameState, PlayerId } from './types';

export function refreshJobBoard(state: GameState, count = 3): void {
  const rng = createRng(state.seed + state.turn * 911 + 3);
  const ids = shuffleInPlace(
    rng,
    JOB_DEFS.map((j) => j.id),
  );
  // Avoid duplicating active job defs for human-visible board
  const activeDefs = new Set(state.activeJobs.map((j) => j.defId));
  state.jobBoard = ids.filter((id) => !activeDefs.has(id)).slice(0, count);
}

export function acceptJob(state: GameState, playerId: PlayerId, defId: string): string {
  const player = state.players[playerId];
  if (!player || player.eliminated) return 'Invalid player.';
  if (!state.jobBoard.includes(defId)) return 'Job not on the board.';
  if (state.activeJobs.some((j) => j.playerId === playerId && j.defId === defId)) {
    return 'Already accepted.';
  }
  // Max 2 active jobs per player
  const mine = state.activeJobs.filter((j) => j.playerId === playerId);
  if (mine.length >= 2) return 'Already tracking 2 jobs.';

  const def = jobDefById(defId);
  const job: ActiveJob = {
    defId,
    playerId,
    progress: 0,
    expiresTurn: state.turn + def.timeLimit,
    counters: {},
  };

  // Snapshot progress for static goals
  if (def.goalType === 'own_sectors') {
    job.progress = countSectorsOwned(state.sectors, playerId);
  }
  if (def.goalType === 'influence_site') {
    job.progress = countInfluencedSites(state, playerId, def.goalTarget);
  }

  state.activeJobs.push(job);
  state.jobBoard = state.jobBoard.filter((id) => id !== defId);
  return `Accepted job: ${def.name}.`;
}

function countInfluencedSites(state: GameState, playerId: PlayerId, siteDefId: string): number {
  let n = 0;
  for (const sector of Object.values(state.sectors)) {
    for (const site of sector.sites) {
      if (site.influencer === playerId && site.defId === siteDefId) n++;
    }
  }
  return n;
}

/** Call after actions that might progress jobs. */
export function noteJobAction(
  state: GameState,
  playerId: PlayerId,
  action:
    | { type: 'claim' }
    | { type: 'unrest' }
    | { type: 'win_attack' }
    | { type: 'influence'; siteDefId: string }
    | { type: 'research_complete' },
): string[] {
  const messages: string[] = [];
  for (const job of state.activeJobs) {
    if (job.playerId !== playerId) continue;
    const def = jobDefById(job.defId);

    if (action.type === 'claim' && def.goalType === 'claim_sectors') {
      job.progress += 1;
    }
    if (action.type === 'unrest' && def.goalType === 'unrest_actions') {
      job.progress += 1;
    }
    if (action.type === 'win_attack' && def.goalType === 'win_attacks') {
      job.progress += 1;
    }
    if (action.type === 'research_complete' && def.goalType === 'research_complete') {
      job.progress += 1;
    }
    if (action.type === 'influence' && def.goalType === 'influence_site') {
      if (!def.goalTarget || action.siteDefId === def.goalTarget) {
        job.progress = countInfluencedSites(state, playerId, def.goalTarget || action.siteDefId);
      }
    }
    if (def.goalType === 'own_sectors') {
      job.progress = countSectorsOwned(state.sectors, playerId);
    }
  }
  messages.push(...settleJobs(state));
  return messages;
}

export function tickJobs(state: GameState): string[] {
  // Refresh static counters
  for (const job of state.activeJobs) {
    const def = jobDefById(job.defId);
    if (def.goalType === 'own_sectors') {
      job.progress = countSectorsOwned(state.sectors, job.playerId);
    }
    if (def.goalType === 'influence_site') {
      job.progress = countInfluencedSites(state, job.playerId, def.goalTarget);
    }
  }
  const msgs = settleJobs(state);

  // Expire
  const kept: ActiveJob[] = [];
  for (const job of state.activeJobs) {
    if (job.expiresTurn < state.turn) {
      const def = jobDefById(job.defId);
      const p = state.players[job.playerId];
      msgs.push(`${p?.name ?? job.playerId} failed job: ${def.name} (expired).`);
    } else {
      kept.push(job);
    }
  }
  state.activeJobs = kept;

  // Refresh board every 3 turns
  if (state.turn % 3 === 1) {
    refreshJobBoard(state);
  }

  return msgs;
}

function settleJobs(state: GameState): string[] {
  const messages: string[] = [];
  const remaining: ActiveJob[] = [];
  for (const job of state.activeJobs) {
    const def = jobDefById(job.defId);
    if (job.progress >= def.goalCount) {
      const p = state.players[job.playerId];
      if (p) {
        p.cash += def.rewardCash;
        p.support += def.rewardSupport;
        messages.push(
          `${p.name} completes job "${def.name}"! +$${def.rewardCash}` +
            (def.rewardSupport ? ` +${def.rewardSupport} support` : ''),
        );
      }
    } else {
      remaining.push(job);
    }
  }
  state.activeJobs = remaining;
  return messages;
}

/** AI auto-accepts first job if under cap. */
export function aiAcceptJobs(state: GameState, playerId: PlayerId): void {
  const mine = state.activeJobs.filter((j) => j.playerId === playerId);
  if (mine.length >= 1) return;
  const offer = state.jobBoard[0];
  if (offer) acceptJob(state, playerId, offer);
}
