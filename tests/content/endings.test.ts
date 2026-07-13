import { describe, expect, it } from 'vitest';
import { allEndingCards, pickEndingCard } from '../../src/content/endings';
import type { DebriefReport } from '../../src/engine';

function fakeDebrief(partial: Partial<DebriefReport> & { winnerId: string | null }): DebriefReport {
  return {
    winnerName: partial.winnerName ?? 'Test',
    turnsPlayed: partial.turnsPlayed ?? 12,
    summary: partial.summary ?? 'test summary',
    reasons: partial.reasons ?? ['reason'],
    timeline: [],
    finalScores: [],
    playerStyle: partial.playerStyle ?? 'warmonger',
    winnerId: partial.winnerId,
  };
}

describe('ending cards', () => {
  it('returns a win card when human wins', () => {
    const card = pickEndingCard(fakeDebrief({ winnerId: 'player' }), 'player');
    expect(card.outcome).toBe('win');
    expect(card.headline.length).toBeGreaterThan(3);
    expect(card.thankYou.length).toBeGreaterThan(10);
  });

  it('returns a lose card when human loses', () => {
    const card = pickEndingCard(
      fakeDebrief({ winnerId: 'ai1', winnerName: 'Rival Overlord' }),
      'player',
    );
    expect(card.outcome).toBe('lose');
  });

  it('pool has both outcomes and varied tones', () => {
    const all = allEndingCards();
    expect(all.some((c) => c.outcome === 'win')).toBe(true);
    expect(all.some((c) => c.outcome === 'lose')).toBe(true);
    const tones = new Set(all.map((c) => c.tone));
    expect(tones.size).toBeGreaterThanOrEqual(4);
  });
});
