import type { DebriefReport } from '../engine';

export type EndingTone =
  | 'cryptic'
  | 'sarcastic'
  | 'odd'
  | 'triumphant'
  | 'bitter'
  | 'funny';

export interface EndingCardDef {
  id: string;
  outcome: 'win' | 'lose';
  tone: EndingTone;
  /** Small chip above the headline */
  badge: string;
  headline: string;
  subhead: string;
  body: string;
  thankYou: string;
  /** Background art under the card hero */
  art: string;
}

const WIN_CARDS: EndingCardDef[] = [
  {
    id: 'win_crown_of_receipts',
    outcome: 'win',
    tone: 'sarcastic',
    badge: 'FILE CLOSED',
    headline: 'CROWN OF RECEIPTS',
    subhead: 'The city stamped your name. Twice. In triplicate.',
    body: 'You did not “liberate” Sector Lords — you balanced the ledger until the rivals ran out of ink. Congratulations: the skyline now reports to your voicemail.',
    thankYou: 'Thanks for playing Sector Lords. The gangs clocked out. You did not.',
    art: 'assets/endings/win_crown_of_receipts.jpg',
  },
  {
    id: 'win_neon_eulogy',
    outcome: 'win',
    tone: 'cryptic',
    badge: 'SIGNAL LOCKED',
    headline: 'NEON EULOGY',
    subhead: 'The billboards learned your silhouette.',
    body: 'Every block you claimed still hums at 3 a.m. The city does not cheer — it recalibrates. Somewhere a rival deletes a save that never existed.',
    thankYou: 'Thank you for the interference pattern. Come burn another skyline sometime.',
    art: 'assets/endings/win_neon_eulogy.jpg',
  },
  {
    id: 'win_polite_apocalypse',
    outcome: 'win',
    tone: 'funny',
    badge: 'CIVIC IMPROVEMENT',
    headline: 'POLITE APOCALYPSE',
    subhead: 'You won. Please take a pamphlet.',
    body: 'The last rival sent a fruit basket and a ceasefire emoji. You sent them to the hire pool. Democracy is dead; the hire screen thrives.',
    thankYou: 'Thanks for playing. Tip your dealers. Feed your crews. Touch grass (the digital kind).',
    art: 'assets/endings/win_polite_apocalypse.jpg',
  },
  {
    id: 'win_static_gospel',
    outcome: 'win',
    tone: 'odd',
    badge: 'BROADCAST ENDS',
    headline: 'STATIC GOSPEL',
    subhead: 'The radio found a god and it was payroll.',
    body: 'Saints of the undergrid whisper your gang tags like prayers. Or spam. Hard to tell. Either way, the map is yours and the dice finally shut up.',
    thankYou: 'Gratitude protocol complete. You made the weird city weirder. We appreciate that.',
    art: 'assets/endings/win_static_gospel.jpg',
  },
  {
    id: 'win_iron_procession',
    outcome: 'win',
    tone: 'triumphant',
    badge: 'SECTOR SECURE',
    headline: 'IRON PROCESSION',
    subhead: 'Boots on asphalt. Flags on rooftops. Silence where rivals used to shout.',
    body: 'You took the grid the old-fashioned way: orders, blood, and a refusal to retreat. The city bends. Your crews still want overtime.',
    thankYou: 'Thank you, Overlord. The war table remembers. So do we.',
    art: 'assets/endings/win_iron_procession.jpg',
  },
  {
    id: 'win_void_signature',
    outcome: 'win',
    tone: 'cryptic',
    badge: 'CONTRACT SEALED',
    headline: 'VOID SIGNATURE',
    subhead: 'You signed in heat, not ink.',
    body: 'There is no parade — only a quieter police scanner and a skyline that finally loads your color. Ownership is a mood. You set it.',
    thankYou: 'Thanks for the campaign. The void keeps your seat warm.',
    art: 'assets/endings/win_void_signature.jpg',
  },
];

