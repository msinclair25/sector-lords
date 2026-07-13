import gangsJson from './gangs.json';
import sitesJson from './sites.json';
import scenariosJson from './scenarios.json';
import itemsJson from './items.json';
import eventsJson from './events.json';
import jobsJson from './jobs.json';
import type {
  EventDef,
  GangDef,
  ItemDef,
  JobDef,
  ScenarioDef,
  SiteDef,
} from '../engine/types';

export const GANG_DEFS: GangDef[] = gangsJson as GangDef[];
export const SITE_DEFS: SiteDef[] = sitesJson as SiteDef[];
export const SCENARIOS: ScenarioDef[] = scenariosJson as ScenarioDef[];
export const ITEM_DEFS: ItemDef[] = itemsJson as ItemDef[];
export const EVENT_DEFS: EventDef[] = eventsJson as EventDef[];
export const JOB_DEFS: JobDef[] = jobsJson as JobDef[];

export function gangDefById(id: string): GangDef {
  const def = GANG_DEFS.find((g) => g.id === id);
  if (!def) throw new Error(`Unknown gang def: ${id}`);
  return def;
}

export function siteDefById(id: string): SiteDef {
  const def = SITE_DEFS.find((s) => s.id === id);
  if (!def) throw new Error(`Unknown site def: ${id}`);
  return def;
}

/** Compact human-readable bonus list for UI, e.g. "+$25/turn · +2 combat". */
export function formatSiteBonuses(def: SiteDef): string {
  const parts: string[] = [];
  if (def.cashBonus) parts.push(`+$${def.cashBonus}/turn`);
  if (def.supportBonus) parts.push(`+${def.supportBonus} support/turn`);
  if (def.researchBonus) parts.push(`+${def.researchBonus} research`);
  if (def.combatBonus) parts.push(`+${def.combatBonus} combat here`);
  if (def.healBonus) parts.push(`+${def.healBonus} HP heal/turn`);
  return parts.length > 0 ? parts.join(' · ') : 'No passive bonus';
}

/** Short label for order status lines. */
export function formatSiteBonusShort(def: SiteDef): string {
  if (def.cashBonus) return `+$${def.cashBonus}/turn`;
  if (def.researchBonus) return `+${def.researchBonus} research`;
  if (def.combatBonus) return `+${def.combatBonus} combat`;
  if (def.healBonus) return `+${def.healBonus} HP heal`;
  if (def.supportBonus) return `+${def.supportBonus} support`;
  return 'passive';
}

export interface EmpireRacketSummary {
  siteCount: number;
  cashPerTurn: number;
  supportPerTurn: number;
  researchPerTurn: number;
  combatSites: number;
  healPerTurn: number;
}

/** Aggregate all sites you currently influence. */
export function summarizeEmpireRackets(
  state: { sectors: Record<string, { sites: Array<{ defId: string; influencer: string | null }> }> },
  playerId: string,
): EmpireRacketSummary {
  const out: EmpireRacketSummary = {
    siteCount: 0,
    cashPerTurn: 0,
    supportPerTurn: 0,
    researchPerTurn: 0,
    combatSites: 0,
    healPerTurn: 0,
  };
  for (const sector of Object.values(state.sectors)) {
    for (const site of sector.sites) {
      if (site.influencer !== playerId) continue;
      const def = siteDefById(site.defId);
      out.siteCount += 1;
      out.cashPerTurn += def.cashBonus;
      out.supportPerTurn += def.supportBonus;
      out.researchPerTurn += def.researchBonus;
      out.healPerTurn += def.healBonus ?? 0;
      if (def.combatBonus > 0) out.combatSites += 1;
    }
  }
  return out;
}

export function scenarioById(id: string): ScenarioDef {
  const def = SCENARIOS.find((s) => s.id === id);
  if (!def) throw new Error(`Unknown scenario: ${id}`);
  return def;
}

export function itemDefById(id: string): ItemDef {
  const def = ITEM_DEFS.find((i) => i.id === id);
  if (!def) throw new Error(`Unknown item def: ${id}`);
  return def;
}

/** Absolute URL path for item gear icon (equipped / stash). */
export function itemIconUrl(def: ItemDef): string {
  const raw = def.art.icon ?? `assets/gear/${def.id}.jpg`;
  return raw.startsWith('/') ? raw : `/${raw}`;
}

/** Absolute URL path for research blueprint art. */
export function itemBlueprintUrl(def: ItemDef): string {
  const raw = def.art.blueprint ?? def.art.icon ?? `assets/blueprints/${def.id}.jpg`;
  return raw.startsWith('/') ? raw : `/${raw}`;
}

export function eventDefById(id: string): EventDef {
  const def = EVENT_DEFS.find((e) => e.id === id);
  if (!def) throw new Error(`Unknown event def: ${id}`);
  return def;
}

export function jobDefById(id: string): JobDef {
  const def = JOB_DEFS.find((j) => j.id === id);
  if (!def) throw new Error(`Unknown job def: ${id}`);
  return def;
}
