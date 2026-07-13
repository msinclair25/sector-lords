import { describe, expect, it } from 'vitest';
import { createNewGame, previewAttack, resolveCombat, livingGangsOf } from '../../src/engine';

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
});
