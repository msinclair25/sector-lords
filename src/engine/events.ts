import { ITEM_DEFS, siteDefById } from '../content';
import { createRng, pickRandom } from './rng';
import type { EventDef, GameState, PlayerId } from './types';
import { EVENT_DEFS } from '../content';

function weightedPick(rng: () => number, events: EventDef[]): EventDef {
  const total = events.reduce((s, e) => s + e.weight, 0);
  let roll = rng() * total;
  for (const e of events) {
    roll -= e.weight;
    if (roll <= 0) return e;
  }
  return events[events.length - 1]!;
}

/**
 * City-wide random events — funny, weird, or grim.
 * Fires after economy when cooldown is ready (~55–70% chance).
 */
export interface CityEventResult {
  def: EventDef | null;
  messages: string[];
}

export function maybeFireCityEvent(state: GameState): CityEventResult {
  const messages: string[] = [];
  if (state.eventCooldown > 0) {
    state.eventCooldown -= 1;
    return { def: null, messages };
  }

  const rng = createRng(state.seed + state.turn * 4243 + 17);
  // Slightly more frequent so players feel the city breathe
  if (rng() > 0.62) {
    state.eventCooldown = 1;
    return { def: null, messages };
  }

  const pool = EVENT_DEFS.filter((e) => e.id !== state.lastEventId);
  const event = weightedPick(rng, pool.length ? pool : EVENT_DEFS);
  state.lastEventId = event.id;
  state.eventCooldown = 2 + Math.floor(rng() * 2); // 2–3 turns

  const tone = event.tone ? ` [${event.tone}]` : '';
  messages.push(`CITY EVENT${tone} — ${event.name}: ${event.description}`);
  messages.push(...applyEffect(state, event.effect, event.magnitude, rng));
  if (event.secondaryEffect) {
    messages.push(
      ...applyEffect(
        state,
        event.secondaryEffect,
        event.secondaryMagnitude ?? event.magnitude,
        rng,
      ),
    );
  }
  return { def: event, messages };
}

function livingPlayers(state: GameState): PlayerId[] {
  return state.playerOrder.filter((pid) => {
    const p = state.players[pid];
    return p && !p.eliminated;
  });
}

