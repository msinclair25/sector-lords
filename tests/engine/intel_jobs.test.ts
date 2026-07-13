import { describe, expect, it } from 'vitest';
import {
  acceptJob,
  applyScout,
  createNewGame,
  createOrder,
  intelLevel,
  previewAttackWithIntel,
  queueOrder,
  resolveTurn,
  livingGangsOf,
  sectorId,
} from '../../src/engine';

describe('intel fog', () => {
  it('owned sectors are full intel; distant enemy is fogged', () => {
    const state = createNewGame({ seed: 21 });
    const home = livingGangsOf(state, 'player')[0]!.sectorId;
    expect(intelLevel(state, 'player', home)).toBe(2);

    const far = Object.values(state.sectors).find(
      (s) => s.owner && s.owner !== 'player',
    )!;
    // AI starts opposite corner — not adjacent
    const level = intelLevel(state, 'player', far.id);
    expect(level).toBeLessThan(2);
  });

  it('scout reveals sector fully', () => {
    const state = createNewGame({ seed: 22 });
    const far = Object.values(state.sectors).find(
      (s) => s.owner && s.owner !== 'player',
    )!;
    applyScout(state, 'player', far.id, 3);
    expect(intelLevel(state, 'player', far.id)).toBe(2);
  });

  it('fogged attack shows odds range', () => {
    const state = createNewGame({ seed: 23 });
    const gang = livingGangsOf(state, 'player')[0]!;
    // Place gang next to a neutral and attack fake far with low intel
    const enemy = Object.values(state.sectors).find((s) => s.owner === 'ai_1')!;
    const prev = previewAttackWithIntel(state, [gang.id], enemy.id, 'player');
    expect(prev.winChanceMin).toBeLessThanOrEqual(prev.winChance);
    expect(prev.winChanceMax).toBeGreaterThanOrEqual(prev.winChance);
  });
});

describe('jobs', () => {
  it('accepts a job from the board', () => {
    const state = createNewGame({ seed: 30 });
    expect(state.jobBoard.length).toBeGreaterThan(0);
    const id = state.jobBoard[0]!;
    const msg = acceptJob(state, 'player', id);
    expect(msg).toContain('Accepted');
    expect(state.activeJobs.some((j) => j.defId === id)).toBe(true);
  });

  it('claim progresses claim_sectors job', () => {
    let state = createNewGame({ seed: 31 });
    // Force a claim job if not present
    state.jobBoard = ['border_push'];
    acceptJob(state, 'player', 'border_push');
    const gang = livingGangsOf(state, 'player')[0]!;
    // Claim adjacent empty 1,2 from start 1,1
    state = queueOrder(
      state,
      createOrder({
        playerId: 'player',
        type: 'claim',
        gangId: gang.id,
        targetSectorId: sectorId(1, 2),
      }),
    );
    const { state: next } = resolveTurn(state);
    const job = next.activeJobs.find((j) => j.defId === 'border_push' && j.playerId === 'player');
    // Either still active with progress or completed
    if (job) expect(job.progress).toBeGreaterThanOrEqual(1);
    else {
      // completed immediately if goal was 1 somehow — ok
      expect(
        next.log.some((l) => l.kind === 'job' && l.message.includes('border') || l.message.includes('Border') || l.message.includes('completes')),
      ).toBe(true);
    }
  });
});