const LOSE_CARDS: EndingCardDef[] = [
  {
    id: 'lose_beautiful_audit',
    outcome: 'lose',
    tone: 'sarcastic',
    badge: 'ACCOUNT CLOSED',
    headline: 'BEAUTIFUL AUDIT',
    subhead: 'You were not bankrupt. You were “restructured.”',
    body: 'A rival filed the winning paperwork first. Your crews still look heroic in the after-action photos. Shame about the fine print.',
    thankYou: 'Thanks for playing Sector Lords. Defeat builds character. And loadouts. Try again.',
    art: 'assets/endings/lose_beautiful_audit.jpg',
  },
  {
    id: 'lose_kind_obituary',
    outcome: 'lose',
    tone: 'cryptic',
    badge: 'TRANSMISSION LOST',
    headline: 'KIND OBITUARY',
    subhead: 'The city wrote you out of the subtitle track.',
    body: 'Your colors fade from the map like a bad ad buy. The blocks you loved still exist — they just answer to someone else’s ringtone.',
    thankYou: 'Thank you for the attempt. Ghosts get free rematches.',
    art: 'assets/endings/lose_kind_obituary.jpg',
  },
  {
    id: 'lose_participation_trophy',
    outcome: 'lose',
    tone: 'funny',
    badge: 'CONSOLATION LOOT',
    headline: 'PARTICIPATION TROPHY',
    subhead: 'It is shaped like a slightly smaller skyline.',
    body: 'You almost had it, which is what people say at funerals and board meetings. The hire pool sends thoughts and expensive prayers.',
    thankYou: 'Thanks for the chaos. Come back when the dice are sober.',
    art: 'assets/endings/lose_participation_trophy.jpg',
  },
  {
    id: 'lose_heat_death',
    outcome: 'lose',
    tone: 'bitter',
    badge: 'GRID FAILURE',
    headline: 'LOCAL HEAT DEATH',
    subhead: 'The police did not win. Time did. Or a rival. Same difference.',
    body: 'Orders stacked. Cash thinned. Someone else owned the arithmetic. The city does not do moral victories — only sector counts.',
    thankYou: 'Thanks for standing in the fire. Next run, bring a bigger ledger.',
    art: 'assets/endings/lose_heat_death.jpg',
  },
  {
    id: 'lose_wrong_channel',
    outcome: 'lose',
    tone: 'odd',
    badge: 'WRONG FREQUENCY',
    headline: 'YOU WERE ON THE WRONG CHANNEL',
    subhead: 'The winners heard a different song.',
    body: 'Somewhere a seagull owns three docks and more hope than you had on turn twelve. The map is honest. Brutal, but honest.',
    thankYou: 'Thank you for tuning in. Static loves company. Replay loves you more.',
    art: 'assets/endings/lose_wrong_channel.jpg',
  },
  {
    id: 'lose_courtesy_defeat',
    outcome: 'lose',
    tone: 'sarcastic',
    badge: 'GGEZ?',
    headline: 'COURTESY DEFEAT',
    subhead: 'The rival left your HQ standing out of pity. Or aesthetics.',
    body: 'You can rebrand this as “early access feedback for the enemy AI.” They will not read it. You will. At 2 a.m. With a new strategy.',
    thankYou: 'Thanks for playing. Rage-quit is free. So is another Jack In.',
    art: 'assets/endings/lose_courtesy_defeat.jpg',
  },
];

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Prefer tone flavor from how the human played. */
function preferredTones(style: string, won: boolean): EndingTone[] {
  const s = style.toLowerCase();
  if (s.includes('warmonger')) return won ? ['triumphant', 'sarcastic', 'cryptic'] : ['bitter', 'sarcastic', 'cryptic'];
  if (s.includes('tech')) return won ? ['cryptic', 'odd', 'triumphant'] : ['odd', 'cryptic', 'bitter'];
  if (s.includes('unrest')) return won ? ['odd', 'funny', 'sarcastic'] : ['odd', 'funny', 'bitter'];
  if (s.includes('racketeer') || s.includes('expansion'))
    return won ? ['sarcastic', 'triumphant', 'funny'] : ['sarcastic', 'funny', 'bitter'];
  if (s.includes('spy')) return won ? ['cryptic', 'odd', 'sarcastic'] : ['cryptic', 'odd', 'bitter'];
  return won
    ? ['triumphant', 'cryptic', 'sarcastic', 'funny', 'odd']
    : ['sarcastic', 'bitter', 'cryptic', 'funny', 'odd'];
}

/**
 * Pick a unique ending card from the pool using debrief outcome + play style.
 */
export function pickEndingCard(debrief: DebriefReport, humanId = 'player'): EndingCardDef {
  const won = debrief.winnerId === humanId;
  const pool = won ? WIN_CARDS : LOSE_CARDS;
  const prefs = preferredTones(debrief.playerStyle, won);
  const seed = hashStr(
    `${debrief.winnerId}|${debrief.turnsPlayed}|${debrief.playerStyle}|${debrief.summary}`,
  );

  const ranked = [...pool].sort((a, b) => {
    const ai = prefs.indexOf(a.tone);
    const bi = prefs.indexOf(b.tone);
    const ap = ai === -1 ? 99 : ai;
    const bp = bi === -1 ? 99 : bi;
    if (ap !== bp) return ap - bp;
    return (hashStr(a.id) ^ seed) - (hashStr(b.id) ^ seed);
  });

  return ranked[seed % ranked.length] ?? pool[0]!;
}

export function allEndingCards(): EndingCardDef[] {
  return [...WIN_CARDS, ...LOSE_CARDS];
}