function applyEffect(
  state: GameState,
  effect: string,
  magnitude: number,
  rng: () => number,
): string[] {
  const msgs: string[] = [];
  switch (effect) {
    case 'reduce_unrest_all': {
      for (const s of Object.values(state.sectors)) {
        s.unrest = Math.max(0, s.unrest - magnitude);
      }
      msgs.push(`Unrest drops by ${magnitude} across the grid.`);
      break;
    }
    case 'unrest_spike_all': {
      for (const s of Object.values(state.sectors)) {
        s.unrest = Math.min(10, s.unrest + magnitude);
      }
      msgs.push(`Unrest creeps up by ${magnitude} on every block.`);
      break;
    }
    case 'tax_cash': {
      for (const pid of livingPlayers(state)) {
        const p = state.players[pid]!;
        const loss = Math.min(p.cash, magnitude);
        p.cash -= loss;
        if (loss > 0) msgs.push(`${p.name} loses $${loss}.`);
      }
      break;
    }
    case 'cash_bonus': {
      for (const pid of livingPlayers(state)) {
        const p = state.players[pid]!;
        p.cash += magnitude;
      }
      msgs.push(`Each overlord pockets $${magnitude}.`);
      break;
    }
    case 'support_swing': {
      for (const pid of livingPlayers(state)) {
        const p = state.players[pid]!;
        const delta = Math.floor(rng() * (magnitude * 2 + 1)) - magnitude;
        p.support = Math.max(0, p.support + delta);
        msgs.push(`${p.name} support ${delta >= 0 ? '+' : ''}${delta}.`);
      }
      break;
    }
    case 'support_flat': {
      for (const pid of livingPlayers(state)) {
        const p = state.players[pid]!;
        p.support = Math.max(0, p.support + magnitude);
        msgs.push(`${p.name} support ${magnitude >= 0 ? '+' : ''}${magnitude}.`);
      }
      break;
    }
    case 'support_redistribute': {
      // Steal a little support from the leader, gift to the trailer
      const ids = livingPlayers(state);
      if (ids.length < 2) break;
      let rich = ids[0]!;
      let poor = ids[0]!;
      for (const pid of ids) {
        if (state.players[pid]!.support > state.players[rich]!.support) rich = pid;
        if (state.players[pid]!.support < state.players[poor]!.support) poor = pid;
      }
      if (rich === poor) break;
      const take = Math.min(magnitude, state.players[rich]!.support);
      state.players[rich]!.support -= take;
      state.players[poor]!.support += take;
      msgs.push(
        `${state.players[poor]!.name} surges in the polls (+${take}); ${state.players[rich]!.name} slips.`,
      );
      break;
    }
    case 'damage_gangs': {
      const gangs = Object.values(state.gangs).filter((g) => g.hp > 0);
      if (gangs.length === 0) break;
      const hits = Math.min(3, gangs.length);
      for (let i = 0; i < hits; i++) {
        const g = pickRandom(rng, gangs);
        g.hp = Math.max(1, g.hp - magnitude);
        msgs.push(`A crew in ${g.sectorId} gets roughed up (HP ${g.hp}).`);
      }
      break;
    }
    case 'heal_gangs': {
      const gangs = Object.values(state.gangs).filter((g) => g.hp > 0 && g.hp < 100);
      if (gangs.length === 0) break;
      const hits = Math.min(4, gangs.length);
      for (let i = 0; i < hits; i++) {
        const g = pickRandom(rng, gangs);
        const before = g.hp;
        g.hp = Math.min(100, g.hp + magnitude);
        if (g.hp > before) {
          msgs.push(`A crew in ${g.sectorId} patches up (HP ${g.hp}).`);
        }
      }
      break;
    }
    case 'heat_spike': {
      state.cityHeat = Math.min(100, state.cityHeat + magnitude);
      msgs.push(`City heat rises to ${state.cityHeat}.`);
      break;
    }
    case 'heat_drop': {
      state.cityHeat = Math.max(0, state.cityHeat - magnitude);
      msgs.push(`City heat eases to ${state.cityHeat}.`);
      break;
    }
    case 'research_boost': {
      for (const pid of livingPlayers(state)) {
        const p = state.players[pid]!;
        if (p.researchProgress) {
          p.researchProgress.points += magnitude;
          const item = ITEM_DEFS.find((i) => i.id === p.researchProgress!.itemId);
          if (item && p.researchProgress.points >= item.researchCost) {
            p.researchedItemIds.push(item.id);
            p.researchProgress = null;
            msgs.push(`${p.name} finishes research early via leaked data!`);
          } else {
            msgs.push(`${p.name} gains +${magnitude} research.`);
          }
        } else if (p.researchedItemIds.length === 0 && ITEM_DEFS[0]) {
          p.researchProgress = { itemId: ITEM_DEFS[0].id, points: magnitude };
          msgs.push(`${p.name} receives partial schematics for ${ITEM_DEFS[0].name}.`);
        }
      }
      break;
    }
    case 'media_support': {
      for (const pid of livingPlayers(state)) {
        const p = state.players[pid]!;
        let bonus = 0;
        for (const sector of Object.values(state.sectors)) {
          for (const site of sector.sites) {
            if (site.influencer === pid && siteDefById(site.defId).id === 'media_hub') {
              bonus += magnitude;
            }
          }
        }
        if (bonus > 0) {
          p.support += bonus;
          msgs.push(`${p.name} rides the media wave (+${bonus} support).`);
        }
      }
      break;
    }
    default:
      break;
  }
  return msgs;
}
