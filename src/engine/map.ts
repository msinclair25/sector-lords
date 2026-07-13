import type { LandmarkState, SectorId, SectorState, SiteDef, SiteState } from './types';
import { createRng, pickRandom, shuffleInPlace } from './rng';

export function sectorId(x: number, y: number): SectorId {
  return `${x},${y}`;
}

export function parseSectorId(id: SectorId): { x: number; y: number } {
  const [xs, ys] = id.split(',');
  return { x: Number(xs), y: Number(ys) };
}

export function neighbors4(
  x: number,
  y: number,
  w: number,
  h: number,
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  if (x > 0) out.push({ x: x - 1, y });
  if (x < w - 1) out.push({ x: x + 1, y });
  if (y > 0) out.push({ x, y: y - 1 });
  if (y < h - 1) out.push({ x, y: y + 1 });
  return out;
}

export function areAdjacent(a: SectorId, b: SectorId): boolean {
  const pa = parseSectorId(a);
  const pb = parseSectorId(b);
  const dx = Math.abs(pa.x - pb.x);
  const dy = Math.abs(pa.y - pb.y);
  return dx + dy === 1;
}

function makeSites(siteDefs: SiteDef[], rng: () => number): [SiteState, SiteState, SiteState] {
  return [
    { defId: pickRandom(rng, siteDefs).id, influencer: null },
    { defId: pickRandom(rng, siteDefs).id, influencer: null },
    { defId: pickRandom(rng, siteDefs).id, influencer: null },
  ];
}

const LANDMARK_POOL: LandmarkState[] = [
  { id: 'skyline_spire', name: 'Skyline Spire', cashBonus: 28, supportBonus: 1 },
  { id: 'undergrid_nexus', name: 'Undergrid Nexus', cashBonus: 12, supportBonus: 2 },
  { id: 'neon_cathedral', name: 'Neon Cathedral', cashBonus: 16, supportBonus: 2 },
  { id: 'void_exchange', name: 'Void Exchange', cashBonus: 32, supportBonus: 0 },
  { id: 'chrome_gardens', name: 'Chrome Gardens', cashBonus: 8, supportBonus: 3 },
  { id: 'rail_yard_prime', name: 'Rail Yard Prime', cashBonus: 22, supportBonus: 1 },
];

function placeLandmarks(
  sectors: Record<SectorId, SectorState>,
  width: number,
  height: number,
  rng: () => number,
  count = 5,
): void {
  const candidates = Object.values(sectors);
  shuffleInPlace(rng, candidates);
  const pool = shuffleInPlace(rng, [...LANDMARK_POOL]);
  const n = Math.min(count, candidates.length, pool.length);
  for (let i = 0; i < n; i++) {
    const sector = candidates[i]!;
    // Skip exact start-ish tiles lightly
    if (
      (sector.x === 1 && sector.y === 1) ||
      (sector.x === width - 2 && sector.y === height - 2)
    ) {
      continue;
    }
    sector.landmark = { ...pool[i % pool.length]! };
  }
  // Ensure we still place if starts skipped
  let placed = Object.values(sectors).filter((s) => s.landmark).length;
  let idx = n;
  while (placed < Math.min(count, pool.length) && idx < candidates.length) {
    const sector = candidates[idx]!;
    if (!sector.landmark) {
      sector.landmark = { ...pool[placed % pool.length]! };
      placed++;
    }
    idx++;
  }
}

export function createEmptyMap(
  width: number,
  height: number,
  siteDefs: SiteDef[],
  seed: number,
): Record<SectorId, SectorState> {
  const rng = createRng(seed ^ 0x51ce);
  const sectors: Record<SectorId, SectorState> = {};
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = sectorId(x, y);
      sectors[id] = {
        id,
        x,
        y,
        owner: null,
        unrest: 0,
        sites: makeSites(siteDefs, rng),
        gangIds: [],
        landmark: null,
      };
    }
  }
  placeLandmarks(sectors, width, height, rng, 5);
  return sectors;
}

export function countSectorsOwned(
  sectors: Record<SectorId, SectorState>,
  playerId: string,
): number {
  return Object.values(sectors).filter((s) => s.owner === playerId).length;
}
