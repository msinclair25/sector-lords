/** Pure game-data types. No Phaser imports. */

export type PlayerId = string;
export type GangInstanceId = string;
export type SectorId = string; // "x,y"
export type SiteSlot = 0 | 1 | 2;

export type OrderType =
  | 'move'
  | 'attack'
  | 'claim'
  | 'unrest'
  | 'influence'
  | 'defend'
  | 'idle'
  | 'research'
  | 'scout';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'overlord';

export type IntelLevel = 0 | 1 | 2;

export interface EventDef {
  id: string;
  name: string;
  description: string;
  weight: number;
  /** Primary mechanical punch */
  effect: string;
  magnitude: number;
  /** Optional second punch for pro/con pairs */
  secondaryEffect?: string;
  secondaryMagnitude?: number;
  /** Flavor tag for filtering / UI tone */
  tone?: 'funny' | 'grim' | 'weird' | 'neutral';
}

export interface JobDef {
  id: string;
  name: string;
  description: string;
  goalType: string;
  goalTarget: string;
  goalCount: number;
  rewardCash: number;
  rewardSupport: number;
  timeLimit: number;
  weight: number;
}

export interface ActiveJob {
  defId: string;
  playerId: PlayerId;
  progress: number;
  expiresTurn: number;
  /** For jobs that track discrete actions */
  counters: Record<string, number>;
}

export type ItemType = 'melee' | 'ranged' | 'armor' | 'misc';

export interface ArtRefs {
  portrait?: string;
  icon?: string;
  /** Research schematic / blueprint plate for tech UI */
  blueprint?: string;
  tile?: string;
}

export interface ItemDef {
  id: string;
  name: string;
  description: string;
  type: ItemType;
  techLevel: number;
  researchCost: number;
  fabricateCost: number;
  combatBonus: number;
  defenseBonus: number;
  tags: string[];
  art: ArtRefs;
}

export interface GangDef {
  id: string;
  name: string;
  description: string;
  hireCost: number;
  upkeep: number;
  combat: number;
  defense: number;
  tech: number;
  /** Role tags for AI / abilities */
  tags: string[];
  /** One-liner signature ability */
  signature: string;
  art: ArtRefs;
}

export interface SiteDef {
  id: string;
  name: string;
  description: string;
  cashBonus: number;
  supportBonus: number;
  researchBonus: number;
  combatBonus: number;
  /** End-of-turn HP restored to your gangs standing in the sector when you influence this site */
  healBonus?: number;
  art: ArtRefs;
}

export interface ScenarioDef {
  id: string;
  name: string;
  description: string;
  mapWidth: number;
  mapHeight: number;
  startingCash: number;
  startingGangs: number;
  victory: VictoryCondition;
  aiCount: number;
}

export type VictoryCondition =
  | { type: 'elimination' }
  | { type: 'most_sectors'; turns: number }
  | { type: 'most_cash'; turns: number }
  | { type: 'combined'; turns: number };

export interface SiteState {
  defId: string;
  /** null = uninfluenced */
  influencer: PlayerId | null;
}

export interface LandmarkState {
  id: string;
  name: string;
  /** Extra cash per turn when owned */
  cashBonus: number;
  /** Support per turn when owned */
  supportBonus: number;
}

export interface SectorState {
  id: SectorId;
  x: number;
  y: number;
  owner: PlayerId | null;
  unrest: number;
  sites: [SiteState, SiteState, SiteState];
  gangIds: GangInstanceId[];
  /** Rare city landmark (null if none) */
  landmark: LandmarkState | null;
  /** Turns remaining of police crackdown residual (tile badge) */
  crackdownTurns?: number;
}

export interface GangInstance {
  id: GangInstanceId;
  defId: string;
  ownerId: PlayerId;
  sectorId: SectorId;
  hp: number; // 0–100, combat reduces
  ordersDone: boolean;
  /** Equipped item def ids (one per item type) */
  equipped: string[];
}

export interface ResearchProgress {
  itemId: string;
  points: number;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  color: number;
  isHuman: boolean;
  cash: number;
  support: number;
  eliminated: boolean;
  /** Gang def ids seen / unlocked for hire flavor */
  knownGangDefs: string[];
  researchedItemIds: string[];
  researchProgress: ResearchProgress | null;
  /** itemId → count */
  inventory: Record<string, number>;
}

export interface Order {
  id: string;
  playerId: PlayerId;
  type: OrderType;
  gangId: GangInstanceId;
  /** Destination sector for move/attack/claim */
  targetSectorId?: SectorId;
  /** Site slot for influence */
  siteSlot?: SiteSlot;
  /** Item for research orders */
  itemId?: string;
}

/** How the clash arena should animate each side */
export type CombatFightStyle = 'melee' | 'ranged' | 'tech' | 'hybrid';

