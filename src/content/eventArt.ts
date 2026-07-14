import type { EventDef } from '../engine/types';

/** Specific event art when available; otherwise fall back by tone. */
const BY_ID: Record<string, string> = {
  blackout: '/assets/events/blackout.jpg',
  corporate_raid: '/assets/events/corporate_raid.jpg',
  rat_king_parade: '/assets/events/rat_king_parade.jpg',
  influencer_meltdown: '/assets/events/influencer_meltdown.jpg',
  free_pizza_friday: '/assets/events/free_pizza_friday.jpg',
  haunted_atm: '/assets/events/haunted_atm.jpg',
  ufo_over_docks: '/assets/events/ufo_over_docks.jpg',
  police_crackdown: '/assets/events/police_crackdown.jpg',
};

const BY_TONE: Record<string, string> = {
  funny: '/assets/events/tone_funny.jpg',
  grim: '/assets/events/tone_grim.jpg',
  weird: '/assets/events/tone_weird.jpg',
  neutral: '/assets/events/tone_neutral.jpg',
};

/** Art for any flash-style card (city events + crackdown). */
export function flashArtUrl(flash: {
  id: string;
  tone?: string;
  artUrl?: string;
}): string {
  if (flash.artUrl) return flash.artUrl;
  return (
    BY_ID[flash.id] ??
    BY_TONE[flash.tone ?? 'neutral'] ??
    BY_TONE.neutral!
  );
}

export function eventArtUrl(def: EventDef): string {
  return (
    BY_ID[def.id] ??
    BY_TONE[def.tone ?? 'neutral'] ??
    BY_TONE.neutral!
  );
}
