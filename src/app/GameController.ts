import { SCENARIOS } from '../content';
import { fillAllAiOrders } from '../ai/heuristicAi';
import {
  acceptJob,
  buildDebrief,
  cancelLastOrder,
  cancelOrder,
  cloneState,
  createNewGame,
  createOrder,
  deserializeState,
  emptyStyle,
  equipItem,
  fabricateItem,
  forecastTurn,
  hireGang,
  queueOrder,
  resolveTurn,
  serializeState,
  unequipItem,
  type CityEventFlash,
  type CombatResult,
  type DebriefReport,
  type Difficulty,
  type GameState,
  type Order,
  type OrderType,
  type PlayerId,
  type SectorId,
  type SectorState,
  type SiteSlot,
  type StyleProfile,
  type TurnForecast,
} from '../engine';
import { buildTurnActionFx, type TurnActionFx } from './turnActionFx';

const SAVE_KEY = 'sector-lords-save';
const SAVE_META_KEY = 'sector-lords-save-meta';
const SETTINGS_KEY = 'sector-lords-settings';

export interface GameSettings {
  scenarioId: string;
  difficulty: Difficulty;
}

export interface SaveMeta {
  savedAt: number;
  turn: number;
  scenarioId: string;
  difficulty: Difficulty;
  cash: number;
  support: number;
  winnerId: string | null;
}

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard', 'overlord'];

function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw) as GameSettings;
  } catch {
    /* ignore */
  }
  return { scenarioId: 'kill_em_all', difficulty: 'normal' };
}