export interface CombatResult {
  sectorId: SectorId;
  attackerId: PlayerId;
  defenderId: PlayerId | null;
  attackerPower: number;
  defenderPower: number;
  attackerWinChance: number;
  attackerWon: boolean;
  attackerLosses: number;
  defenderLosses: number;
  summary: string;
  destroyedGangIds: GangInstanceId[];
  /** Presentation fields (filled at resolve time) */
  roll?: number;
  attackerNames?: string[];
  defenderNames?: string[];
  attackerPortrait?: string;
  defenderPortrait?: string;
  attackerPlayerName?: string;
  defenderPlayerName?: string;
  /** melee / ranged / tech / hybrid — drives fight FX */
  attackerStyle?: CombatFightStyle;
  defenderStyle?: CombatFightStyle;
  /** Gear icon URLs (equipped) for loadout chips in the clash UI */
  attackerGearIcons?: string[];
  defenderGearIcons?: string[];
  /** Five strike callouts for the fight reel */
  strikeLabels?: string[];
  /**
   * Sector IDs the attackers left before the clash (unique).
   * Used by the clash-card schematic mini-map; empty when unknown.
   */
  attackerOriginSectorIds?: SectorId[];
}

export interface TurnLogEntry {
  turn: number;
  kind: 'info' | 'combat' | 'economy' | 'police' | 'victory' | 'event' | 'job';
  message: string;
  combat?: CombatResult;
}

export interface HirePoolEntry {
  defId: string;
  /** Turns remaining in pool before refresh eligibility */
  turnsLeft: number;
}

export interface GameState {
  turn: number;
  mapWidth: number;
  mapHeight: number;
  sectors: Record<SectorId, SectorState>;
  players: Record<PlayerId, PlayerState>;
  playerOrder: PlayerId[];
  gangs: Record<GangInstanceId, GangInstance>;
  orders: Order[];
  hirePool: HirePoolEntry[];
  scenarioId: string;
  victory: VictoryCondition;
  winnerId: PlayerId | null;
  log: TurnLogEntry[];
  /** Citywide police heat 0–100 */
  cityHeat: number;
  /**
   * Turns remaining after a crackdown where another crackdown cannot fire
   * (cool-off). 0 = can crack down again when heat is high enough.
   */
  crackdownCooldown: number;
  seed: number;
  difficulty: Difficulty;
  /** playerId → sectorId → reveal expires on this turn (inclusive) */
  scoutReveal: Record<PlayerId, Record<SectorId, number>>;
  /** Available jobs on the board (not yet accepted) */
  jobBoard: string[];
  /** Accepted jobs */
  activeJobs: ActiveJob[];
  /** Turns until next random city event */
  eventCooldown: number;
  lastEventId: string | null;
  /** Per-turn score snapshots for debrief */
  history: TurnSnapshot[];
  /** Human play-style counters for debrief + adaptive AI */
  humanStyle: StyleProfile;
  /** Snapshot support: version for saves */
  version: 1;
}

export interface TurnSnapshot {
  turn: number;
  cash: Record<PlayerId, number>;
  sectors: Record<PlayerId, number>;
  gangs: Record<PlayerId, number>;
  support: Record<PlayerId, number>;
  cityHeat: number;
}

export interface StyleProfile {
  attacks: number;
  claims: number;
  unrest: number;
  research: number;
  influence: number;
  scouts: number;
}

export interface OddsPreview {
  winChance: number;
  /** Display range when foggy */
  winChanceMin: number;
  winChanceMax: number;
  attackerPower: number;
  defenderPower: number;
  defenderId: PlayerId | null;
  intel: IntelLevel;
  fogged: boolean;
}

export interface TurnForecast {
  projectedCash: Record<PlayerId, number>;
  projectedHeat: number;
  pendingBattles: Array<{
    sectorId: SectorId;
    attackerId: PlayerId;
    defenderId: PlayerId | null;
    winChance: number;
    winChanceMin: number;
    winChanceMax: number;
    fogged: boolean;
  }>;
  policeRisk: 'low' | 'medium' | 'high' | 'critical';
}

export interface CityEventFlash {
  id: string;
  name: string;
  description: string;
  tone?: string;
  messages: string[];
  /** Optional art override (e.g. police crackdown) */
  artUrl?: string;
}

/** Heat band for UI / forecast copy */
export type HeatBand = 'calm' | 'watch' | 'elevated' | 'critical' | 'crackdown';

/** Structured crackdown report (engine → UI card) */
export interface CrackdownResult {
  sectorIds: SectorId[];
  heatBefore: number;
  heatAfter: number;
  cooldownTurns: number;
  messages: string[];
}

export interface ResolveTurnResult {
  state: GameState;
  combats: CombatResult[];
  cityEvent: CityEventFlash | null;
}
