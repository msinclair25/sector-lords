import { describe, expect, it } from 'vitest';
import {
  createNewGame,
  estimateWinChance,
  previewAttack,
  resolveCombat,
  livingGangsOf,
} from '../../src/engine';

describe('combat', () => {
  it('estimates win chance between 5% and 95%', () => {
    const state = createNewGame({ seed: 42, scenarioId: 'kill_em_all' });
    const human = 'player';
    const gang = livingGangsOf(state, human)[0]!;
    // Attack AI home if adjacent path exists — pick any enemy sector with owner
    const enemySector = Object.values(state.sectors).find(
      (s) => s.owner && s.owner !== human,
    )!;
    // Manually place gang adjacent for preview by using enemy sector power
    const prev = previewAttack(state, [gang.id], enemySector.id, human);
    expect(prev.winChance).toBeGreaterThanOrEqual(0.05);
    expect(prev.winChance).toBeLessThanOrEqual(0.95);
  });

  it('rewards big power edges without guaranteeing wins', () => {
    const even = estimateWinChance(10, 10);
    expect(even).toBeGreaterThan(0.45);
    expect(even).toBeLessThan(0.55);

    // Classic salt case: ~18 vs 5 should feel like a strong favorite (~80%+), not ~70%
    const blowout = estimateWinChance(18, 5);
    expect(blowout).toBeGreaterThanOrEqual(0.78);
    expect(blowout).toBeLessThanOrEqual(0.95);

    const twoToOne = estimateWinChance(20, 10);
    expect(twoToOne).toBeGreaterThan(even);
    expect(twoToOne).toBeGreaterThanOrEqual(0.68);
  });

  it('resolveCombat mutates sector ownership on win with overwhelming force', () => {
    const state = createNewGame({ seed: 7, scenarioId: 'kill_em_all' });
    const human = 'player';
    const gang = livingGangsOf(state, human)[0]!;
    // Buff gang
    gang.hp = 100;
    // Resolve into AI sector after wiping defenders
    const aiSector = Object.values(state.sectors).find((s) => s.owner && s.owner !== human)!;
    // Clear defenders
    for (const id of [...aiSector.gangIds]) {
      delete state.gangs[id];
    }
    aiSector.gangIds = [];

    // Force win via high power / seed
    const result = resolveCombat(state, aiSector.id, human, [gang.id], () => 0.01);
    expect(result.attackerWon).toBe(true);
    expect(state.sectors[aiSector.id]!.owner).toBe(human);
  });

  it('failed assault keeps survivors on the block and records origin sectors', () => {
    const state = createNewGame({ seed: 11, scenarioId: 'kill_em_all' });
    const human = 'player';
    const gang = livingGangsOf(state, human)[0]!;
    const originId = gang.sectorId;
    const aiSector = Object.values(state.sectors).find((s) => s.owner && s.owner !== human)!;
    // Ensure there is something to fight so a miss is meaningful
    if (aiSector.gangIds.length === 0) {
      // leave empty — still valid combat target
    }

    const result = resolveCombat(state, aiSector.id, human, [gang.id], () => 0.99);
    expect(result.attackerWon).toBe(false);
    expect(result.attackerOriginSectorIds).toContain(originId);
    expect(result.summary.toLowerCase()).toMatch(/no retreat|stay on the block/);
    // Hard rule: survivors stay on the contested tile (no bounce-back)
    if (state.gangs[gang.id]) {
      expect(state.gangs[gang.id]!.sectorId).toBe(aiSector.id);
    }
  });
});