function saveSettings(s: GameSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function migrateState(state: GameState): GameState {
  for (const p of Object.values(state.players)) {
    if (!p.researchedItemIds) p.researchedItemIds = [];
    if (p.researchProgress === undefined) p.researchProgress = null;
    if (!p.inventory) p.inventory = {};
  }
  for (const g of Object.values(state.gangs)) {
    if (!g.equipped) g.equipped = [];
  }
  for (const s of Object.values(state.sectors)) {
    if (s.landmark === undefined) s.landmark = null;
    // chaos → unrest rename
    const raw = s as SectorState & { chaos?: number };
    if (raw.unrest === undefined && typeof raw.chaos === 'number') {
      raw.unrest = raw.chaos;
    }
    delete raw.chaos;
    if (typeof raw.unrest !== 'number') raw.unrest = 0;
  }
  // Pending orders / style from older saves
  for (const o of state.orders ?? []) {
    if ((o as { type: string }).type === 'chaos') {
      (o as { type: string }).type = 'unrest';
    }
  }
  if (state.humanStyle) {
    const st = state.humanStyle as StyleProfile & { chaos?: number };
    if (st.unrest === undefined && typeof st.chaos === 'number') {
      st.unrest = st.chaos;
    }
    delete st.chaos;
    if (typeof st.unrest !== 'number') st.unrest = 0;
  }
  // Job board / active jobs used old def ids
  if (state.jobBoard) {
    state.jobBoard = state.jobBoard.map((id) =>
      id === 'chaos_merchant' ? 'unrest_merchant' : id,
    );
  }
  if (state.activeJobs) {
    for (const j of state.activeJobs) {
      if (j.defId === 'chaos_merchant') j.defId = 'unrest_merchant';
    }
  }
  if (!state.difficulty) state.difficulty = 'normal';
  if (!state.scoutReveal) state.scoutReveal = {};
  if (!state.jobBoard) state.jobBoard = [];
  if (!state.activeJobs) state.activeJobs = [];
  if (state.eventCooldown === undefined) state.eventCooldown = 2;
  if (state.lastEventId === undefined) state.lastEventId = null;
  if (!state.history) state.history = [];
  if (!state.humanStyle) state.humanStyle = emptyStyle();
  return state;
}

export class GameController {
  state: GameState;
  settings: GameSettings;
  private undoStack: GameState[] = [];
  private turnSnapshot: GameState | null = null;
  lastCombats: CombatResult[] = [];
  listeners = new Set<(s: GameState) => void>();

  constructor(state?: GameState) {
    this.settings = loadSettings();
    this.state =
      migrateState(state ?? createNewGame({
        scenarioId: this.settings.scenarioId,
        difficulty: this.settings.difficulty,
      }));
    this.turnSnapshot = cloneState(this.state);
  }

  subscribe(fn: (s: GameState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }

  private pushUndo(): void {
    this.undoStack.push(cloneState(this.state));
    if (this.undoStack.length > 30) this.undoStack.shift();
  }

  get humanId(): PlayerId {
    return this.state.playerOrder.find((id) => this.state.players[id]?.isHuman) ?? 'player';
  }

  newGame(scenarioId?: string, difficulty?: Difficulty): void {
    if (scenarioId) this.settings.scenarioId = scenarioId;
    if (difficulty) this.settings.difficulty = difficulty;
    saveSettings(this.settings);
    this.state = createNewGame({
      scenarioId: this.settings.scenarioId,
      difficulty: this.settings.difficulty,
    });
    this.undoStack = [];
    this.lastCombats = [];
    this.turnSnapshot = cloneState(this.state);
    this.persist();
    this.emit();
  }

  cycleScenario(): string {
    const ids = SCENARIOS.map((s) => s.id);
    const idx = ids.indexOf(this.settings.scenarioId);
    this.settings.scenarioId = ids[(idx + 1) % ids.length]!;
    saveSettings(this.settings);
    this.newGame();
    return this.settings.scenarioId;
  }

  cycleDifficulty(): Difficulty {
    const idx = DIFFICULTIES.indexOf(this.settings.difficulty);
    this.settings.difficulty = DIFFICULTIES[(idx + 1) % DIFFICULTIES.length]!;
    saveSettings(this.settings);
    this.newGame();
    return this.settings.difficulty;
  }

  forecast(): TurnForecast {
    return forecastTurn(this.state);
  }

  tryQueue(order: Order): string | null {
    try {
      this.pushUndo();
      this.state = queueOrder(this.state, order);
      this.persist();
      this.emit();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  orderForGang(
    type: OrderType,
    gangId: string,
    targetSectorId?: SectorId,
    siteSlot?: SiteSlot,
    itemId?: string,
  ): string | null {
    return this.tryQueue(
      createOrder({
        playerId: this.humanId,
        type,
        gangId,
        targetSectorId,
        siteSlot,
        itemId,
      }),
    );
  }

  hire(defId: string, sectorId: SectorId): string | null {
    try {
      this.pushUndo();
      this.state = hireGang(this.state, this.humanId, defId, sectorId);
      this.persist();
      this.emit();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  acceptJob(defId: string): string {
    this.pushUndo();
    const state = cloneState(this.state);
    const msg = acceptJob(state, this.humanId, defId);
    if (msg.startsWith('Job') || msg.startsWith('Already') || msg.startsWith('Invalid')) {
      this.undoStack.pop();
      return msg;
    }
    this.state = state;
    this.persist();
    this.emit();
    return msg;
  }

  fabricate(itemId: string): string {
    this.pushUndo();
    const state = cloneState(this.state);
    const msg = fabricateItem(state, this.humanId, itemId);
    if (msg.startsWith('Need') || msg.startsWith('Not')) {
      this.undoStack.pop();
      return msg;
    }
    this.state = state;
    this.persist();
    this.emit();
    return msg;
  }

  equip(gangId: string, itemId: string): string {
    this.pushUndo();
    const state = cloneState(this.state);
    const msg = equipItem(state, this.humanId, gangId, itemId);
    if (msg.startsWith('Invalid') || msg.startsWith('Not')) {
      this.undoStack.pop();
      return msg;
    }
    this.state = state;
    this.persist();
    this.emit();
    return msg;
  }

  unequip(gangId: string, itemId: string): string {
    this.pushUndo();
    const state = cloneState(this.state);
    const msg = unequipItem(state, this.humanId, gangId, itemId);
    if (msg.startsWith('Invalid') || msg.startsWith('Not')) {
      this.undoStack.pop();
      return msg;
    }
    this.state = state;
    this.persist();
    this.emit();
    return msg;
  }

  undoOrder(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.state = prev;
    this.persist();
    this.emit();
  }

  cancelLast(): void {
    this.pushUndo();
    this.state = cancelLastOrder(this.state, this.humanId);
    this.persist();
    this.emit();
  }

  cancel(orderId: string): void {
    this.pushUndo();
    this.state = cancelOrder(this.state, orderId, this.humanId);
    this.persist();
    this.emit();
  }

  endTurn(): {
    combats: number;
    message: string;
    results: CombatResult[];
    debrief: DebriefReport | null;
    actions: TurnActionFx[];
    /** Structured city event for card UI (null if none this turn) */
    cityEvent: CityEventFlash | null;
  } {
    this.turnSnapshot = cloneState(this.state);
    const withAi = fillAllAiOrders(this.state);
    // Capture orders (human + AI) at pre-resolve positions for board FX reel
    const actions = buildTurnActionFx(withAi);
    const { state, combats, cityEvent } = resolveTurn(withAi);
    this.state = state;
    this.lastCombats = combats;
    this.undoStack = [];
    this.persist();
    this.emit();
    const debrief = this.state.winnerId ? buildDebrief(this.state, this.humanId) : null;
    const humanName = this.state.players[this.humanId]?.name ?? 'You';
    // Surface human unrest payoffs so "raise unrest" doesn't feel like a no-op
    const unrestBits = this.state.log
      .filter(
        (l) =>
          l.turn === this.state.turn - 1 &&
          l.kind === 'economy' &&
          l.message.includes('raises unrest') &&
          l.message.startsWith(humanName),
      )
      .map((l) => l.message.replace(`${humanName} raises unrest in `, 'Unrest '));
    const unrestTail =
      unrestBits.length > 0
        ? ` · ${unrestBits.slice(0, 2).join(' · ')}${unrestBits.length > 2 ? '…' : ''}`
        : '';
    const msg = this.state.winnerId
      ? `${this.state.players[this.state.winnerId]?.name} wins!`
      : cityEvent
        ? `Turn ${this.state.turn} · City event: ${cityEvent.name}${unrestTail}`
        : `Turn ${this.state.turn} begins. ${combats.length} battle(s)${unrestTail || ' resolved.'}`;
    return {
      combats: combats.length,
      message: msg,
      results: combats,
      debrief,
      actions,
      cityEvent,
    };
  }

  getDebrief(): DebriefReport | null {
    if (!this.state.winnerId) return null;
    return buildDebrief(this.state, this.humanId);
  }

  undoEndTurn(): boolean {
    if (!this.turnSnapshot) return false;
    this.state = cloneState(this.turnSnapshot);
    this.turnSnapshot = null;
    this.undoStack = [];
    this.persist();
    this.emit();
    return true;
  }

  persist(): void {
    try {
      localStorage.setItem(SAVE_KEY, serializeState(this.state));
      const human =
        this.state.playerOrder.find((id) => this.state.players[id]?.isHuman) ?? 'player';
      const p = this.state.players[human];
      const meta: SaveMeta = {
        savedAt: Date.now(),
        turn: this.state.turn,
        scenarioId: this.state.scenarioId,
        difficulty: this.state.difficulty,
        cash: p?.cash ?? 0,
        support: p?.support ?? 0,
        winnerId: this.state.winnerId,
      };
      localStorage.setItem(SAVE_META_KEY, JSON.stringify(meta));
    } catch {
      /* ignore quota */
    }
  }

  /** Explicit player save — same storage as autosave, returns status text. */
  saveNow(): string {
    try {
      this.persist();
      if (!localStorage.getItem(SAVE_KEY)) {
        return 'Save failed — browser storage may be blocked.';
      }
      return `Saved · Turn ${this.state.turn} (this browser only).`;
    } catch {
      return 'Save failed — storage full or blocked.';
    }
  }

  clearSave(): void {
    try {
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem(SAVE_META_KEY);
    } catch {
      /* ignore */
    }
  }

  /** Download full save as a JSON file (backup / move devices). */
  exportSaveBlob(): Blob {
    return new Blob([serializeState(this.state)], {
      type: 'application/json',
    });
  }

  static hasSave(): boolean {
    try {
      return !!localStorage.getItem(SAVE_KEY);
    } catch {
      return false;
    }
  }

  static peekSave(): SaveMeta | null {
    try {
      const raw = localStorage.getItem(SAVE_META_KEY);
      if (raw) return JSON.parse(raw) as SaveMeta;
      // Older saves: parse full state for a minimal meta
      const full = localStorage.getItem(SAVE_KEY);
      if (!full) return null;
      const state = migrateState(deserializeState(full));
      const human =
        state.playerOrder.find((id) => state.players[id]?.isHuman) ?? 'player';
      const p = state.players[human];
      return {
        savedAt: Date.now(),
        turn: state.turn,
        scenarioId: state.scenarioId,
        difficulty: state.difficulty,
        cash: p?.cash ?? 0,
        support: p?.support ?? 0,
        winnerId: state.winnerId,
      };
    } catch {
      return null;
    }
  }

  static load(): GameController | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return new GameController(migrateState(deserializeState(raw)));
    } catch {
      return null;
    }
  }

  static importSaveJson(json: string): GameController | null {
    try {
      const state = migrateState(deserializeState(json));
      const ctrl = new GameController(state);
      ctrl.persist();
      return ctrl;
    } catch {
      return null;
    }
  }
}
