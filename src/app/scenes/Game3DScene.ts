import Phaser from 'phaser';
import {
  formatSiteBonusShort,
  formatSiteBonuses,
  gangDefById,
  itemBlueprintUrl,
  itemDefById,
  itemIconUrl,
  jobDefById,
  scenarioById,
  siteDefById,
  summarizeEmpireRackets,
} from '../../content';
import { eventArtUrl } from '../../content/eventArt';
import {
  areAdjacent,
  computeIncomeBreakdown,
  describeVictoryGoal,
  formatOdds,
  pathsToVictory,
  previewAttackWithIntel,
  researchableItems,
  type CityEventFlash,
  type DebriefReport,
  type Difficulty,
  type GameState,
  type GangInstance,
  type Order,
  type PlayerState,
  type SectorId,
  type SiteSlot,
} from '../../engine';
import { EVENT_DEFS } from '../../content';
import { BoardTabletop } from '../../app-tabletop/BoardTabletop';
import { GameController } from '../GameController';
import { SFX } from '../audio/SoundBank';
import {
  describeActionFx,
  type ActionFxKind,
  type TurnActionFx,
} from '../turnActionFx';
import { pickEndingCard } from '../../content/endings';
import hudCss from '../ui/hybridHud.css?inline';
import battleCss from '../ui/battleClash.css?inline';
import eventCss from '../ui/eventCard.css?inline';
import endingCss from '../ui/endingCard.css?inline';

const COACH_KEY = 'sector-lords-hybrid-coach';
const SIDE_COLLAPSE_KEY = 'sector-lords-side-collapse';
const ORDER_FX_MS = 420;
const REEL_STEP_MS = 480;

function loadSideCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SIDE_COLLAPSE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'boolean') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function saveSideCollapsed(map: Record<string, boolean>): void {
  try {
    localStorage.setItem(SIDE_COLLAPSE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

type TutStep = {
  title: string;
  body: string;
  visual: string;
  /** Board highlight mode */
  board: 'home' | 'dest' | 'none';
  /** UI elements to spotlight after render */
  ui: Array<'crew' | 'end-turn' | 'sites' | 'status'>;
};

const TUTORIAL: TutStep[] = [
  {
    title: 'Pick your crew',
    body: 'Your home block is pulsing gold. Select a crew from YOUR CREWS on the right — or click the home block.',
    visual: '→ Gold “CLICK” beacon on your home sector · crew list highlighted',
    board: 'home',
    ui: ['crew'],
  },
  {
    title: 'Issue a move order',
    body: 'Green neighbors are legal moves. One click auto-orders MOVE, CLAIM, or ATTACK. Watch the order markers appear.',
    visual: '→ Green glow + “MOVE HERE” labels on valid tiles',
    board: 'dest',
    ui: [],
  },
  {
    title: 'End the turn',
    body: 'Orders resolve when you press END TURN — rivals act, cash updates, and city events may fire. You can Cancel / Esc first.',
    visual: '→ END TURN button pulsing green',
    board: 'none',
    ui: ['end-turn'],
  },
  {
    title: 'Influence a business',
    body: 'On your owned turf, open a site card in the side panel. Influence Casino for cash, Lab for research, Armory for combat, Clinic for heal.',
    visual: '→ Business cards highlighted when you’re on owned ground',
    board: 'home',
    ui: ['sites'],
  },
];

/**
 * Hybrid experience: 3D city + 2D art + contextual HUD.
 * Primary play mode — designed for fast pickup.
 */
export class Game3DScene extends Phaser.Scene {
  private controller!: GameController;
  private board: BoardTabletop | null = null;
  private host!: HTMLDivElement;
  private root!: HTMLDivElement;
  private styleEl!: HTMLStyleElement;
  private selected: SectorId | null = null;
  private selectedGang: string | null = null;
  private unsub: (() => void) | null = null;
  private coachStep = 0;
  private drawer: 'none' | 'hire' | 'jobs' | 'tech' = 'none';
  /** Roster filter when you have many crews */
  private crewFilter: 'all' | 'free' | 'ordered' | 'here' = 'all';
  /** Right-panel sections the player minimized (− / +) */
  private sideCollapsed: Record<string, boolean> = loadSideCollapsed();
  /**
   * Guided order walkthrough — steps through free crews so you don't
   * hunt the roster every time.
   */
  private orderGuide = false;
  private statusMsg = 'Click a block on the city. Start with your glowing home sector.';
  /**
   * End Turn pressed while free crews remain — show confirm banner
   * before actually resolving.
   */
  private endTurnConfirm = false;
  /** When true, remaining fights are batched into one skip-all summary. */
  private combatSkipRemaining = false;
  /** Fights deferred by Skip All (current + remaining). */
  private combatSkipBatch: import('../../engine').CombatResult[] = [];
  /**
   * Phone layout: crew panel is a slide-over drawer (desktop always visible).
   * Starts closed so the board gets the full width.
   */
  private sideMobileOpen = false;
  /** Blocks double-clicks while order commit FX plays */
  private actionBusy = false;
  /** Blocks UI while end-turn action reel plays */
  private resolving = false;
  /** Skip board snap while we animate pre-resolve positions */
  private suppressSync = false;
  /** Coalesce multiple render() calls into one per animation frame */
  private renderRaf: number | null = null;

  constructor() {
    super('Game3D');
  }

  init(data: {
    scenarioId?: string;
    difficulty?: Difficulty;
    continueSave?: boolean;
  }): void {
    if (data.continueSave) {
      const loaded = GameController.load();
      if (loaded) {
        this.controller = loaded;
        this.statusMsg = `Continued · Turn ${loaded.state.turn}. Autosaves after every action.`;
      } else {
        this.controller = new GameController();
        this.controller.newGame(data.scenarioId ?? 'kill_em_all', data.difficulty ?? 'normal');
        this.statusMsg = 'No save found — started a new game.';
      }
    } else {
      this.controller = new GameController();
      this.controller.newGame(data.scenarioId ?? 'kill_em_all', data.difficulty ?? 'normal');
      this.statusMsg = 'New game · progress autosaves in this browser.';
    }
    try {
      const c = localStorage.getItem(COACH_KEY);
      this.coachStep = c === 'done' ? 99 : Number(c) || 0;
    } catch {
      this.coachStep = 0;
    }
  }

  create(): void {
    const parent = document.getElementById('app') ?? document.body;
    // Hybrid UI is pure DOM — stop Phaser from burning a rAF/compositor slot
    this.game.canvas.style.display = 'none';
    try {
      // Phaser 3/4: sleep the game loop while HTML board is active
      (this.game.loop as { sleep?: () => void }).sleep?.();
    } catch {
      /* ignore */
    }

    this.styleEl = document.createElement('style');
    this.styleEl.textContent = hudCss;
    document.head.appendChild(this.styleEl);

    this.host = document.createElement('div');
    this.host.id = 'board3d-host';
    this.host.style.cssText = 'position:fixed;inset:0;z-index:1;background:#07060f;';
    parent.appendChild(this.host);

    this.root = document.createElement('div');
    this.root.id = 'sl-hybrid-root';
    parent.appendChild(this.root);

    this.root.innerHTML = `<div id="sl-loading" class="pe">Setting up tabletop…</div>`;

    void this.bootBoard();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown());
  }

  private async bootBoard(): Promise<void> {
    try {
      this.board = new BoardTabletop(this.host);
      await Promise.race([
        this.board.loadArt(),
        new Promise<void>((r) => window.setTimeout(r, 2000)),
      ]);

      this.board.setOnSelect((id) => {
        this.onBoardSelect(id);
      });
      this.board.setOnSelectGang((gid) => {
        this.selectGangById(gid);
      });

      const home = Object.values(this.controller.state.sectors).find(
        (s) => s.owner === this.controller.humanId,
      );
      this.selected = home?.id ?? null;
      if (home) {
        this.selectedGang =
          home.gangIds.find(
            (g) => this.controller.state.gangs[g]?.ownerId === this.controller.humanId,
          ) ?? null;
      }

      this.refreshBoard();
      // Frame the map after HUD + board layout settle (iso projected bounds)
      this.board.scheduleCenter(true);

      // Lead with the win condition so players know why the game might end
      const goal = describeVictoryGoal(this.controller.state.victory);
      this.statusMsg = `GOAL · ${goal}`;

      this.unsub = this.controller.subscribe(() => {
        if (this.suppressSync) {
          // State already advanced; keep old board for FX reel, only update status chrome lightly
          return;
        }
        this.refreshBoard();
        this.render();
      });

      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('sl-music-track', this.onMusicTrack);

      this.render();
      this.applyTutorialBoardHints();
      // One more pass after HUD chrome exists so padding / safe rect is final
      requestAnimationFrame(() => this.board?.scheduleCenter(true));
      void SFX.unlock().then(() => {
        SFX.play('endTurn');
        SFX.startMusic();
      });
    } catch (e) {
      console.error('[Sector Lords] tabletop boot failed', e);
      this.root.innerHTML = `
        <div id="sl-loading" class="pe" style="flex-direction:column;gap:12px;text-align:center">
          <div>Could not start the tabletop board.</div>
          <div style="font-size:13px;opacity:.8">${e instanceof Error ? e.message : String(e)}</div>
          <button class="act primary pe" id="sl-boot-menu" style="pointer-events:auto;padding:10px 16px;cursor:pointer">Back to menu</button>
          <button class="act pe" id="sl-boot-classic" style="pointer-events:auto;padding:10px 16px;cursor:pointer">Classic flat map</button>
        </div>`;
      this.root.querySelector('#sl-boot-menu')?.addEventListener('click', () => {
        this.teardown();
        this.scene.start('Menu');
      });
      this.root.querySelector('#sl-boot-classic')?.addEventListener('click', () => {
        const sid = this.controller.state.scenarioId;
        const diff = this.controller.state.difficulty;
        this.teardown();
        this.scene.start('Game', { scenarioId: sid, difficulty: diff, fresh: true });
      });
    }
  }

  private refreshBoard(): void {
    // Pending markers first so sync/rebuild never re-paints stale order portraits
    this.board?.setPendingOrders(this.pendingOrderMarkers());
    this.board?.sync(this.controller.state, this.selected, this.selectedGang);
    this.board?.setHighlights(this.validDestinations());
    this.applyTutorialBoardHints();
  }

  private humanHomeId(): SectorId | null {
    const home = Object.values(this.controller.state.sectors).find(
      (s) => s.owner === this.controller.humanId,
    );
    return home?.id ?? null;
  }

  private applyTutorialBoardHints(): void {
    if (!this.board || this.coachStep >= TUTORIAL.length) {
      this.board?.setTutorialHighlights([]);
      return;
    }
    const step = TUTORIAL[this.coachStep]!;
    if (step.board === 'home') {
      const home = this.humanHomeId();
      // Prefer selected crew's tile if further along
      const gang = this.selectedGang
        ? this.controller.state.gangs[this.selectedGang]
        : null;
      const id =
        this.coachStep === 3 && gang?.sectorId
          ? gang.sectorId
          : home;
      this.board.setTutorialHighlights(id ? [id] : [], 'home');
      if (id && this.coachStep === 0) this.board.focusSector(id);
    } else if (step.board === 'dest') {
      const dests = this.validDestinations();
      this.board.setTutorialHighlights(dests, 'dest');
      // Keep normal green glow too
      if (dests[0]) this.board.focusSector(dests[0]);
    } else {
      this.board.setTutorialHighlights([]);
    }
  }

  private applyTutorialUiHints(): void {
    if (!this.root || this.coachStep >= TUTORIAL.length) return;
    const step = TUTORIAL[this.coachStep]!;
    for (const kind of step.ui) {
      if (kind === 'crew') {
        this.root
          .querySelectorAll('#sl-gang-pick .gang-pick, #sl-move-banner')
          .forEach((el) => el.classList.add('tut-spotlight'));
      }
      if (kind === 'end-turn') {
        this.root
          .querySelector('button.act.end-turn')
          ?.classList.add('tut-spotlight');
      }
      if (kind === 'sites') {
        this.root
          .querySelectorAll('.site-card:not(.mine), .site-card-list')
          .forEach((el) => el.classList.add('tut-spotlight'));
      }
      if (kind === 'status') {
        this.root.querySelector('#sl-status')?.classList.add('tut-spotlight');
      }
    }
  }

  /** Human orders drawn on the board (from → to) — chips only, no portraits. */
  private pendingOrderMarkers(): Array<{
    gangId: string;
    from: SectorId;
    to: SectorId;
    type: string;
    name: string;
  }> {
    const state = this.controller.state;
    const out: Array<{
      gangId: string;
      from: SectorId;
      to: SectorId;
      type: string;
      name: string;
    }> = [];
    for (const o of state.orders) {
      if (o.playerId !== this.controller.humanId || !o.targetSectorId) continue;
      const g = state.gangs[o.gangId];
      if (!g) continue;
      const def = gangDefById(g.defId);
      out.push({
        gangId: o.gangId,
        from: g.sectorId,
        to: o.targetSectorId,
        type: o.type,
        name: def.name,
      });
    }
    return out;
  }

  private onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape') return;
    // Don't steal Escape from text inputs / drawers focus noise
    if ((ev.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
    if (this.drawer !== 'none') {
      this.drawer = 'none';
      this.render();
      SFX.play('ui');
      return;
    }
    if (this.selectedGang && this.cancelGangOrder(this.selectedGang)) {
      ev.preventDefault();
    }
  };

  /** Cancel a human order for a gang. Returns true if something was cancelled. */
  private cancelGangOrder(gangId: string): boolean {
    const ord = this.controller.state.orders.find(
      (o) => o.gangId === gangId && o.playerId === this.controller.humanId,
    );
    if (!ord) return false;
    this.controller.cancel(ord.id);
    const g = this.controller.state.gangs[gangId];
    const name = g ? gangDefById(g.defId).name : 'Crew';
    this.statusMsg = `${name}: order cancelled. Green destinations are available again.`;
    SFX.play('ui');
    this.refreshBoard();
    this.render();
    return true;
  }

  private onBoardSelect(id: SectorId): void {
    if (this.actionBusy || this.resolving) return;
    const state = this.controller.state;
    const s = state.sectors[id];
    if (!s) return;

    const mine = s.gangIds.filter(
      (g) =>
        state.gangs[g]?.ownerId === this.controller.humanId &&
        (state.gangs[g]?.hp ?? 0) > 0,
    );

    const gangStillValid =
      !!this.selectedGang &&
      state.gangs[this.selectedGang]?.ownerId === this.controller.humanId &&
      state.gangs[this.selectedGang]!.hp > 0;

    // Hire drawer open → board picks are deploy targets only (no accidental move/claim).
    if (this.drawer === 'hire') {
      this.selected = id;
      if (mine.length > 0) {
        const free = mine.find((gid) => !state.orders.some((o) => o.gangId === gid));
        this.selectedGang = free ?? mine[0]!;
      } else {
        this.selectedGang = null;
      }
      const owned = s.owner === this.controller.humanId;
      this.statusMsg = owned
        ? `Hire deploys to block ${id}. Pick a crew card to hire.`
        : `Block ${id} is not yours — click an owned block, then hire.`;
      this.refreshBoard();
      this.board?.focusSector(id);
      this.render();
      SFX.play(owned ? 'ui' : 'error');
      return;
    }

    // Click the pending order's destination (or origin) to cancel
    if (gangStillValid) {
      const pending = state.orders.find(
        (o) => o.gangId === this.selectedGang && o.playerId === this.controller.humanId,
      );
      if (pending) {
        const gang = state.gangs[this.selectedGang!]!;
        if (id === pending.targetSectorId || id === gang.sectorId) {
          this.cancelGangOrder(this.selectedGang!);
          return;
        }
      }
    }

    // ── Move / claim / attack onto legal neighbors (even if friendly crews stand there) ──
    // Previously we always selected stacked crews on your tiles, so "move onto ally tile"
    // was impossible — click only swapped selection.
    if (gangStillValid) {
      const gang = state.gangs[this.selectedGang!]!;
      const alreadyOrdered = state.orders.some((o) => o.gangId === gang.id);
      if (
        !alreadyOrdered &&
        id !== gang.sectorId &&
        areAdjacent(gang.sectorId, id)
      ) {
        if (!s.owner) {
          this.tryAutoOrder('claim', gang.id, id);
          return;
        }
        if (s.owner === this.controller.humanId) {
          this.tryAutoOrder('move', gang.id, id);
          return;
        }
        this.tryAutoOrder('attack', gang.id, id);
        return;
      }
    }

    // ── No legal order: select / cycle YOUR crews on this tile ──
    if (mine.length > 0) {
      this.selected = id;
      if (this.selectedGang && mine.includes(this.selectedGang)) {
        // Same tile again → cycle through stacked crews
        const idx = mine.indexOf(this.selectedGang);
        this.selectedGang = mine[(idx + 1) % mine.length]!;
      } else {
        // Prefer a crew that still needs an order
        const free = mine.find((gid) => !state.orders.some((o) => o.gangId === gid));
        this.selectedGang = free ?? mine[0]!;
      }
      this.statusMsg = this.describeSelection();
      if (this.selectedGang && this.coachStep === 0) this.advanceCoach();
      this.refreshBoard();
      this.board?.focusSector(id);
      this.render();
      SFX.play('ui');
      return;
    }

    // Just focus the sector (no crew here) — clear crew pick so hire/deploy matches the tile
    this.selected = id;
    this.selectedGang = null;
    this.statusMsg = this.describeSelection();
    this.refreshBoard();
    this.board?.focusSector(id);
    this.render();
    SFX.play('ui');
  }

  /** Living human crews with no order yet (guide queue). */
  private freeCrewIds(): string[] {
    const state = this.controller.state;
    const human = this.controller.humanId;
    return Object.values(state.gangs)
      .filter(
        (g) =>
          g.ownerId === human &&
          g.hp > 0 &&
          !state.orders.some((o) => o.gangId === g.id),
      )
      .sort((a, b) => a.sectorId.localeCompare(b.sectorId))
      .map((g) => g.id);
  }

  /** Direct crew pick from board portrait or side panel. */
  private selectGangById(gid: string): void {
    if (this.actionBusy || this.resolving) return;
    const g = this.controller.state.gangs[gid];
    if (!g || g.ownerId !== this.controller.humanId || g.hp <= 0) return;
    this.selectedGang = gid;
    this.selected = g.sectorId;
    this.statusMsg = this.describeSelection();
    this.refreshBoard();
    this.board?.focusSector(g.sectorId);
    this.render();
    SFX.play('ui');
    if (this.coachStep === 0) this.advanceCoach();
  }

  /** Focus a free crew without clobbering guide status. */
  private focusCrewForGuide(gid: string, status: string, playUi = true): void {
    const g = this.controller.state.gangs[gid];
    if (!g || g.ownerId !== this.controller.humanId || g.hp <= 0) return;
    this.selectedGang = gid;
    this.selected = g.sectorId;
    this.statusMsg = status;
    this.refreshBoard();
    this.board?.focusSector(g.sectorId);
    this.render(true);
    if (playUi) SFX.play('ui');
    if (this.coachStep === 0) this.advanceCoach();
  }

  /** Start / resume guided walkthrough of free crews. */
  private startOrderGuide(): void {
    if (this.actionBusy || this.resolving) return;
    const free = this.freeCrewIds();
    if (free.length === 0) {
      this.statusMsg = 'All crews already have orders — End turn when ready.';
      SFX.play('ui');
      this.orderGuide = false;
      this.render();
      return;
    }
    this.orderGuide = true;
    const start =
      this.selectedGang && free.includes(this.selectedGang)
        ? this.selectedGang
        : free[0]!;
    const name = gangDefById(this.controller.state.gangs[start]!.defId).name;
    this.focusCrewForGuide(
      start,
      `Order guide · 1 of ${free.length} free — ${name}. Green tiles or Skip.`,
    );
  }

  /**
   * Next free crew after ordering `orderedId`.
   * Must run immediately so selectedGang matches the guide card
   * (which hides ordered crews from the free list).
   */
  private nextFreeAfter(orderedId: string | null): string | null {
    const free = this.freeCrewIds().filter((id) => id !== orderedId);
    if (free.length === 0) return null;
    if (!orderedId) return free[0]!;
    const ordered = this.controller.state.gangs[orderedId];
    if (!ordered) return free[0]!;
    // Prefer next by sector sort (same order as freeCrewIds)
    const after = free.find((id) => {
      const g = this.controller.state.gangs[id]!;
      const cmp = g.sectorId.localeCompare(ordered.sectorId);
      return cmp > 0 || (cmp === 0 && id > orderedId);
    });
    return after ?? free[0]!;
  }

  /** Jump to next free crew (Skip), or after an order for orderedId. */
  private guideNextCrew(skipCurrent = false, orderedId?: string | null): void {
    const justOrdered = orderedId ?? (skipCurrent ? null : this.selectedGang);
    const free = this.freeCrewIds().filter((id) => id !== justOrdered);

    if (free.length === 0) {
      this.orderGuide = true; // keep card in "done" state
      if (justOrdered) this.selectedGang = justOrdered;
      this.statusMsg =
        'Order guide complete — all free crews have orders. End turn when ready.';
      this.refreshBoard();
      this.render(true);
      SFX.play('claim');
      return;
    }

    this.orderGuide = true;
    let next: string;
    if (skipCurrent && this.selectedGang && free.includes(this.selectedGang)) {
      const idx = free.indexOf(this.selectedGang);
      next = free[(idx + 1) % free.length]!;
    } else if (justOrdered) {
      next = this.nextFreeAfter(justOrdered)!;
    } else {
      next = free[0]!;
    }

    const pos = free.indexOf(next) + 1;
    const name = gangDefById(this.controller.state.gangs[next]!.defId).name;
    this.focusCrewForGuide(
      next,
      `Order guide · ${pos} of ${free.length} free — ${name}.`,
      true,
    );
  }

  /** Call right after any successful order while guide is on. */
  private advanceGuideAfterOrder(orderedGangId: string, brief: string): void {
    if (!this.orderGuide) return;
    const freeLeft = this.freeCrewIds().filter((id) => id !== orderedGangId);
    if (freeLeft.length === 0) {
      this.selectedGang = orderedGangId;
      const g = this.controller.state.gangs[orderedGangId];
      if (g) this.selected = g.sectorId;
      this.statusMsg = `${brief} · Guide complete — End turn when ready.`;
      this.refreshBoard();
      this.render(true);
      SFX.play('claim');
      return;
    }
    const next = this.nextFreeAfter(orderedGangId)!;
    const pos = freeLeft.indexOf(next) + 1;
    const name = gangDefById(this.controller.state.gangs[next]!.defId).name;
    this.selectedGang = next;
    this.selected = this.controller.state.gangs[next]!.sectorId;
    this.statusMsg = `${brief} · Guide → ${name} (${pos}/${freeLeft.length} free)`;
    this.refreshBoard();
    this.board?.focusSector(this.selected);
    this.render(true);
  }

  private stopOrderGuide(): void {
    this.orderGuide = false;
    this.statusMsg = 'Order guide closed. Use Your crews list or Guide again anytime.';
    this.render(true);
    SFX.play('ui');
  }

  /** Queue move/claim/attack when clicking a green neighbor — short travel FX first. */
  private tryAutoOrder(
    type: 'move' | 'claim' | 'attack',
    gangId: string,
    targetId: SectorId,
  ): void {
    if (this.actionBusy || this.resolving) return;
    const gang = this.controller.state.gangs[gangId];
    if (!gang) return;
    const from = gang.sectorId;
    this.selected = targetId;
    const name = gangDefById(gang.defId).name;
    const err = this.controller.orderForGang(type, gangId, targetId);
    if (err) {
      this.statusMsg = err;
      SFX.play('error');
      this.refreshBoard();
      this.render(true);
      return;
    }
    const verb =
      type === 'claim' ? 'CLAIM' : type === 'move' ? 'MOVE' : 'ATTACK';
    this.actionBusy = true;
    this.board?.setHighlights([]);
    this.board?.playTravelFx(from, targetId, type, false);
    // Advance guide immediately so UI/selection match the next free crew
    // (don't wait for FX timeout — that left selectedGang on the ordered crew)
    if (this.orderGuide) {
      this.advanceGuideAfterOrder(gangId, `${verb} ordered: ${name}`);
    } else {
      this.statusMsg = `${verb}… ${name}`;
      this.render(true);
    }
    SFX.play(type === 'attack' ? 'attack' : type === 'claim' ? 'claim' : 'ui');
    window.setTimeout(() => {
      this.actionBusy = false;
      if ((type === 'claim' || type === 'move') && this.coachStep <= 1) {
        this.advanceCoach();
      }
      if (!this.orderGuide) {
        this.statusMsg = `${verb} ordered: ${name} → ${targetId}. END TURN to resolve · Cancel / Esc to undo.`;
        this.refreshBoard();
        this.render(true);
      } else {
        // Refresh dest highlights for the newly selected free crew
        this.refreshBoard();
        this.render(true);
      }
    }, ORDER_FX_MS);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((r) => window.setTimeout(r, ms));
  }

  private async playTurnReel(
    actions: TurnActionFx[],
    combats: import('../../engine').CombatResult[],
  ): Promise<void> {
    // Cap reel length so long AI turns stay snappy
    const maxActions = 14;
    const list =
      actions.length > maxActions
        ? [
            ...actions.filter((a) => a.isHuman),
            ...actions
              .filter((a) => !a.isHuman)
              .slice(0, Math.max(0, maxActions - actions.filter((a) => a.isHuman).length)),
          ]
        : actions;

    // Non-attack actions first (board FX); attacks get full battle screens after
    for (const a of list.filter((x) => x.type !== 'attack')) {
      this.statusMsg = describeActionFx(a);
      this.render();
      const kind = (
        ['move', 'claim', 'scout', 'unrest', 'influence', 'research'] as ActionFxKind[]
      ).includes(a.type)
        ? (a.type as 'move' | 'claim' | 'scout' | 'unrest' | 'influence' | 'research')
        : 'move';
      this.board?.playTravelFx(a.from, a.to, kind, !a.isHuman);
      if (a.type === 'claim' || a.type === 'move') {
        this.board?.focusSector(a.to);
      }
      SFX.play(a.type === 'claim' ? 'claim' : a.type === 'unrest' ? 'unrest' : 'ui');
      await this.wait(REEL_STEP_MS);
    }

    // Full battle presentation for each fight (player can skip / skip all)
    this.combatSkipRemaining = false;
    this.combatSkipBatch = [];
    for (const c of combats) {
      if (this.combatSkipRemaining) {
        // Already queued current when Skip All was hit; collect the rest
        if (!this.combatSkipBatch.includes(c)) this.combatSkipBatch.push(c);
        continue;
      }
      this.board?.focusSector(c.sectorId);
      this.board?.pulseTile(c.sectorId, 'attack', false);
      SFX.play('combat');
      await this.showBattleCard(c);
    }
    // One readable summary for everything Skip All deferred
    if (this.combatSkipBatch.length > 0) {
      const batch = this.combatSkipBatch;
      this.combatSkipBatch = [];
      this.combatSkipRemaining = false;
      await this.showCombatSkipSummary(batch);
    }
  }

  /** Adjacent tiles this crew can Move/Claim/Attack into (none once they already have an order). */
  private validDestinations(): SectorId[] {
    const state = this.controller.state;
    const gang = this.selectedGang ? state.gangs[this.selectedGang] : null;
    if (!gang || gang.ownerId !== this.controller.humanId) return [];
    // Stop glowing once this crew already has a queued order
    if (state.orders.some((o) => o.gangId === gang.id)) return [];
    const { x, y } = (() => {
      const [a, b] = gang.sectorId.split(',').map(Number);
      return { x: a!, y: b! };
    })();
    const out: SectorId[] = [];
    for (const p of [
      { x: x - 1, y },
      { x: x + 1, y },
      { x, y: y - 1 },
      { x, y: y + 1 },
    ]) {
      if (p.x < 0 || p.y < 0 || p.x >= state.mapWidth || p.y >= state.mapHeight) continue;
      out.push(`${p.x},${p.y}`);
    }
    return out;
  }

  private describeSelection(): string {
    const state = this.controller.state;
    const gang = this.selectedGang ? state.gangs[this.selectedGang] : null;
    const target = this.selected ? state.sectors[this.selected] : null;

    if (!gang) {
      return 'Step 1: pick a crew from YOUR CREWS (right panel), or click a block they stand on.';
    }

    const name = gangDefById(gang.defId).name;
    const pending = this.controller.state.orders.find((o) => o.gangId === gang.id);
    if (pending?.targetSectorId) {
      return `${name}: ${pending.type.toUpperCase()} → ${pending.targetSectorId} queued. END TURN · or Cancel / Esc / re-click destination.`;
    }
    if (!target || this.selected === gang.sectorId) {
      return `${name} selected — click a GREEN neighbor to move/claim (one click).`;
    }
    if (!areAdjacent(gang.sectorId, this.selected!)) {
      return `${name} can only go to green neighbors of ${gang.sectorId}.`;
    }
    return `${name} ready for ${target.owner ? (target.owner === this.controller.humanId ? 'MOVE' : 'ATTACK') : 'CLAIM'} on ${this.selected}.`;
  }

  private onMusicTrack = (): void => {
    const el = this.root?.querySelector('#sl-now-playing .np-title') as HTMLElement | null;
    const wrap = this.root?.querySelector('#sl-now-playing') as HTMLElement | null;
    if (!el || !wrap) return;
    const np = SFX.getNowPlaying();
    el.textContent = np.title;
    wrap.classList.toggle('off', np.mode === 'off');
  };

  private teardown(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('sl-music-track', this.onMusicTrack);
    this.unsub?.();
    this.unsub = null;
    if (this.renderRaf != null) {
      cancelAnimationFrame(this.renderRaf);
      this.renderRaf = null;
    }
    this.board?.dispose();
    this.board = null;
    this.host?.remove();
    this.root?.remove();
    this.styleEl?.remove();
    this.game.canvas.style.display = '';
    try {
      (this.game.loop as { wake?: () => void }).wake?.();
    } catch {
      /* ignore */
    }
  }

  private coachActive(): boolean {
    return this.coachStep < TUTORIAL.length;
  }

  private renderCoachHtml(): string {
    if (!this.coachActive()) return '';
    const step = TUTORIAL[this.coachStep]!;
    const dots = TUTORIAL.map((_, i) => {
      const cls = i < this.coachStep ? 'done' : i === this.coachStep ? 'on' : '';
      return `<i class="${cls}"></i>`;
    }).join('');
    return `
      <div id="sl-coach" class="pe">
        <div class="coach-top">
          <span class="coach-step">FIELD GUIDE  //  ${this.coachStep + 1} / ${TUTORIAL.length}</span>
          <span class="coach-dots">${dots}</span>
        </div>
        <div class="coach-body">
          <h3 class="coach-title">${escapeHtml(step.title)}</h3>
          <p class="coach-text">${escapeHtml(step.body)}</p>
          <div class="coach-visual">${escapeHtml(step.visual)}</div>
        </div>
        <div class="coach-actions">
          <button class="act ghost" data-act="coach-skip"><span class="act-label">Skip guide</span></button>
          <button class="act primary" data-act="coach-next"><span class="act-label">Next tip</span></button>
        </div>
      </div>`;
  }

  private advanceCoach(): void {
    if (this.coachStep >= TUTORIAL.length) return;
    this.coachStep += 1;
    try {
      localStorage.setItem(
        COACH_KEY,
        this.coachStep >= TUTORIAL.length ? 'done' : String(this.coachStep),
      );
    } catch {
      /* ignore */
    }
    // Don't force full re-render here if caller already will — but board hints need update
    this.applyTutorialBoardHints();
  }

  private skipCoach(): void {
    this.coachStep = 99;
    try {
      localStorage.setItem(COACH_KEY, 'done');
    } catch {
      /* ignore */
    }
    this.board?.setTutorialHighlights([]);
    this.render();
    this.refreshBoard();
  }

  /**
   * Schedule a HUD rebuild. Multiple calls in the same frame collapse to one
   * write (big INP win when board select + status + coach all fire together).
   */
  private render(immediate = false): void {
    if (immediate) {
      if (this.renderRaf != null) {
        cancelAnimationFrame(this.renderRaf);
        this.renderRaf = null;
      }
      this.paintHud();
      return;
    }
    if (this.renderRaf != null) return;
    this.renderRaf = requestAnimationFrame(() => {
      this.renderRaf = null;
      this.paintHud();
    });
  }

  private paintHud(): void {
    if (!this.root) return;
    const state = this.controller.state;
    const me = state.players[this.controller.humanId]!;
    const paths = pathsToVictory(state);
    const myScore = paths.scores.find((s) => s.playerId === this.controller.humanId);
    const scen = scenarioById(state.scenarioId);
    const fc = this.controller.forecast();
    const side = this.renderSidePanel();
    const actions = this.contextActions();
    const drawer = this.renderDrawer();

    const nextCash = fc.projectedCash[me.id] ?? me.cash;
    const incomeBr = computeIncomeBreakdown(state, me.id);
    this.root.innerHTML = `
      <div id="sl-top" class="pe">
        <div id="sl-brand">
          <h1>SECTOR LORDS</h1>
          <p>${escapeHtml(scen.name)}  //  ${escapeHtml(state.difficulty)}</p>
          <div class="brand-audio">
            <button type="button" class="audio-tog${SFX.isEnabled() ? ' on' : ''}" data-act="sfx-toggle" title="Toggle sound effects">
              <span class="audio-lbl">SFX</span>
              <span class="audio-state">${SFX.isEnabled() ? 'ON' : 'OFF'}</span>
            </button>
            <button type="button" class="audio-tog music${SFX.isMusicEnabled() ? ' on' : ''}" data-act="music-toggle" title="Toggle music">
              <span class="audio-lbl">MUSIC</span>
              <span class="audio-state">${SFX.isMusicEnabled() ? 'ON' : 'OFF'}</span>
            </button>
          </div>
          <div id="sl-now-playing" class="now-playing${SFX.isMusicEnabled() ? '' : ' off'}" title="Now playing">
            <span class="np-icon" aria-hidden="true">♪</span>
            <span class="np-title">${escapeHtml(SFX.getNowPlaying().title)}</span>
          </div>
        </div>
        <div id="sl-stats">
          <div class="stat" title="${escapeHtml(paths.label)}"><span class="lbl">Turn</span><span class="val">${
            state.victory.type === 'elimination'
              ? state.turn
              : `${state.turn}/${'turns' in state.victory ? state.victory.turns : '—'}`
          }</span></div>
          <div class="stat" title="Territory $${incomeBr.territory} · Sites $${incomeBr.sites} · Unrest $${incomeBr.unrest} · Landmarks $${incomeBr.landmarks}"><span class="lbl">Cash</span><span class="val">$${me.cash}<small>→$${nextCash}</small></span></div>
          <div class="stat"><span class="lbl">Support</span><span class="val">${me.support}</span></div>
          <div class="stat"><span class="lbl">Heat</span><span class="val">${state.cityHeat}<small>${escapeHtml(fc.policeRisk)}</small></span></div>
          <div class="stat goal-stat" title="${escapeHtml(paths.label)}"><span class="lbl">Goal</span><span class="val">${myScore?.value ?? 0}<small>${escapeHtml(paths.label)}</small></span></div>
        </div>
      </div>
      ${this.renderCoachHtml()}
      <button
        type="button"
        id="sl-side-fab"
        class="pe${this.sideMobileOpen ? ' is-open' : ''}"
        data-act="side-mobile-toggle"
        title="Crew panel"
        aria-expanded="${this.sideMobileOpen ? 'true' : 'false'}"
      >
        <span class="fab-label">${this.sideMobileOpen ? 'Close' : 'Crew'}</span>
      </button>
      <div id="sl-side" class="pe${this.sideMobileOpen ? ' is-open' : ''}">
        <button type="button" class="sl-side-close" data-act="side-mobile-toggle" title="Close panel" aria-label="Close crew panel">✕</button>
        ${side}
      </div>
      <div id="sl-drawer" class="pe ${this.drawer !== 'none' ? 'open' : ''} ${this.drawer === 'hire' ? 'hire-wide' : ''}">${drawer}</div>
      <div id="sl-bottom" class="pe">
        <div id="sl-status">${escapeHtml(this.statusMsg)}</div>
        ${this.renderEndTurnIdleWarn()}
        <div id="sl-actions">
          ${actions
            .map((a) => {
              const sub = a.sub
                ? `<span class="act-sub">${escapeHtml(a.sub)}</span>`
                : '';
              return `<button class="act ${a.cls ?? ''}" data-act="${a.id}" ${a.disabled ? 'disabled' : ''}>
                <span class="act-label">${escapeHtml(a.label)}</span>${sub}
              </button>`;
            })
            .join('')}
        </div>
        <div id="sl-hint">One order per crew · green = move/claim/attack · Influence = business bonus · Esc cancel</div>
      </div>
    `;

    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('button[data-act]')) {
      btn.onclick = () => this.onAction(btn.dataset.act!);
    }
    this.applyTutorialUiHints();
    this.applyTutorialBoardHints();
    // Keep selected crew visible without forcing smooth scroll every paint
    const row = this.root.querySelector(
      '#sl-gang-pick .gang-pick.selected',
    ) as HTMLElement | null;
    if (row) {
      const list = this.root.querySelector('#sl-gang-pick') as HTMLElement | null;
      if (list) {
        const lr = list.getBoundingClientRect();
        const rr = row.getBoundingClientRect();
        if (rr.top < lr.top || rr.bottom > lr.bottom) {
          row.scrollIntoView({ block: 'nearest' });
        }
      }
    }
  }

  private renderSidePanel(): string {
    const state = this.controller.state;
    const human = this.controller.humanId;
    const me = state.players[human]!;

    const myGangs = Object.values(state.gangs).filter(
      (g) => g.ownerId === human && g.hp > 0,
    );

    const gang = this.selectedGang ? state.gangs[this.selectedGang] : null;
    const def = gang ? gangDefById(gang.defId) : null;
    const pending = gang
      ? state.orders.find((o) => o.gangId === gang.id)
      : null;

    // ── Sticky selected-crew dock (always top of panel) ──
    const crewDock = this.renderCrewDock(gang, def, pending, me);
    const orderGuideCard = this.renderOrderGuideCard();
    // Primary: what can THIS crew do right now (move / influence / unrest)
    const turnCard = this.renderCrewTurnCard(gang, def, pending, human);

    // ── Filtered / sorted roster ──
    const freeCount = myGangs.filter(
      (g) => !state.orders.some((o) => o.gangId === g.id),
    ).length;
    const orderedCount = myGangs.length - freeCount;
    const hereCount = this.selected
      ? myGangs.filter((g) => g.sectorId === this.selected).length
      : 0;

    let listed = myGangs.slice();
    if (this.crewFilter === 'free') {
      listed = listed.filter((g) => !state.orders.some((o) => o.gangId === g.id));
    } else if (this.crewFilter === 'ordered') {
      listed = listed.filter((g) => state.orders.some((o) => o.gangId === g.id));
    } else if (this.crewFilter === 'here' && this.selected) {
      listed = listed.filter((g) => g.sectorId === this.selected);
    }
    // Selected first, then free, then by sector id
    listed.sort((a, b) => {
      if (a.id === this.selectedGang) return -1;
      if (b.id === this.selectedGang) return 1;
      const ao = state.orders.some((o) => o.gangId === a.id) ? 1 : 0;
      const bo = state.orders.some((o) => o.gangId === b.id) ? 1 : 0;
      if (ao !== bo) return ao - bo;
      return a.sectorId.localeCompare(b.sectorId);
    });

    const filters = `
      <div class="crew-filters">
        <button type="button" class="crew-filter${this.crewFilter === 'all' ? ' on' : ''}" data-act="crew-filter-all">All ${myGangs.length}</button>
        <button type="button" class="crew-filter${this.crewFilter === 'free' ? ' on' : ''}" data-act="crew-filter-free">Free ${freeCount}</button>
        <button type="button" class="crew-filter${this.crewFilter === 'ordered' ? ' on' : ''}" data-act="crew-filter-ordered">Ordered ${orderedCount}</button>
        <button type="button" class="crew-filter${this.crewFilter === 'here' ? ' on' : ''}" data-act="crew-filter-here" ${hereCount ? '' : 'disabled'}>Here ${hereCount}</button>
      </div>`;

    const roster =
      listed.length > 0
        ? `<div id="sl-gang-pick">${listed
            .map((g) => {
              const d = gangDefById(g.defId);
              const img = `/${(d.art.portrait ?? 'assets/portraits/neon_jackals.jpg').replace(/^\//, '')}`;
              const sel = g.id === this.selectedGang ? ' selected' : '';
              const ord = state.orders.find((o) => o.gangId === g.id);
              const gearN = g.equipped?.length ?? 0;
              const orderLine = ord
                ? `<span class="gp-order">${this.orderPlainLabel(ord)}</span>`
                : `<span class="gp-meta">Block ${g.sectorId} · HP ${g.hp}${gearN ? ` · ${gearN} gear` : ''}</span>`;
              return `<button type="button" class="act gang-pick${sel}${ord ? ' has-order' : ''}" data-act="pick-gang-${g.id}" data-gang-row="${g.id}" title="Select ${escapeHtml(d.name)}">
                <img src="${img}" alt="" />
                <span class="gp-text">
                  <span class="gp-name">${escapeHtml(d.name)}</span>
                  ${orderLine}
                </span>
              </button>`;
            })
            .join('')}</div>`
        : `<p class="body-text">${
            myGangs.length === 0
              ? 'No crews yet — open Hire.'
              : 'No crews match this filter.'
          }</p>`;

    const rackets = summarizeEmpireRackets(state, human);
    const racketBody =
      rackets.siteCount > 0
        ? `<div class="racket-summary">
             <div class="row"><span>Influenced sites</span><b>${rackets.siteCount}</b></div>
             <div class="row"><span>Site cash / turn</span><b>+$${rackets.cashPerTurn}</b></div>
             <div class="row"><span>Support / turn</span><b>+${rackets.supportPerTurn}</b></div>
             ${rackets.researchPerTurn ? `<div class="row"><span>Lab research</span><b>+${rackets.researchPerTurn}</b></div>` : ''}
           </div>
           <p class="body-text site-help">Rackets pay every End Turn while you hold influence.</p>`
        : '';

    // Block intel when looking at a tile (enemies / unrest). Businesses live in turn card when acting.
    let blockBody = '';
    if (this.selected) {
      const s = state.sectors[this.selected]!;
      const owner = s.owner ? state.players[s.owner]?.name : 'Neutral';
      const crewHere = gang && gang.sectorId === s.id;
      const showSitesHere =
        !crewHere || !!pending || s.owner !== human; // avoid duplicating work-sites block

      const othersHere = s.gangIds
        .filter((gid) => state.gangs[gid]?.ownerId !== human)
        .map((gid) => {
          const g = state.gangs[gid]!;
          const d = gangDefById(g.defId);
          return `<div class="gang-line">${escapeHtml(d.name)} · ${escapeHtml(state.players[g.ownerId]?.name ?? '?')} · HP ${g.hp}</div>`;
        })
        .join('');

      const siteBlock =
        showSitesHere && s.sites.length
          ? `<p class="body-text site-help">${
              s.owner === human
                ? 'Park a free crew here, then Influence to lock a passive bonus.'
                : s.owner
                  ? 'Rival turf — claim or attack first, then influence sites.'
                  : 'Neutral block — Claim it, then influence its businesses.'
            }</p>
             <div class="site-card-list">${this.renderSiteCards(s, false)}</div>`
          : '';

      blockBody = `
        <div class="row"><span>Owner</span><b>${escapeHtml(owner ?? 'Neutral')}</b></div>
        <div class="row"><span>Unrest</span><b>${s.unrest} / 10</b></div>
        ${s.landmark ? `<div class="tag">★ ${escapeHtml(s.landmark.name)}</div>` : ''}
        ${othersHere ? `<div class="body-text" style="margin-top:8px"><b>Enemies here</b></div>${othersHere}` : ''}
        ${siteBlock}`;
    }

    const guideSec = orderGuideCard
      ? this.sideSection('guide', 'Order guide', orderGuideCard)
      : '';
    const turnSec = this.sideSection('turn', 'This crew · order', turnCard);
    const rosterSec = this.sideSection(
      'crews',
      `Your crews · ${myGangs.length}`,
      `${filters}${roster}`,
    );
    const racketSec =
      rackets.siteCount > 0
        ? this.sideSection('rackets', 'Empire rackets', racketBody)
        : '';
    const blockSec = blockBody
      ? this.sideSection('inspect', `Inspect · ${this.selected}`, blockBody)
      : '';

    return `
      ${crewDock}
      ${guideSec}
      ${turnSec}
      ${rosterSec}
      ${racketSec}
      ${blockSec}
    `;
  }

  /** Collapsible side-panel section with − / + control. */
  private sideSection(id: string, title: string, body: string): string {
    const collapsed = !!this.sideCollapsed[id];
    return `<section class="side-sec${collapsed ? ' is-collapsed' : ''}" data-sec="${escapeHtml(id)}">
      <button type="button" class="side-sec-toggle" data-act="side-collapse-${escapeHtml(id)}" aria-expanded="${collapsed ? 'false' : 'true'}">
        <span class="side-sec-title">${escapeHtml(title)}</span>
        <span class="side-sec-icon" aria-hidden="true">${collapsed ? '+' : '−'}</span>
      </button>
      <div class="side-sec-body">${body}</div>
    </section>`;
  }

  private toggleSideSection(id: string): void {
    this.sideCollapsed[id] = !this.sideCollapsed[id];
    saveSideCollapsed(this.sideCollapsed);
    this.render();
    SFX.play('ui');
  }

  /** Plain-language order summary for roster / dock. */
  private orderPlainLabel(ord: Order): string {
    const t = ord.type;
    if (t === 'influence') {
      const g = this.controller.state.gangs[ord.gangId];
      const sector = g ? this.controller.state.sectors[g.sectorId] : null;
      const site =
        sector && ord.siteSlot !== undefined ? sector.sites[ord.siteSlot] : null;
      const name = site ? siteDefById(site.defId).name : 'site';
      return `INFLUENCE ${name}`;
    }
    if (t === 'research') {
      const name = ord.itemId ? itemDefById(ord.itemId).name : 'tech';
      return `RESEARCH ${name}`;
    }
    if (t === 'unrest') return 'UNREST (here)';
    if (t === 'scout') return `SCOUT → ${ord.targetSectorId ?? '…'}`;
    if (t === 'claim') return `CLAIM → ${ord.targetSectorId ?? '…'}`;
    if (t === 'attack') return `ATTACK → ${ord.targetSectorId ?? '…'}`;
    if (t === 'move') return `MOVE → ${ord.targetSectorId ?? '…'}`;
    return `${t.toUpperCase()}${ord.targetSectorId ? ` → ${ord.targetSectorId}` : ''}`;
  }

  /**
   * Primary side-panel card: one order per crew, with move destinations
   * and influence sites promoted (not buried under the roster).
   */
  private renderCrewTurnCard(
    gang: GangInstance | null | undefined,
    def: ReturnType<typeof gangDefById> | null,
    pending: Order | null | undefined,
    human: string,
  ): string {
    if (!gang || !def) {
      return `<div id="sl-turn-card" class="idle">
        <div class="turn-kicker">// CREW ORDER</div>
        <strong>Pick a crew</strong>
        <p class="body-text">Each crew gets <b>one order</b> per turn. Click a portrait on the board or a roster row.</p>
      </div>`;
    }

    if (pending) {
      return `<div id="sl-turn-card" class="ordered">
        <div class="turn-kicker">// ORDER LOCKED</div>
        <strong>${escapeHtml(def.name)}</strong>
        <div class="order-detail">${escapeHtml(this.orderPlainLabel(pending))}</div>
        <p class="body-text">Resolves on <b>End Turn</b>. Cancel to free this crew for a different action.</p>
        <button class="act danger cancel-order-btn" data-act="cancel-order-${gang.id}" type="button" style="width:100%;margin-top:6px">
          <span class="act-label">Cancel order</span>
          <span class="act-sub">Esc · re-click destination</span>
        </button>
      </div>`;
    }

    const state = this.controller.state;
    const sector = state.sectors[gang.sectorId]!;
    const onOwn = sector.owner === human;
    const dests = this.validDestinations();
    const destBtns = dests
      .map((did) => {
        const t = state.sectors[did]!;
        const kind = !t.owner
          ? 'CLAIM'
          : t.owner === human
            ? 'MOVE'
            : 'ATTACK';
        const cls =
          kind === 'ATTACK' ? 'danger' : kind === 'CLAIM' ? 'primary' : '';
        const gloss =
          kind === 'CLAIM'
            ? 'Take empty block'
            : kind === 'ATTACK'
              ? 'Fight for block'
              : 'Friendly block';
        return `<button type="button" class="act dest-quick ${cls}" data-act="dest-${did}" title="${gloss}">
          <span class="act-label">${kind} ${did}</span>
          <span class="act-sub">${gloss}</span>
        </button>`;
      })
      .join('');

    const openSites = onOwn
      ? sector.sites.filter((s) => s.influencer !== human).length
      : 0;
    const workSites =
      onOwn && sector.sites.length > 0
        ? `<div id="sl-crew-work" class="turn-work">
            <div class="turn-subhead">Work a business <em>· uses this order</em></div>
            <p class="body-text site-help">Influence = permanent passive bonus every End Turn (cash, heal, research, combat). You must <b>own</b> the block and have a <b>free crew standing on it</b>.</p>
            <div class="site-card-list">${this.renderSiteCards(sector, true)}</div>
          </div>`
        : onOwn
          ? `<p class="body-text">No businesses on this block.</p>`
          : `<p class="body-text site-help">Influence only works on <b>your</b> turf. Claim or move onto an owned block first.</p>`;

    return `<div id="sl-turn-card" class="ready">
      <div class="turn-kicker">// ONE ORDER THIS TURN</div>
      <strong>${escapeHtml(def.name)}</strong>
      <p class="body-text turn-rule">Choose <b>one</b>: move/claim/attack a neighbor, influence a business here, raise unrest, or research (Tech).</p>

      <div class="turn-subhead">Send them <em>· green tiles on map</em></div>
      ${
        destBtns
          ? `<div class="dest-quick-list">${destBtns}</div>`
          : `<p class="body-text">No legal neighbors from ${gang.sectorId}.</p>`
      }

      ${workSites}

      ${
        onOwn
          ? `<button type="button" class="act" data-act="unrest" style="width:100%;margin-top:8px" ${
              this.actionBusy || this.resolving ? 'disabled' : ''
            }>
              <span class="act-label">Raise unrest</span>
              <span class="act-sub">Cash now · heat later · uses this order</span>
            </button>`
          : ''
      }
      ${
        openSites > 0
          ? `<p class="body-text turn-foot">${openSites} business${openSites === 1 ? '' : 'es'} still open on this block.</p>`
          : ''
      }
    </div>`;
  }

  /** Site / business cards for a sector. `canAct` = free crew may influence. */
  private renderSiteCards(
    sector: GameState['sectors'][string],
    canAct: boolean,
  ): string {
    const human = this.controller.humanId;
    const state = this.controller.state;
    const busy = this.actionBusy || this.resolving;
    return sector.sites
      .map((site, slot) => {
        const sd = siteDefById(site.defId);
        const bonus = formatSiteBonuses(sd);
        const isMine = site.influencer === human;
        const rival =
          site.influencer && site.influencer !== human
            ? state.players[site.influencer]?.name ?? 'Rival'
            : null;
        const holder = isMine ? 'YOURS' : rival ? escapeHtml(rival) : 'OPEN';
        const holderCls = isMine ? 'mine' : rival ? 'rival' : 'open';
        let action = '';
        if (isMine) {
          action = `<span class="site-badge owned">Paying you</span>`;
        } else if (canAct && !busy) {
          const verb = rival ? 'Contest' : 'Influence';
          action = `<button class="act site-inf primary" data-act="influence-slot-${slot}" type="button">
            <span class="act-label">${verb} · costs order</span>
            <span class="act-sub">${escapeHtml(formatSiteBonusShort(sd))} every turn</span>
          </button>`;
        } else if (rival) {
          action = `<span class="site-badge rival">Held by ${escapeHtml(rival)}</span>`;
        } else {
          action = `<span class="site-badge open">Open — need free crew here</span>`;
        }
        return `<div class="site-card ${holderCls}${canAct && !isMine ? ' actionable' : ''}">
          <div class="site-card-head">
            <span class="site-name">${escapeHtml(sd.name)}</span>
            <span class="site-holder">${holder}</span>
          </div>
          <p class="site-desc">${escapeHtml(sd.description)}</p>
          <p class="site-bonus">${escapeHtml(bonus)}</p>
          ${action}
        </div>`;
      })
      .join('');
  }

  /**
   * Guided walkthrough card — steps free crews so multi-gang turns
   * don't require hunting the roster.
   */
  private renderOrderGuideCard(): string {
    const free = this.freeCrewIds();
    const totalMine = Object.values(this.controller.state.gangs).filter(
      (g) => g.ownerId === this.controller.humanId && g.hp > 0,
    ).length;

    if (!this.orderGuide) {
      if (free.length === 0 || totalMine < 2) return '';
      return `<div id="sl-order-guide" class="idle">
        <div class="og-head">
          <span class="og-tag">ORDER GUIDE</span>
          <span class="og-count">${free.length} free</span>
        </div>
        <p class="og-copy">Walk through each free crew instead of hunting the list.</p>
        <button type="button" class="act primary" data-act="guide-start" style="width:100%">
          <span class="act-label">Start guide</span>
          <span class="act-sub">${free.length} crew${free.length === 1 ? '' : 's'} need orders</span>
        </button>
      </div>`;
    }

    if (free.length === 0) {
      return `<div id="sl-order-guide" class="done">
        <div class="og-head">
          <span class="og-tag">ORDER GUIDE</span>
          <span class="og-count">Done</span>
        </div>
        <p class="og-copy">Every free crew has an order. End turn when ready.</p>
        <div class="og-actions">
          <button type="button" class="act primary" data-act="end" style="flex:1">
            <span class="act-label">End turn</span>
          </button>
          <button type="button" class="act ghost" data-act="guide-stop" style="flex:1">
            <span class="act-label">Close</span>
          </button>
        </div>
      </div>`;
    }

    const curId =
      this.selectedGang && free.includes(this.selectedGang)
        ? this.selectedGang
        : free[0]!;
    const g = this.controller.state.gangs[curId]!;
    const d = gangDefById(g.defId);
    const img = `/${(d.art.portrait ?? 'assets/portraits/neon_jackals.jpg').replace(/^\//, '')}`;
    const pos = free.indexOf(curId) + 1;
    const dests = this.validDestinations();
    const human = this.controller.humanId;
    const destBtns = dests
      .map((did) => {
        const t = this.controller.state.sectors[did]!;
        const kind = !t.owner
          ? 'CLAIM'
          : t.owner === human
            ? 'MOVE'
            : 'ATTACK';
        const cls =
          kind === 'ATTACK' ? 'danger' : kind === 'CLAIM' ? 'primary' : '';
        return `<button type="button" class="act dest-quick ${cls}" data-act="dest-${did}">
          <span class="act-label">${kind} ${did}</span>
        </button>`;
      })
      .join('');

    return `<div id="sl-order-guide" class="active">
      <div class="og-head">
        <span class="og-tag">ORDER GUIDE</span>
        <span class="og-count">${pos} / ${free.length} free</span>
      </div>
      <div class="og-crew">
        <img src="${img}" alt="" />
        <div>
          <div class="og-name">${escapeHtml(d.name)}</div>
          <div class="og-meta">At ${g.sectorId} · HP ${g.hp} · pick a green tile or button</div>
        </div>
      </div>
      <div class="og-progress" aria-hidden="true">
        <i style="width:${Math.round((pos / free.length) * 100)}%"></i>
      </div>
      ${
        destBtns
          ? `<div class="dest-quick-list">${destBtns}</div>`
          : `<p class="og-copy">No legal neighbors — Skip or use Unrest / Influence / Research.</p>`
      }
      <div class="og-actions">
        <button type="button" class="act" data-act="guide-next" style="flex:1">
          <span class="act-label">Skip →</span>
          <span class="act-sub">Next free crew</span>
        </button>
        <button type="button" class="act ghost" data-act="guide-stop" style="flex:1">
          <span class="act-label">Exit guide</span>
        </button>
      </div>
    </div>`;
  }

  /** Sticky focus card for the active crew + gear / stash. */
  private renderCrewDock(
    gang: GangInstance | null | undefined,
    def: ReturnType<typeof gangDefById> | null,
    pending: Order | null | undefined,
    me: PlayerState,
  ): string {
    if (!gang || !def) {
      return `<div id="sl-crew-dock" class="empty">
        <div class="dock-empty">No crew selected — click a portrait or roster row</div>
      </div>`;
    }

    const art = `/${(def.art.portrait ?? 'assets/portraits/neon_jackals.jpg').replace(/^\//, '')}`;
    const equipped = (gang.equipped ?? [])
      .map((id) => {
        const it = itemDefById(id);
        const icon = itemIconUrl(it);
        return `<button type="button" class="gear-chip on" data-act="unequip-${id}" title="Unequip ${escapeHtml(it.name)}">
          <img src="${icon}" alt="" class="gear-thumb" />
          <span class="gear-label">${escapeHtml(it.name)}</span>
          <span class="gear-x">✕</span>
        </button>`;
      })
      .join('');

    const stashIds = Object.keys(me.inventory ?? {}).filter(
      (id) => (me.inventory[id] ?? 0) > 0,
    );
    const stash = stashIds
      .map((id) => {
        const it = itemDefById(id);
        const n = me.inventory[id] ?? 0;
        const icon = itemIconUrl(it);
        return `<button type="button" class="gear-chip" data-act="equip-${id}" title="Equip ${escapeHtml(it.name)} on ${escapeHtml(def.name)}">
          <img src="${icon}" alt="" class="gear-thumb" />
          <span class="gear-label">${escapeHtml(it.name)}${n > 1 ? ` ×${n}` : ''}</span>
          <span class="gear-x">＋</span>
        </button>`;
      })
      .join('');

    const orderBit = pending
      ? `<span class="dock-order">${escapeHtml(this.orderPlainLabel(pending))}</span>`
      : `<span class="dock-free">Ready · one order</span>`;

    const dockCollapsed = !!this.sideCollapsed['crew'];
    const gearBody = `<div class="dock-gear">
        <div class="dock-gear-lbl">Equipped</div>
        <div class="dock-gear-row">${equipped || '<span class="dock-none">Bare — equip from stash</span>'}</div>
        <div class="dock-gear-lbl">Stash ${stashIds.length ? `(${stashIds.length})` : ''}</div>
        <div class="dock-gear-row">${
          stash ||
          '<span class="dock-none">Empty — Tech → Research → Fabricate</span>'
        }</div>
      </div>
      <div class="dock-actions">
        <button type="button" class="act" data-act="tech-open"><span class="act-label">Tech &amp; gear</span></button>
        <button type="button" class="act ghost" data-act="focus-crew-tile"><span class="act-label">Find on map</span></button>
      </div>`;

    // Hero portrait — full-bleed art so selected crew identity is obvious
    return `<div id="sl-crew-dock"${dockCollapsed ? ' class="is-collapsed"' : ''}>
      <div class="dock-hero">
        <img class="dock-art" src="${art}" alt="${escapeHtml(def.name)}" />
        <div class="dock-hero-fade" aria-hidden="true"></div>
        <div class="dock-hero-meta">
          <div class="dock-kicker">// SELECTED CREW</div>
          <div class="dock-name">${escapeHtml(def.name)}</div>
          <div class="dock-meta">Block ${gang.sectorId} · HP ${gang.hp} · C${def.combat}/D${def.defense}/T${def.tech}</div>
          ${orderBit}
        </div>
        <button type="button" class="dock-collapse" data-act="side-collapse-crew" title="${dockCollapsed ? 'Expand crew card' : 'Minimize crew card'}" aria-label="${dockCollapsed ? 'Expand' : 'Minimize'}">
          <span aria-hidden="true">${dockCollapsed ? '+' : '−'}</span>
        </button>
      </div>
      <div class="dock-lower">${gearBody}</div>
    </div>`;
  }

  /** Shared chrome for Hire / Jobs / Tech popups — always has a clear X. */
  private drawerChrome(title: string, sub: string, body: string): string {
    return `<div class="drawer-head">
        <div class="drawer-head-text">
          <h3>${escapeHtml(title)}</h3>
          ${sub ? `<p class="muted">${sub}</p>` : ''}
        </div>
        <button type="button" class="drawer-x" data-act="drawer-close" title="Close (Esc)" aria-label="Close">
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      <div class="drawer-body">${body}</div>`;
  }

  private renderDrawer(): string {
    const state = this.controller.state;
    const me = state.players[this.controller.humanId]!;
    if (this.drawer === 'hire') {
      const cash = me.cash;
      const deploy = this.hireDeploySector();
      const deployLine =
        deploy && 'sid' in deploy
          ? `Deploys to <b>block ${escapeHtml(deploy.sid)}</b> (${escapeHtml(deploy.reason)}). Click another owned tile to change — board clicks won’t move crews while hiring.`
          : deploy && 'error' in deploy
            ? escapeHtml(deploy.error)
            : `No owned block — claim turf before hiring.`;
      const cards = state.hirePool
        .map((h, i) => {
          const d = gangDefById(h.defId);
          const art = d.art.portrait
            ? `/${d.art.portrait.replace(/^\//, '')}`
            : '/assets/portraits/neon_jackals.jpg';
          const canAfford = cash >= d.hireCost;
          return `<button class="act hire-card" data-act="hire-${i}" ${canAfford ? '' : 'disabled'} title="${escapeHtml(d.description)}">
            <img src="${art}" alt="${escapeHtml(d.name)}" loading="lazy" />
            <div class="hire-meta">
              <div class="hire-name">${escapeHtml(d.name)}</div>
              <div class="hire-stats">C${d.combat} · D${d.defense} · T${d.tech} · upk $${d.upkeep}</div>
              <div class="hire-sig">${escapeHtml(d.signature)}</div>
              <div class="hire-cost">${canAfford ? `Hire $${d.hireCost}` : `Need $${d.hireCost}`}</div>
            </div>
          </button>`;
        })
        .join('');
      return this.drawerChrome(
        'Hire pool',
        `Cash <b>$${cash}</b>. ${deployLine}`,
        `<div id="sl-hire-grid">${cards || '<p class="muted">No crews available this turn.</p>'}</div>`,
      );
    }
    if (this.drawer === 'jobs') {
      const board = state.jobBoard
        .map((id, i) => {
          const j = jobDefById(id);
          return `<button class="act" data-act="job-${i}" style="width:100%;margin:4px 0;align-items:flex-start;text-align:left;text-transform:none;letter-spacing:0.02em">
            <span class="act-label" style="text-transform:none;letter-spacing:0.02em">${escapeHtml(j.name)}</span>
            <span class="act-sub">Reward $${j.rewardCash} · ${escapeHtml(j.description)}</span>
          </button>`;
        })
        .join('');
      const active = state.activeJobs
        .filter((j) => j.playerId === this.controller.humanId)
        .map((j) => {
          const d = jobDefById(j.defId);
          return `<div class="row"><span>${escapeHtml(d.name)}</span><b>${j.progress} / ${d.goalCount}</b></div>`;
        })
        .join('');
      return this.drawerChrome(
        'City jobs',
        'Take contracts for cash and progress. Esc or ✕ closes.',
        `${board || '<p class="muted">No contracts right now.</p>'}
        <h3 class="drawer-section">Active</h3>${active || '<p class="muted">None yet.</p>'}`,
      );
    }
    if (this.drawer === 'tech') {
      const gang = this.selectedGang ? state.gangs[this.selectedGang] : null;
      const gangName = gang ? gangDefById(gang.defId).name : null;

      let research = '<p class="muted">Select a crew first — research uses their Tech rating.</p>';
      if (gang && gang.ownerId === this.controller.humanId) {
        const opts = researchableItems(state, this.controller.humanId, gang.id);
        const cur = me.researchProgress
          ? (() => {
              const rit = itemDefById(me.researchProgress!.itemId);
              return `${rit.name} ${me.researchProgress!.points}/${rit.researchCost}`;
            })()
          : 'Idle';
        const progressArt = me.researchProgress
          ? `<img class="item-art bp" src="${itemBlueprintUrl(itemDefById(me.researchProgress.itemId))}" alt="" />`
          : '';
        research =
          `<p class="muted">Researching as <b>${escapeHtml(gangName!)}</b> (costs their action this turn).</p>
           <div class="row research-progress">${progressArt}<span>In progress</span><b>${escapeHtml(cur)}</b></div>
           <div class="item-card-list">` +
          (opts.length
            ? opts
                .slice(0, 8)
                .map((it) => {
                  const bp = itemBlueprintUrl(it);
                  return `<button class="act item-card research" data-act="research-${it.id}">
                    <img class="item-art bp" src="${bp}" alt="" loading="lazy" />
                    <span class="item-meta">
                      <span class="act-label" style="text-transform:none">Research ${escapeHtml(it.name)}</span>
                      <span class="act-sub">Blueprint · Tech ${it.techLevel} · ${it.researchCost} pts · ${it.type} · C+${it.combatBonus} D+${it.defenseBonus}</span>
                    </span>
                  </button>`;
                })
                .join('')
            : '<p class="muted">Nothing left to research for this crew\'s tech level.</p>') +
          `</div>`;
      }

      const fabricates = me.researchedItemIds
        .map((id) => {
          const it = itemDefById(id);
          const have = me.inventory[id] ?? 0;
          const can = me.cash >= it.fabricateCost;
          const icon = itemIconUrl(it);
          return `<button class="act item-card" data-act="fabricate-${id}" ${can ? '' : 'disabled'}>
            <img class="item-art" src="${icon}" alt="" loading="lazy" />
            <span class="item-meta">
              <span class="act-label" style="text-transform:none">Build ${escapeHtml(it.name)} · $${it.fabricateCost}</span>
              <span class="act-sub">${it.type} · stash ×${have} · C+${it.combatBonus} D+${it.defenseBonus}</span>
            </span>
          </button>`;
        })
        .join('');

      const stash = Object.keys(me.inventory)
        .filter((id) => (me.inventory[id] ?? 0) > 0)
        .map((id) => {
          const it = itemDefById(id);
          const n = me.inventory[id] ?? 0;
          const canEq = !!gang && gang.ownerId === this.controller.humanId;
          const icon = itemIconUrl(it);
          return `<button class="act primary item-card" data-act="equip-${id}" ${canEq ? '' : 'disabled'}>
            <img class="item-art" src="${icon}" alt="" loading="lazy" />
            <span class="item-meta">
              <span class="act-label" style="text-transform:none">Equip ${escapeHtml(it.name)}${n > 1 ? ` ×${n}` : ''}</span>
              <span class="act-sub">${canEq ? `On ${escapeHtml(gangName!)}` : 'Select a crew first'} · ${it.type}</span>
            </span>
          </button>`;
        })
        .join('');

      const worn =
        gang && gang.ownerId === this.controller.humanId
          ? (gang.equipped ?? [])
              .map((id) => {
                const it = itemDefById(id);
                const icon = itemIconUrl(it);
                return `<button class="act danger item-card" data-act="unequip-${id}">
                  <img class="item-art" src="${icon}" alt="" loading="lazy" />
                  <span class="item-meta">
                    <span class="act-label" style="text-transform:none">Unequip ${escapeHtml(it.name)}</span>
                    <span class="act-sub">Return to stash · ${it.type}</span>
                  </span>
                </button>`;
              })
              .join('') || '<p class="muted">Nothing equipped.</p>'
          : '<p class="muted">Select a crew to manage loadout.</p>';

      return this.drawerChrome(
        'Research & gear',
        `Cash <b>$${me.cash}</b> · <span class="tech-pipe">Blueprint</span> → <span class="tech-pipe">Fabricate</span> → <span class="tech-pipe">Equip</span>`,
        `<h3 class="drawer-section">1 · Research blueprints</h3>
        ${research}
        <h3 class="drawer-section">2 · Fabricate gear</h3>
        <div class="item-card-list">${fabricates || '<p class="muted">Research something first.</p>'}</div>
        <h3 class="drawer-section">3 · Equip on selected crew</h3>
        <div class="item-card-list">${stash || '<p class="muted">Stash empty — fabricate gear above.</p>'}</div>
        <h3 class="drawer-section">Worn now</h3>
        <div class="item-card-list">${worn}</div>`,
      );
    }
    return '';
  }

  private contextActions(): Array<{
    id: string;
    label: string;
    sub?: string;
    cls?: string;
    disabled?: boolean;
  }> {
    const state = this.controller.state;
    if (state.winnerId) {
      return [
        { id: 'debrief', label: 'Results', sub: 'See why you won or lost', cls: 'primary' },
        { id: 'menu', label: 'Menu', cls: 'ghost' },
      ];
    }

    const gang = this.selectedGang ? state.gangs[this.selectedGang] : null;
    const mine = gang?.ownerId === this.controller.humanId;
    const pending =
      mine && gang
        ? state.orders.find(
            (o) => o.gangId === gang.id && o.playerId === this.controller.humanId,
          )
        : undefined;
    const target = this.selected ? state.sectors[this.selected] : null;
    const canTarget =
      mine &&
      gang &&
      !pending &&
      target &&
      gang.sectorId !== this.selected &&
      areAdjacent(gang.sectorId, this.selected!);

    const claimOk = !!(canTarget && target && !target.owner);
    // Move: adjacent empty or own territory (not enemy-held)
    const moveOk = !!(
      canTarget &&
      target &&
      (!target.owner || target.owner === this.controller.humanId)
    );
    const attackOk = !!(
      canTarget &&
      target &&
      target.owner &&
      target.owner !== this.controller.humanId
    );
    const scoutOk = !!(canTarget && target);
    const onOwn =
      mine &&
      gang &&
      !pending &&
      state.sectors[gang.sectorId]?.owner === this.controller.humanId;

    const acts: Array<{
      id: string;
      label: string;
      sub?: string;
      cls?: string;
      disabled?: boolean;
    }> = [];

    // Prominent cancel when this crew already has a move/claim/attack/etc.
    if (pending && gang) {
      acts.push({
        id: `cancel-order-${gang.id}`,
        label: 'Cancel order',
        sub: `${pending.type.toUpperCase()} → ${pending.targetSectorId ?? '…'} · Esc`,
        cls: 'danger',
      });
    }

    // Manual buttons still available; primary path is click green tile
    if (mine && gang && moveOk) {
      acts.push({
        id: 'move',
        label: 'Move',
        sub: 'Or click the green tile',
        cls: claimOk ? undefined : 'primary',
        disabled: this.actionBusy || this.resolving,
      });
    }
    if (claimOk) {
      acts.push({
        id: 'claim',
        label: 'Claim',
        sub: 'Or click the green tile',
        cls: 'primary',
        disabled: this.actionBusy || this.resolving,
      });
    }
    if (attackOk) {
      const prev = previewAttackWithIntel(
        state,
        [gang!.id],
        this.selected!,
        this.controller.humanId,
      );
      acts.push({
        id: 'attack',
        label: 'Attack',
        sub: formatOdds(prev),
        cls: 'primary danger',
        disabled: this.actionBusy || this.resolving,
      });
    }
    if (scoutOk) {
      acts.push({
        id: 'scout',
        label: 'Scout',
        sub: claimOk || attackOk || moveOk ? 'Reveal intel' : 'Spy on this block',
        disabled: this.actionBusy || this.resolving,
      });
    }

    acts.push({
      id: 'unrest',
      label: 'Unrest',
      sub: 'Cash now, heat later',
      disabled: !onOwn || this.actionBusy || this.resolving,
    });

    // Influence: open side panel work-sites, or auto-commit if only one open site
    const ownSector =
      mine && gang ? state.sectors[gang.sectorId] : null;
    const openSites =
      ownSector?.owner === this.controller.humanId
        ? ownSector.sites.filter((s) => s.influencer !== this.controller.humanId).length
        : 0;
    acts.push({
      id: 'influence-hint',
      label: 'Influence',
      sub:
        openSites === 1
          ? '1 open site · click to order it'
          : openSites > 1
            ? `${openSites} open · pick site (costs order)`
            : onOwn
              ? 'All sites yours already'
              : 'Crew must stand on your block',
      cls: openSites > 0 ? 'primary' : undefined,
      disabled: openSites === 0 || !mine || !!pending || this.actionBusy || this.resolving,
    });

    // Meta / empire actions (not a crew order)
    acts.push({
      id: 'hire-open',
      label: 'Hire',
      sub: 'Recruit a crew',
      disabled: this.resolving,
    });
    acts.push({
      id: 'jobs-open',
      label: 'Jobs',
      sub: 'City contracts',
      cls: 'ghost',
      disabled: this.resolving,
    });
    acts.push({
      id: 'tech-open',
      label: 'Tech',
      sub: 'Research & gear',
      cls: 'ghost',
      disabled: this.resolving,
    });
    const freeN = this.freeCrewIds().length;
    // If idle warning is up but everyone now has orders, drop it
    if (this.endTurnConfirm && freeN === 0) this.endTurnConfirm = false;
    acts.push({
      id: this.endTurnConfirm ? 'end-confirm' : 'end',
      label: this.resolving
        ? 'Resolving…'
        : this.endTurnConfirm
          ? 'Confirm end'
          : 'End turn',
      sub: this.resolving
        ? 'Watch the city react'
        : this.endTurnConfirm
          ? `${freeN} still idle`
          : freeN > 0
            ? `${freeN} free · will warn`
            : 'Resolve all orders',
      cls: 'end-turn',
      disabled: this.resolving || this.actionBusy,
    });
    if (freeN > 0 && !this.orderGuide) {
      acts.push({
        id: 'guide-start',
        label: 'Order guide',
        sub: `${freeN} free crew${freeN === 1 ? '' : 's'}`,
        cls: 'primary',
        disabled: this.resolving || this.actionBusy,
      });
    } else if (this.orderGuide) {
      acts.push({
        id: 'guide-next',
        label: 'Next free',
        sub: freeN ? `${freeN} left` : 'Done',
        cls: 'primary',
        disabled: this.resolving || this.actionBusy,
      });
    }
    acts.push({
      id: 'board-view',
      label: this.board?.getViewMode() === 'flat' ? 'Flat map' : 'War table',
      sub:
        this.board?.getViewMode() === 'flat'
          ? 'Tilted table view'
          : 'Flat top-down',
      cls: 'ghost util',
      disabled: this.resolving,
    });
    acts.push({
      id: 'save',
      label: 'Save',
      sub: 'Checkpoint',
      cls: 'ghost util',
      disabled: this.resolving || this.actionBusy,
    });
    acts.push({
      id: 'export-save',
      label: 'Export',
      sub: '.json backup',
      cls: 'ghost util',
      disabled: this.resolving || this.actionBusy,
    });
    acts.push({ id: 'menu', label: 'Menu', cls: 'ghost util' });

    return acts;
  }

  private onAction(act: string): void {
    // Audio toggles always available (even mid-resolve)
    if (act === 'sfx-toggle') {
      void SFX.unlock().then(() => {
        SFX.setEnabled(!SFX.isEnabled());
        if (SFX.isEnabled()) SFX.play('ui');
        this.render();
      });
      return;
    }
    if (act === 'music-toggle') {
      void SFX.unlock().then(() => {
        const next = !SFX.isMusicEnabled();
        SFX.setMusicEnabled(next);
        if (next) SFX.startMusic();
        if (SFX.isEnabled()) SFX.play('ui');
        this.render();
      });
      return;
    }
    if (this.resolving || this.actionBusy) {
      if (act !== 'menu') return;
    }
    if (act === 'coach-next') {
      this.advanceCoach();
      this.refreshBoard();
      this.render();
      SFX.play('ui');
      return;
    }
    if (act === 'coach-skip') {
      this.skipCoach();
      SFX.play('ui');
      return;
    }
    if (act === 'drawer-close') {
      this.drawer = 'none';
      this.render();
      return;
    }
    if (act === 'hire-open') {
      this.drawer = this.drawer === 'hire' ? 'none' : 'hire';
      this.render();
      SFX.play('ui');
      return;
    }
    if (act === 'jobs-open') {
      this.drawer = this.drawer === 'jobs' ? 'none' : 'jobs';
      this.render();
      SFX.play('ui');
      return;
    }
    if (act === 'tech-open') {
      this.drawer = this.drawer === 'tech' ? 'none' : 'tech';
      this.render();
      SFX.play('ui');
      return;
    }
    if (act === 'guide-start') {
      this.endTurnConfirm = false;
      this.startOrderGuide();
      return;
    }
    if (act === 'guide-next') {
      this.guideNextCrew(true);
      return;
    }
    if (act === 'guide-stop') {
      this.stopOrderGuide();
      return;
    }
    if (act === 'board-view') {
      const mode = this.board?.toggleViewMode() ?? 'table';
      this.statusMsg =
        mode === 'flat'
          ? 'Board: flat top-down — easier to see the whole map and click tiles.'
          : 'Board: war table tilt — cinematic isometric view.';
      SFX.play('ui');
      this.render();
      return;
    }
    if (act === 'save') {
      this.statusMsg = this.controller.saveNow();
      SFX.play('ui');
      this.render();
      return;
    }
    if (act === 'export-save') {
      try {
        const blob = this.controller.exportSaveBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sector-lords-turn-${this.controller.state.turn}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.statusMsg = 'Save file downloaded — keep it safe.';
        SFX.play('ui');
      } catch {
        this.statusMsg = 'Export failed.';
        SFX.play('error');
      }
      this.render();
      return;
    }
    if (act === 'menu') {
      this.controller.persist();
      SFX.play('ui');
      this.teardown();
      this.scene.start('Menu');
      return;
    }
    if (act === 'debrief') {
      const d = this.controller.getDebrief();
      if (d) {
        void this.showEndingCard(d);
      } else {
        this.statusMsg = 'Game over';
        this.render();
      }
      return;
    }
    if (act === 'end') {
      this.requestEndTurn();
      return;
    }
    if (act === 'end-confirm') {
      this.endTurnConfirm = false;
      this.endTurn();
      return;
    }
    if (act === 'end-cancel') {
      this.endTurnConfirm = false;
      this.statusMsg = 'End turn cancelled — give free crews orders, or press End turn again when ready.';
      SFX.play('ui');
      this.render();
      return;
    }
    if (act.startsWith('hire-')) {
      const idx = Number(act.slice(5));
      this.doHire(idx);
      return;
    }
    if (act.startsWith('job-')) {
      const idx = Number(act.slice(4));
      const id = this.controller.state.jobBoard[idx];
      if (id) {
        const msg = this.controller.acceptJob(id);
        this.statusMsg = msg;
        SFX.play(msg.startsWith('Accepted') ? 'ui' : 'error');
        this.render();
      }
      return;
    }
    if (act.startsWith('research-')) {
      const itemId = act.slice('research-'.length);
      const gangId = this.selectedGang;
      if (!gangId) return;
      const err = this.controller.orderForGang('research', gangId, undefined, undefined, itemId);
      SFX.play(err ? 'error' : 'research');
      if (err) {
        this.statusMsg = err;
        this.render(true);
        return;
      }
      if (this.coachStep === 3) this.advanceCoach();
      if (this.orderGuide) {
        this.advanceGuideAfterOrder(
          gangId,
          `Research ordered: ${itemDefById(itemId).name}`,
        );
      } else {
        this.statusMsg = `Research ordered: ${itemDefById(itemId).name}`;
        this.render(true);
      }
      return;
    }
    if (act.startsWith('fabricate-')) {
      const itemId = act.slice('fabricate-'.length);
      this.statusMsg = this.controller.fabricate(itemId);
      SFX.play(this.statusMsg.startsWith('Fabricated') ? 'ui' : 'error');
      this.render();
      return;
    }
    if (act === 'fabricate') {
      const me = this.controller.state.players[this.controller.humanId]!;
      const pick =
        me.researchedItemIds.find((id) => (me.inventory[id] ?? 0) === 0) ??
        me.researchedItemIds[0];
      if (!pick) {
        this.statusMsg = 'Research something first.';
        SFX.play('error');
        this.render();
        return;
      }
      this.statusMsg = this.controller.fabricate(pick);
      SFX.play(this.statusMsg.startsWith('Fabricated') ? 'ui' : 'error');
      this.render();
      return;
    }
    if (act.startsWith('equip-')) {
      const itemId = act.slice('equip-'.length);
      const gangId = this.selectedGang;
      if (!gangId) {
        this.statusMsg = 'Select a crew first, then equip.';
        SFX.play('error');
        this.render();
        return;
      }
      this.statusMsg = this.controller.equip(gangId, itemId);
      SFX.play(this.statusMsg.startsWith('Equipped') ? 'ui' : 'error');
      this.render();
      return;
    }
    if (act.startsWith('unequip-')) {
      const itemId = act.slice('unequip-'.length);
      const gangId = this.selectedGang;
      if (!gangId) {
        this.statusMsg = 'Select a crew first.';
        SFX.play('error');
        this.render();
        return;
      }
      this.statusMsg = this.controller.unequip(gangId, itemId);
      SFX.play(this.statusMsg.startsWith('Unequipped') ? 'ui' : 'error');
      this.render();
      return;
    }
    if (act === 'equip') {
      const gangId = this.selectedGang;
      const me = this.controller.state.players[this.controller.humanId]!;
      const inv = Object.keys(me.inventory).filter((id) => (me.inventory[id] ?? 0) > 0);
      if (!gangId || inv.length === 0) {
        this.statusMsg = 'Need a selected crew and stash gear. Open Tech & gear.';
        SFX.play('error');
        this.render();
        return;
      }
      this.statusMsg = this.controller.equip(gangId, inv[0]!);
      SFX.play(this.statusMsg.startsWith('Equipped') ? 'ui' : 'error');
      this.render();
      return;
    }
    if (act === 'side-mobile-toggle') {
      this.sideMobileOpen = !this.sideMobileOpen;
      SFX.play('ui');
      this.render();
      return;
    }
    if (act.startsWith('side-collapse-')) {
      const id = act.slice('side-collapse-'.length);
      if (id) this.toggleSideSection(id);
      return;
    }
    if (act.startsWith('crew-filter-')) {
      const f = act.slice('crew-filter-'.length);
      if (f === 'all' || f === 'free' || f === 'ordered' || f === 'here') {
        this.crewFilter = f;
        this.render();
        SFX.play('ui');
      }
      return;
    }
    if (act === 'focus-crew-tile') {
      const g = this.selectedGang
        ? this.controller.state.gangs[this.selectedGang]
        : null;
      if (g) {
        this.selected = g.sectorId;
        this.refreshBoard();
        this.board?.focusSector(g.sectorId);
        this.render();
        SFX.play('ui');
      }
      return;
    }

    if (act.startsWith('cancel-order-')) {
      const gid = act.slice('cancel-order-'.length);
      if (!this.cancelGangOrder(gid)) {
        this.statusMsg = 'No order to cancel for that crew.';
        SFX.play('error');
        this.render();
      }
      return;
    }

    if (act.startsWith('pick-gang-')) {
      this.selectGangById(act.slice('pick-gang-'.length));
      return;
    }

    if (act.startsWith('dest-')) {
      const targetId = act.slice('dest-'.length) as SectorId;
      const gangId = this.selectedGang;
      if (!gangId) {
        this.statusMsg = 'Pick a crew first.';
        SFX.play('error');
        this.render();
        return;
      }
      const target = this.controller.state.sectors[targetId];
      if (!target || !areAdjacent(this.controller.state.gangs[gangId]!.sectorId, targetId)) {
        this.statusMsg = 'That block is not a legal move.';
        SFX.play('error');
        this.render();
        return;
      }
      if (!target.owner) this.tryAutoOrder('claim', gangId, targetId);
      else if (target.owner === this.controller.humanId) {
        this.tryAutoOrder('move', gangId, targetId);
      } else this.tryAutoOrder('attack', gangId, targetId);
      return;
    }

    if (act === 'influence-hint') {
      const g = this.selectedGang ? this.controller.state.gangs[this.selectedGang] : null;
      if (!g || g.ownerId !== this.controller.humanId) {
        this.statusMsg =
          'Select a free crew on a block you own, then Influence a business for passive bonuses.';
        SFX.play('error');
        this.render();
        return;
      }
      const sector = this.controller.state.sectors[g.sectorId]!;
      if (sector.owner !== this.controller.humanId) {
        this.statusMsg =
          'Influence needs your turf. Claim this block (or move onto owned ground), then Influence.';
        SFX.play('error');
        this.render();
        return;
      }
      const openSlots = sector.sites
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => s.influencer !== this.controller.humanId);
      if (openSlots.length === 0) {
        this.statusMsg = 'You already influence every business on this block.';
        SFX.play('ui');
        this.render();
        return;
      }
      // One open site → commit immediately (costs the crew's order)
      if (openSlots.length === 1) {
        this.orderInfluenceSlot(openSlots[0]!.i as SiteSlot);
        return;
      }
      // Several → jump panel to work-sites and spotlight
      this.selected = g.sectorId;
      this.statusMsg = `Pick a business in the side panel — ${openSlots.length} open. Each Influence uses this crew's only order.`;
      this.refreshBoard();
      this.board?.focusSector(g.sectorId);
      this.render();
      SFX.play('ui');
      requestAnimationFrame(() => {
        const work = this.root?.querySelector('#sl-crew-work') as HTMLElement | null;
        work?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        work?.classList.add('pulse-focus');
        window.setTimeout(() => work?.classList.remove('pulse-focus'), 1600);
      });
      return;
    }

    if (act.startsWith('influence-slot-')) {
      const slot = Number(act.slice('influence-slot-'.length)) as SiteSlot;
      this.orderInfluenceSlot(slot);
      return;
    }

    // Core orders
    if (act === 'claim' || act === 'attack' || act === 'scout' || act === 'move') {
      this.orderTargeted(act);
      return;
    }
    if (act === 'unrest') {
      this.orderLocal('unrest');
    }
  }

  private orderTargeted(type: 'claim' | 'attack' | 'scout' | 'move'): void {
    const gangId = this.selectedGang;
    if (!gangId || !this.selected) {
      this.statusMsg =
        type === 'move'
          ? 'To move: pick a crew, click a destination block, then Move.'
          : 'Select a crew, then a target block.';
      SFX.play('error');
      this.render();
      return;
    }
    const gang = this.controller.state.gangs[gangId]!;
    if (gang.sectorId === this.selected) {
      this.statusMsg = 'Destination must be a different (adjacent) block.';
      SFX.play('error');
      this.render();
      return;
    }
    if (this.actionBusy || this.resolving) return;
    const from = gang.sectorId;
    const to = this.selected;

    if (type === 'attack') {
      const prev = previewAttackWithIntel(
        this.controller.state,
        [gangId],
        this.selected,
        this.controller.humanId,
      );
      const err = this.controller.orderForGang('attack', gangId, this.selected);
      if (err) {
        this.statusMsg = err;
        SFX.play('error');
        this.render();
        return;
      }
      this.commitOrderFx(
        from,
        to,
        'attack',
        `Attack queued — ${formatOdds(prev)}. Cancel / Esc to undo.`,
        gangId,
      );
      return;
    }
    if (type === 'move') {
      const err = this.controller.orderForGang('move', gangId, this.selected);
      if (err) {
        this.statusMsg = err;
        SFX.play('error');
        this.render();
        return;
      }
      this.commitOrderFx(
        from,
        to,
        'move',
        'Move ordered — End turn to resolve · Cancel / Esc to undo.',
        gangId,
        () => {
          if (this.coachStep === 1) this.advanceCoach();
        },
      );
      return;
    }
    const err = this.controller.orderForGang(type, gangId, this.selected);
    if (err) {
      this.statusMsg = err;
      SFX.play(err ? 'error' : 'ui');
      this.render();
      return;
    }
    this.commitOrderFx(
      from,
      to,
      type === 'claim' ? 'claim' : 'move',
      `${type === 'claim' ? 'Claim' : 'Scout'} ordered. Cancel / Esc to undo.`,
      gangId,
      () => {
        if (type === 'claim' && this.coachStep === 1) this.advanceCoach();
      },
    );
  }

  /** Shared short FX after a successful manual order. */
  private commitOrderFx(
    from: SectorId,
    to: SectorId,
    kind: 'move' | 'claim' | 'attack',
    doneMsg: string,
    orderedGangId?: string,
    onDone?: () => void,
  ): void {
    this.actionBusy = true;
    this.board?.setHighlights([]);
    this.board?.playTravelFx(from, to, kind, false);
    SFX.play(kind === 'attack' ? 'attack' : kind === 'claim' ? 'claim' : 'ui');
    if (this.orderGuide && orderedGangId) {
      this.advanceGuideAfterOrder(orderedGangId, doneMsg);
    } else {
      this.statusMsg =
        kind === 'attack' ? 'Attacking…' : kind === 'claim' ? 'Claiming…' : 'Moving…';
      this.render(true);
    }
    window.setTimeout(() => {
      this.actionBusy = false;
      if (!this.orderGuide) {
        this.statusMsg = doneMsg;
      }
      onDone?.();
      this.refreshBoard();
      this.render(true);
    }, ORDER_FX_MS);
  }

  private orderLocal(type: 'unrest'): void {
    if (this.actionBusy || this.resolving) return;
    const gangId = this.selectedGang;
    if (!gangId) {
      this.statusMsg = 'Select one of your gangs first.';
      SFX.play('error');
      this.render(true);
      return;
    }
    const gang = this.controller.state.gangs[gangId]!;
    if (type === 'unrest') {
      const err = this.controller.orderForGang('unrest', gangId);
      if (err) {
        this.statusMsg = err;
        SFX.play('error');
        this.render(true);
        return;
      }
      this.actionBusy = true;
      this.board?.pulseTile(gang.sectorId, 'unrest', false);
      SFX.play('unrest');
      if (this.orderGuide) {
        this.advanceGuideAfterOrder(gangId, 'Unrest ordered');
      } else {
        this.statusMsg = 'Raising unrest…';
        this.render(true);
      }
      window.setTimeout(() => {
        this.actionBusy = false;
        if (!this.orderGuide) {
          this.statusMsg = 'Unrest ordered — cash now, heat later.';
        }
        this.refreshBoard();
        this.render(true);
      }, ORDER_FX_MS);
    }
  }

  /** Explicit site influence — player picks which business. */
  private orderInfluenceSlot(slot: SiteSlot): void {
    if (this.actionBusy || this.resolving) return;
    const gangId = this.selectedGang;
    if (!gangId) {
      this.statusMsg = 'Select a crew on your owned block first.';
      SFX.play('error');
      this.render();
      return;
    }
    const gang = this.controller.state.gangs[gangId]!;
    if (gang.ownerId !== this.controller.humanId) return;
    const sector = this.controller.state.sectors[gang.sectorId]!;
    if (sector.owner !== this.controller.humanId) {
      this.statusMsg = 'Must own this block to influence its businesses.';
      SFX.play('error');
      this.render();
      return;
    }
    const site = sector.sites[slot];
    if (!site) {
      this.statusMsg = 'Invalid site.';
      SFX.play('error');
      this.render();
      return;
    }
    if (site.influencer === this.controller.humanId) {
      this.statusMsg = 'You already influence that business.';
      SFX.play('error');
      this.render();
      return;
    }
    const sd = siteDefById(site.defId);
    const bonus = formatSiteBonusShort(sd);
    const err = this.controller.orderForGang('influence', gangId, undefined, slot);
    if (err) {
      this.statusMsg = err;
      SFX.play('error');
      this.render();
      return;
    }
    const contest =
      site.influencer && site.influencer !== this.controller.humanId ? 'Contesting' : 'Influencing';
    this.selected = gang.sectorId;
    this.commitOrderFx(
      gang.sectorId,
      gang.sectorId,
      'move',
      `${contest} ${sd.name} (${bonus}). END TURN to lock it in · Cancel / Esc to undo.`,
      gangId,
    );
  }

  /**
   * Where a hire should land:
   * 1) Selected tile if you own it (explicit pick)
   * 2) Selected crew's block if you own it
   * 3) Only if nothing is selected: first owned / home block
   * Never silently place on a different tile than a non-owned selection.
   */
  private hireDeploySector():
    | { sid: SectorId; reason: string }
    | { error: string }
    | null {
    const state = this.controller.state;
    const human = this.controller.humanId;
    const owned = (id: SectorId | null | undefined): id is SectorId =>
      !!id && state.sectors[id]?.owner === human;

    if (owned(this.selected)) {
      return { sid: this.selected, reason: 'selected block' };
    }
    // User clicked a non-owned tile — do not quietly hire elsewhere
    if (this.selected && !owned(this.selected)) {
      return {
        error: `Block ${this.selected} is not yours. Click an owned block, then hire.`,
      };
    }
    const gangSector = this.selectedGang
      ? state.gangs[this.selectedGang]?.sectorId
      : null;
    if (owned(gangSector)) {
      return { sid: gangSector, reason: 'selected crew block' };
    }
    const home = this.humanHomeId();
    if (owned(home)) {
      return { sid: home, reason: 'home block' };
    }
    const any = Object.values(state.sectors).find((s) => s.owner === human)?.id;
    if (any) return { sid: any, reason: 'owned block' };
    return null;
  }

  private doHire(index: number): void {
    const entry = this.controller.state.hirePool[index];
    if (!entry) return;
    const deploy = this.hireDeploySector();
    if (!deploy) {
      this.statusMsg = 'Need an owned sector to hire into. Claim a block first.';
      SFX.play('error');
      this.render();
      return;
    }
    if ('error' in deploy) {
      this.statusMsg = deploy.error;
      SFX.play('error');
      this.render();
      return;
    }

    const beforeGangs = new Set(Object.keys(this.controller.state.gangs));
    const err = this.controller.hire(entry.defId, deploy.sid);
    if (err) {
      this.statusMsg = err;
      SFX.play('error');
      this.render();
      return;
    }

    const def = gangDefById(entry.defId);
    const newId =
      Object.keys(this.controller.state.gangs).find((id) => !beforeGangs.has(id)) ??
      null;

    // Land selection on the hire tile so the portrait is obvious
    this.selected = deploy.sid;
    if (newId) this.selectedGang = newId;
    this.drawer = 'none';
    this.statusMsg = `Hired ${def.name} on block ${deploy.sid} (${deploy.reason}).`;
    SFX.play('hire');
    this.refreshBoard();
    this.board?.focusSector(deploy.sid);
    this.board?.pulseTile(deploy.sid, 'claim', false);
    this.render();
  }

  /** Free crew names for idle warnings. */
  private freeCrewNames(): string[] {
    return this.freeCrewIds().map((id) => {
      const g = this.controller.state.gangs[id];
      return g ? gangDefById(g.defId).name : id;
    });
  }

  /**
   * Banner when End Turn is blocked by idle crews.
   * Offers keep ordering, order guide, or force-confirm.
   */
  private renderEndTurnIdleWarn(): string {
    if (!this.endTurnConfirm) return '';
    const free = this.freeCrewIds();
    if (free.length === 0) return '';
    const names = this.freeCrewNames();
    const list =
      names.length <= 3
        ? names.join(', ')
        : `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
    return `<div id="sl-end-warn" class="pe" role="alertdialog" aria-labelledby="sl-end-warn-title">
      <div class="end-warn-main">
        <div id="sl-end-warn-title" class="end-warn-title">Idle crews</div>
        <p class="end-warn-copy">
          <b>${free.length}</b> crew${free.length === 1 ? '' : 's'} still free
          (${escapeHtml(list)}). They will sit this turn out if you continue.
        </p>
      </div>
      <div class="end-warn-actions">
        <button type="button" class="act ghost" data-act="end-cancel">
          <span class="act-label">Keep ordering</span>
        </button>
        ${
          free.length >= 1
            ? `<button type="button" class="act primary" data-act="guide-start">
                <span class="act-label">Order guide</span>
                <span class="act-sub">${free.length} free</span>
              </button>`
            : ''
        }
        <button type="button" class="act end-turn" data-act="end-confirm">
          <span class="act-label">End turn anyway</span>
          <span class="act-sub">Leave them idle</span>
        </button>
      </div>
    </div>`;
  }

  /** Gate End Turn if any human crew still has no order. */
  private requestEndTurn(): void {
    if (this.resolving || this.actionBusy) return;
    if (this.controller.state.winnerId) {
      this.endTurn();
      return;
    }
    const free = this.freeCrewIds();
    if (free.length > 0 && !this.endTurnConfirm) {
      this.endTurnConfirm = true;
      this.drawer = 'none';
      const names = this.freeCrewNames();
      const preview =
        names.length <= 2
          ? names.join(' & ')
          : `${names[0]} +${names.length - 1} more`;
      this.statusMsg = `Hold up — ${free.length} idle crew${free.length === 1 ? '' : 's'} (${preview}). Confirm below or keep ordering.`;
      SFX.play('error');
      this.render();
      return;
    }
    this.endTurnConfirm = false;
    this.endTurn();
  }

  private endTurn(): void {
    if (this.resolving || this.actionBusy) return;
    if (this.controller.state.winnerId) {
      const d = this.controller.getDebrief();
      this.statusMsg = d?.summary ?? 'Game over';
      this.render();
      if (d) void this.showEndingCard(d);
      else SFX.play(this.controller.state.winnerId === this.controller.humanId ? 'win' : 'lose');
      return;
    }

    this.endTurnConfirm = false;
    this.resolving = true;
    this.drawer = 'none';
    this.selectedGang = null;
    this.board?.setHighlights([]);
    this.statusMsg = 'Rivals act… resolving the city…';
    this.render();

    // Hold pre-resolve board while state advances underneath
    this.suppressSync = true;
    const { message, combats, results, debrief, actions, cityEvent } =
      this.controller.endTurn();
    SFX.play('endTurn');

    void (async () => {
      try {
        await this.playTurnReel(actions, results);
        if (cityEvent) {
          SFX.play('event');
          await this.showEventCard(cityEvent);
        }
      } finally {
        this.suppressSync = false;
        this.resolving = false;
        this.statusMsg = message;
        if (this.coachStep === 2) this.advanceCoach();
        this.refreshBoard();
        this.render();
        if (combats > 0) SFX.play('combat');
        if (debrief) {
          this.statusMsg = debrief.summary;
          this.render();
          window.setTimeout(() => {
            void this.showEndingCard(debrief);
          }, 350);
        }
      }
    })();
  }

  /**
   * Compact full-board schematic for the clash card — every sector as a tiny cell.
   * Marks assault origin(s) and the contested block.
   */
  private buildClashMinimapHtml(
    result: import('../../engine').CombatResult,
  ): string {
    const state = this.controller.state;
    const human = this.controller.humanId;
    const origins = result.attackerOriginSectorIds ?? [];
    const originSet = new Set(origins);
    const w = state.mapWidth;
    const h = state.mapHeight;
    const cells: string[] = [];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const id = `${x},${y}` as SectorId;
        const sector = state.sectors[id];
        const isClash = id === result.sectorId;
        const isOrigin = originSet.has(id);
        const owner = sector?.owner ?? null;
        const youOwn = owner === human;
        const enemyOwn = owner != null && owner !== human;
        const classes = [
          'mm-cell',
          isClash ? 'clash' : '',
          isOrigin ? 'origin' : '',
          youOwn ? 'you' : '',
          enemyOwn ? 'enemy' : '',
          !owner ? 'neutral' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const title = isClash
          ? `Clash ${id}`
          : isOrigin
            ? `From ${id}`
            : id;
        cells.push(
          `<div class="${classes}" title="${escapeHtml(title)}"></div>`,
        );
      }
    }

    const fromLine =
      origins.length > 0
        ? origins.map((o) => escapeHtml(o)).join('·')
        : '—';
    const out = result.attackerWon ? 'SEIZED' : 'PINNED';

    return `
      <div class="slb-minimap ${result.attackerWon ? 'won' : 'lost'}" aria-label="Full sector grid" title="Full ${w}×${h} grid">
        <div class="mm-grid" style="grid-template-columns:repeat(${w},minmax(0,1fr))">
          ${cells.join('')}
        </div>
        <div class="mm-meta">
          <span class="mm-route">${fromLine}→${escapeHtml(result.sectorId)}</span>
          <span class="mm-out ${result.attackerWon ? 'ok' : 'bad'}">${out}</span>
        </div>
      </div>`;
  }

  /**
   * Portrait street fight — style-aware FX (melee / ranged / tech / hybrid).
   * Sequence: lock → standoff → 4 strikes → finale → fate die → outcome.
   * Engine rule: roll < winChance ⇒ attacker wins.
   */
  private showBattleCard(
    result: import('../../engine').CombatResult,
  ): Promise<void> {
    return new Promise((resolve) => {
      const atkNames = (result.attackerNames ?? ['Attack force']).join(', ');
      const defNames = (result.defenderNames?.length
        ? result.defenderNames
        : ['Defenders']
      ).join(', ');
      const atkPort =
        result.attackerPortrait ?? '/assets/portraits/neon_jackals.jpg';
      const defPort =
        result.defenderPortrait ?? '/assets/portraits/scrap_angels.jpg';
      const winPct = Math.round(result.attackerWinChance * 100);
      const rollD100 = Math.max(
        1,
        Math.min(100, Math.round((result.roll ?? 0) * 100) || 1),
      );
      const atkDmg = Math.max(1, Math.round(result.attackerLosses || 0));
      const defDmg = Math.max(1, Math.round(result.defenderLosses || 0));
      const atkPow = Math.round(result.attackerPower);
      const defPow = Math.round(result.defenderPower);
      const atkStyle = result.attackerStyle ?? 'melee';
      const defStyle = result.defenderStyle ?? 'melee';
      const labels = result.strikeLabels ?? [
        'SLASH',
        'COUNTER',
        'CROSSFIRE',
        'HEAVY',
        'CLASH',
      ];
      // Split total losses into readable per-hit ticks (hit def more often)
      const tick = (total: number, i: number, n: number) =>
        Math.max(1, Math.round((total * (i + 1)) / n) - Math.round((total * i) / n));
      const defTicks = [0, 1, 2, 3].map((i) => tick(defDmg, i, 4));
      const atkTicks = [0, 1, 2, 3].map((i) => tick(atkDmg, i, 4));

      const gearRow = (icons: string[] | undefined) =>
        icons?.length
          ? `<div class="gear-row">${icons
              .slice(0, 3)
              .map((src) => `<img src="${src}" alt="" />`)
              .join('')}</div>`
          : '';

      // Make YOU vs ENEMY obvious (player can be attacker or defender)
      const human = this.controller.humanId;
      const youAtk = result.attackerId === human;
      const youDef = result.defenderId === human;
      const atkAllegiance = youAtk ? 'you' : 'enemy';
      const defAllegiance = youDef ? 'you' : 'enemy';
      const atkRoleChip = youAtk ? 'YOU · ATK' : 'ENEMY · ATK';
      const defRoleChip = youDef ? 'YOU · DEF' : 'ENEMY · DEF';
      const stanceLine = youAtk
        ? 'YOU ARE ATTACKING'
        : youDef
          ? 'YOU ARE DEFENDING'
          : 'RIVAL CLASH';
      // Legend matches visual layout: YOU always on the left when you're in the fight
      const stanceMap = youAtk
        ? 'LEFT = YOU (ASSAULT) · RIGHT = ENEMY'
        : youDef
          ? 'LEFT = YOU (DEFEND) · RIGHT = ENEMY ASSAULT'
          : 'LEFT = ASSAULT · RIGHT = DEFENDERS';
      const edgeLabel = youAtk ? 'YOUR EDGE' : youDef ? 'THEIR EDGE' : 'ATK EDGE';
      const dieHint = youAtk
        ? `under ${winPct} = YOU win · power is not a guarantee`
        : youDef
          ? `under ${winPct} = they take the block · high roll helps YOU`
          : `under ${winPct} = attacker wins · not guaranteed`;
      const dieNeed = youAtk
        ? `Need under <b>${winPct}</b> for YOU`
        : youDef
          ? `They need under <b>${winPct}</b>`
          : `Need under <b>${winPct}</b>`;
      const youWon =
        (youAtk && result.attackerWon) || (youDef && !result.attackerWon);
      const outcomeLine = youAtk
        ? result.attackerWon
          ? 'YOU WIN — ASSAULT SUCCESS'
          : 'YOU LOSE — ASSAULT REPELLED'
        : youDef
          ? result.attackerWon
            ? 'YOU LOSE — BLOCK FALLS'
            : 'YOU HOLD — ASSAULT REPELLED'
          : result.attackerWon
            ? 'ASSAULT SUCCESS'
            : 'ASSAULT REPELLED';
      const casYou = youAtk
        ? Math.round(result.attackerLosses)
        : youDef
          ? Math.round(result.defenderLosses)
          : null;
      const casThem = youAtk
        ? Math.round(result.defenderLosses)
        : youDef
          ? Math.round(result.attackerLosses)
          : null;

      // Hard rule: failed assault does not retreat — survivors stay on the block
      const stayNote = !result.attackerWon
        ? youAtk
          ? `<div class="slb-stay-note" data-stay>
              <span class="stay-tag">NO RETREAT</span>
              <p>Your survivors <b>stay on this block</b> — stranded on contested ground. Pull them out next turn or dig in.</p>
            </div>`
          : youDef
            ? `<div class="slb-stay-note" data-stay>
              <span class="stay-tag">NO RETREAT</span>
              <p>Enemy survivors <b>remain on your block</b> — they did not fall back. Clear them next turn.</p>
            </div>`
            : `<div class="slb-stay-note" data-stay>
              <span class="stay-tag">NO RETREAT</span>
              <p>Assault failed — attacker survivors <b>stay on the block</b> (no retreat home).</p>
            </div>`
        : '';

      const minimapHtml = this.buildClashMinimapHtml(result);

      let st = document.getElementById('sl-battle-style') as HTMLStyleElement | null;
      if (!st) {
        st = document.createElement('style');
        st.id = 'sl-battle-style';
        document.head.appendChild(st);
      }
      st.textContent = battleCss;

      const overlay = document.createElement('div');
      overlay.id = 'sl-battle-overlay';
      overlay.innerHTML = `
        <div class="slb-card idle style-atk-${atkStyle} style-def-${defStyle} ${youAtk ? 'you-attack' : youDef ? 'you-defend' : ''}" role="dialog" aria-modal="true" aria-label="Sector clash" data-card>
          <div class="slb-head">
            <div class="slb-head-main">
              <span class="tag">SECTOR CLASH</span>
              <span class="sector">// ${escapeHtml(result.sectorId)} · ${atkStyle.toUpperCase()} vs ${defStyle.toUpperCase()}</span>
            </div>
            ${minimapHtml}
            <div class="slb-skip-bar" data-skip-bar>
              <button type="button" class="slb-skip" data-skip title="Skip fight animation">SKIP</button>
              <button type="button" class="slb-skip all" data-skip-all title="Skip all remaining battles this turn">SKIP ALL</button>
            </div>
          </div>
          <div class="slb-stance ${youAtk ? 'you' : youDef ? 'you def' : ''}" data-stance>
            <span class="stance-pill ${youAtk || youDef ? 'you' : ''}">${stanceLine}</span>
            <span class="stance-map">${stanceMap}</span>
          </div>

          <div class="slb-arena">
            <div class="vignette"></div>
            <div class="scan"></div>
            <div class="motes" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
            <div class="floor"></div>
            <div class="lock-reticle"></div>
            <div class="vs-badge">VS</div>
            <div class="strike-call" data-n="1">${escapeHtml(labels[0]!)}</div>
            <div class="strike-call" data-n="2">${escapeHtml(labels[1]!)}</div>
            <div class="strike-call" data-n="3">${escapeHtml(labels[2]!)}</div>
            <div class="strike-call" data-n="4">${escapeHtml(labels[3]!)}</div>
            <div class="strike-call" data-n="5">${escapeHtml(labels[4]!)}</div>
            <div class="slash a"></div>
            <div class="slash b"></div>
            <div class="slash c"></div>
            <div class="slash d"></div>
            <div class="slash e"></div>
            <div class="proj from-atk"></div>
            <div class="proj from-def"></div>
            <div class="arc"></div>
            <div class="impact-ring"></div>
            <div class="sparks"></div>
            <div class="dmg-tick on-def" data-n="1">−${defTicks[0]}</div>
            <div class="dmg-tick on-atk" data-n="2">−${atkTicks[1]}</div>
            <div class="dmg-tick on-def" data-n="3">−${defTicks[2]}</div>
            <div class="dmg-tick on-atk" data-n="4">−${atkTicks[3]}</div>
            <div class="dmg-float atk">−${atkDmg}</div>
            <div class="dmg-float def">−${defDmg}</div>
            <div class="fighter atk ${atkAllegiance}">
              <div class="ghost"><img src="${atkPort}" alt="" /></div>
              <div class="frame"><img src="${atkPort}" alt="" /></div>
              <span class="chip ${atkAllegiance}">${atkRoleChip}</span>
              <span class="style-tag">${atkStyle.toUpperCase()}</span>
              ${gearRow(result.attackerGearIcons)}
            </div>
            <div class="fighter def ${defAllegiance}">
              <div class="ghost"><img src="${defPort}" alt="" /></div>
              <div class="frame"><img src="${defPort}" alt="" /></div>
              <span class="chip ${defAllegiance}">${defRoleChip}</span>
              <span class="style-tag">${defStyle.toUpperCase()}</span>
              ${gearRow(result.defenderGearIcons)}
            </div>
          </div>

          <div class="slb-body">
            <div class="slb-phase" data-phase>LOCKING TARGETS…</div>

            <div class="slb-crew">
              ${
                // YOU always on the left in the crew strip when you're in the fight
                youDef
                  ? `
              <div class="side def ${defAllegiance}">
                <div class="badge ${defAllegiance}">YOU</div>
                <div class="role">YOUR DEFENSE</div>
                <div class="who">${escapeHtml(result.defenderPlayerName ?? 'Defender')}</div>
                <div class="crew">${escapeHtml(defNames)}</div>
                <div class="pow"><span>PWR</span>${defPow}</div>
              </div>
              <div class="mid">${edgeLabel}<b>${winPct}%</b></div>
              <div class="side atk ${atkAllegiance}">
                <div class="badge ${atkAllegiance}">ENEMY</div>
                <div class="role">THEIR ASSAULT</div>
                <div class="who">${escapeHtml(result.attackerPlayerName ?? 'Attacker')}</div>
                <div class="crew">${escapeHtml(atkNames)}</div>
                <div class="pow">${atkPow}<span>PWR</span></div>
              </div>`
                  : `
              <div class="side atk ${atkAllegiance}">
                <div class="badge ${atkAllegiance}">${youAtk ? 'YOU' : 'ENEMY'}</div>
                <div class="role">${youAtk ? 'YOUR ASSAULT' : 'ASSAULT'}</div>
                <div class="who">${escapeHtml(result.attackerPlayerName ?? 'Attacker')}</div>
                <div class="crew">${escapeHtml(atkNames)}</div>
                <div class="pow"><span>PWR</span>${atkPow}</div>
              </div>
              <div class="mid">${edgeLabel}<b>${winPct}%</b></div>
              <div class="side def ${defAllegiance}">
                <div class="badge ${defAllegiance}">${youDef ? 'YOU' : 'ENEMY'}</div>
                <div class="role">${youAtk ? 'THEIR DEFENSE' : 'DEFENDERS'}</div>
                <div class="who">${escapeHtml(result.defenderPlayerName ?? 'Defender')}</div>
                <div class="crew">${escapeHtml(defNames)}</div>
                <div class="pow">${defPow}<span>PWR</span></div>
              </div>`
              }
            </div>

            <div class="slb-dice" data-dice>
              <div class="lbl">FATE DIE</div>
              <div class="slb-d100">
                <div class="die-wrap">
                  <div class="die-aura" aria-hidden="true"></div>
                  <div class="die" data-die>—</div>
                </div>
                <div class="die-meta">
                  <div class="line">${dieNeed}</div>
                  <div class="line roll">Rolled <b data-roll>—</b></div>
                  <div class="hint">${dieHint}</div>
                </div>
              </div>
              <div class="roll-quality" data-quality></div>
            </div>

            <div class="slb-result hidden" data-result>
              <div class="outcome ${youAtk || youDef ? (youWon ? 'you-win' : 'you-lose') : ''}">${outcomeLine}</div>
              <p class="summary">${escapeHtml(result.summary)}</p>
              <div class="cas">
                Casualties —
                ${
                  casYou != null && casThem != null
                    ? `YOU ${casYou} HP · ENEMY ${casThem} HP`
                    : `ATK ${Math.round(result.attackerLosses)} HP · DEF ${Math.round(result.defenderLosses)} HP`
                }
                ${result.destroyedGangIds.length ? ` · ${result.destroyedGangIds.length} crew wiped` : ''}
              </div>
              ${stayNote}
            </div>

            <button type="button" class="slb-btn hidden" data-dismiss>
              CONTINUE
              <span class="sub">Tap when ready · Enter</span>
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      const card = overlay.querySelector('[data-card]') as HTMLElement;
      const phaseEl = overlay.querySelector('[data-phase]') as HTMLElement;
      const resultEl = overlay.querySelector('[data-result]') as HTMLElement;
      const dismiss = overlay.querySelector('[data-dismiss]') as HTMLButtonElement;
      const rollEl = overlay.querySelector('[data-roll]') as HTMLElement;
      const dieEl = overlay.querySelector('[data-die]') as HTMLElement;
      const diceBox = overlay.querySelector('[data-dice]') as HTMLElement;
      const qualityEl = overlay.querySelector('[data-quality]') as HTMLElement;
      const skipBar = overlay.querySelector('[data-skip-bar]') as HTMLElement | null;
      const skipBtn = overlay.querySelector('[data-skip]') as HTMLButtonElement | null;
      const skipAllBtn = overlay.querySelector('[data-skip-all]') as HTMLButtonElement | null;

      let done = false;
      let revealed = false;
      let scrambleId: number | null = null;
      const timers: number[] = [];

      /** How good the roll was for the attacker (lower under the gate = better). */
      const rollQuality = (
        roll: number,
        winChance: number,
      ): { tier: 'crit' | 'strong' | 'close' | 'weak' | 'botch'; label: string } => {
        if (roll < winChance) {
          const depth = winChance > 0.001 ? (winChance - roll) / winChance : 1;
          if (depth >= 0.6)
            return { tier: 'crit', label: 'CRITICAL HIT // DEEP UNDER THE GATE' };
          if (depth >= 0.28)
            return { tier: 'strong', label: 'CLEAN HIT // SOLID EDGE' };
          return { tier: 'close', label: 'NARROW HIT // SCRAPED THE GATE' };
        }
        const span = 1 - winChance;
        const depth = span > 0.001 ? (roll - winChance) / span : 1;
        if (depth >= 0.6)
          return { tier: 'botch', label: 'BOTCH // FAR OVER THE GATE' };
        if (depth >= 0.28)
          return { tier: 'weak', label: 'HARD MISS // WELL OVER' };
        return { tier: 'close', label: 'NARROW MISS // JUST OVER' };
      };

      const clearMotion = () => {
        card.classList.remove(
          'idle',
          'locking',
          'exchange',
          'hit-1',
          'hit-2',
          'hit-3',
          'hit-4',
          'finale',
          'rolling',
        );
      };

      const pose = (...classes: string[]) => {
        clearMotion();
        for (const c of classes) card.classList.add(c);
      };

      const clearTimers = () => {
        if (scrambleId != null) {
          window.clearInterval(scrambleId);
          scrambleId = null;
        }
        for (const t of timers) window.clearTimeout(t);
        timers.length = 0;
      };

      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape' || ev.key === ' ') {
          ev.preventDefault();
          if (!revealed) revealResult();
          else finish();
        } else if (ev.key === 'Enter' && revealed) {
          ev.preventDefault();
          finish();
        }
      };

      const finish = () => {
        if (done) return;
        done = true;
        clearTimers();
        window.removeEventListener('keydown', onKey);
        document.body.style.overflow = prevOverflow;
        overlay.remove();
        resolve();
      };

      const revealResult = (opts?: { quiet?: boolean }) => {
        if (revealed || done) return;
        revealed = true;
        clearTimers();

        const roll = result.roll ?? 0;
        const q = rollQuality(roll, result.attackerWinChance);

        dieEl.classList.remove('spin');
        dieEl.classList.add('land');
        dieEl.classList.add(result.attackerWon ? 'ok' : 'fail');
        dieEl.classList.add(`q-${q.tier}`);
        rollEl.textContent = String(rollD100);
        dieEl.textContent = String(rollD100);

        diceBox.classList.add('revealed', `roll-${q.tier}`);
        clearMotion();
        card.classList.add(`roll-${q.tier}`);
        card.classList.add(result.attackerWon ? 'won' : 'lost');
        qualityEl.textContent = q.label;

        const under = roll < result.attackerWinChance;
        phaseEl.textContent = under
          ? `HIT // ${rollD100} < ${winPct}`
          : `MISS // ${rollD100} ≥ ${winPct}`;
        phaseEl.classList.add(result.attackerWon ? 'win' : 'lose');
        resultEl.classList.remove('hidden');
        dismiss.classList.remove('hidden');
        skipBar?.classList.add('hidden');
        card.classList.add('has-result');

        if (!opts?.quiet) {
          SFX.play(result.attackerWon ? 'claim' : 'error');
        }

        // Focus Continue so it's obvious and keyboard-ready
        window.setTimeout(() => dismiss.focus(), 30);
      };

      window.addEventListener('keydown', onKey);

      dismiss.addEventListener('click', () => {
        SFX.play('ui');
        finish();
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay && revealed) {
          SFX.play('ui');
          finish();
        }
      });
      skipBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        SFX.play('ui');
        revealResult();
      });
      skipAllBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        SFX.play('ui');
        // Batch this fight + remaining into one summary card after the reel
        this.combatSkipRemaining = true;
        if (!this.combatSkipBatch.includes(result)) {
          this.combatSkipBatch.push(result);
        }
        finish();
      });

      // Medium pace: readable strikes, not a slog (~7.5s to outcome)
      const beats: Array<{ t: number; label: string; pose: string[]; sfx: 'ui' | 'attack' | 'combat' }> = [
        { t: 100, label: 'LOCKING TARGETS…', pose: ['locking'], sfx: 'ui' },
        { t: 900, label: `${atkStyle.toUpperCase()} vs ${defStyle.toUpperCase()}`, pose: ['idle'], sfx: 'ui' },
        { t: 1600, label: labels[0]!, pose: ['exchange', 'hit-1'], sfx: 'attack' },
        { t: 2500, label: labels[1]!, pose: ['exchange', 'hit-2'], sfx: 'attack' },
        { t: 3400, label: labels[2]!, pose: ['exchange', 'hit-3'], sfx: 'combat' },
        { t: 4300, label: labels[3]!, pose: ['exchange', 'hit-4'], sfx: 'attack' },
        { t: 5200, label: labels[4]!, pose: ['finale'], sfx: 'combat' },
      ];

      for (const b of beats) {
        timers.push(
          window.setTimeout(() => {
            if (revealed) return;
            phaseEl.textContent = b.label;
            pose(...b.pose);
            SFX.play(b.sfx);
          }, b.t),
        );
      }

      timers.push(
        window.setTimeout(() => {
          if (revealed) return;
          phaseEl.textContent = 'FATE DIE…';
          card.classList.remove('finale');
          card.classList.add('rolling');
          dieEl.classList.add('spin');
          scrambleId = window.setInterval(() => {
            const n = 1 + Math.floor(Math.random() * 100);
            rollEl.textContent = String(n);
            dieEl.textContent = String(n);
          }, 55);
          SFX.play('ui');
        }, 6000),
      );

      timers.push(window.setTimeout(() => revealResult(), 7800));

      // If animation stalls, force the result — still wait for Continue
      timers.push(
        window.setTimeout(() => {
          if (!revealed) revealResult({ quiet: true });
        }, 16000),
      );
    });
  }

  /**
   * Skip All recap — one readable card for every deferred fight.
   * Waits for Continue (no auto-dismiss).
   */
  private showCombatSkipSummary(
    results: import('../../engine').CombatResult[],
  ): Promise<void> {
    if (results.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const human = this.controller.humanId;
      let st = document.getElementById('sl-battle-style') as HTMLStyleElement | null;
      if (!st) {
        st = document.createElement('style');
        st.id = 'sl-battle-style';
        document.head.appendChild(st);
      }
      st.textContent = battleCss;

      const rows = results
        .map((r, i) => {
          const youAtk = r.attackerId === human;
          const youDef = r.defenderId === human;
          const youWon =
            (youAtk && r.attackerWon) || (youDef && !r.attackerWon);
          const involved = youAtk || youDef;
          const outcome = youAtk
            ? r.attackerWon
              ? 'YOU WIN — ASSAULT SUCCESS'
              : 'YOU LOSE — ASSAULT REPELLED'
            : youDef
              ? r.attackerWon
                ? 'YOU LOSE — BLOCK FALLS'
                : 'YOU HOLD — ASSAULT REPELLED'
              : r.attackerWon
                ? 'ASSAULT SUCCESS'
                : 'ASSAULT REPELLED';
          const rollD100 = Math.max(
            1,
            Math.min(100, Math.round((r.roll ?? 0) * 100) || 1),
          );
          const winPct = Math.round(r.attackerWinChance * 100);
          const atkNames = (r.attackerNames ?? ['Attack force']).join(', ');
          const defNames = (r.defenderNames?.length
            ? r.defenderNames
            : ['Defenders']
          ).join(', ');
          const casYou = youAtk
            ? Math.round(r.attackerLosses)
            : youDef
              ? Math.round(r.defenderLosses)
              : null;
          const casThem = youAtk
            ? Math.round(r.defenderLosses)
            : youDef
              ? Math.round(r.attackerLosses)
              : null;
          const cas =
            casYou != null && casThem != null
              ? `YOU ${casYou} HP · ENEMY ${casThem} HP`
              : `ATK ${Math.round(r.attackerLosses)} HP · DEF ${Math.round(r.defenderLosses)} HP`;
          const stay =
            !r.attackerWon
              ? youAtk
                ? 'NO RETREAT — your survivors stay on the block'
                : youDef
                  ? 'NO RETREAT — enemy survivors remain on your block'
                  : 'NO RETREAT — attackers stay on the block'
              : '';
          const tone = involved
            ? youWon
              ? 'win'
              : 'lose'
            : r.attackerWon
              ? 'win'
              : 'lose';

          return `
            <article class="slb-sum-row ${tone}">
              <div class="sum-head">
                <span class="sum-n">#${i + 1}</span>
                <span class="sum-sec">${escapeHtml(r.sectorId)}</span>
                <span class="sum-out">${escapeHtml(outcome)}</span>
              </div>
              <div class="sum-meta">
                <span>${escapeHtml(atkNames)} → ${escapeHtml(defNames)}</span>
                <span>Roll ${rollD100} · edge ${winPct}%</span>
                <span>${cas}</span>
              </div>
              ${stay ? `<div class="sum-stay">${escapeHtml(stay)}</div>` : ''}
              <p class="sum-line">${escapeHtml(r.summary)}</p>
            </article>`;
        })
        .join('');

      const overlay = document.createElement('div');
      overlay.id = 'sl-battle-overlay';
      overlay.innerHTML = `
        <div class="slb-card has-result slb-summary-card" role="dialog" aria-modal="true" aria-label="Clash summary" data-card>
          <div class="slb-head">
            <div class="slb-head-main">
              <span class="tag">CLASH SUMMARY</span>
              <span class="sector">// ${results.length} fight${results.length === 1 ? '' : 's'} skipped</span>
            </div>
          </div>
          <div class="slb-body slb-sum-body">
            <div class="slb-sum-list">${rows}</div>
            <button type="button" class="slb-btn" data-dismiss>
              CONTINUE
              <span class="sub">Back to the war table · Enter</span>
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      const dismiss = overlay.querySelector('[data-dismiss]') as HTMLButtonElement;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        window.removeEventListener('keydown', onKey);
        document.body.style.overflow = prevOverflow;
        overlay.remove();
        resolve();
      };
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === 'Enter' || ev.key === 'Escape' || ev.key === ' ') {
          ev.preventDefault();
          finish();
        }
      };
      window.addEventListener('keydown', onKey);
      dismiss.addEventListener('click', () => {
        SFX.play('ui');
        finish();
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          SFX.play('ui');
          finish();
        }
      });
      SFX.play('ui');
      window.setTimeout(() => dismiss.focus(), 30);
    });
  }

  /**
   * End-of-run card: unique epitaph + thank-you + light fireworks (win).
   * Stays until the player dismisses.
   */
  private showEndingCard(debrief: DebriefReport): Promise<void> {
    return new Promise((resolve) => {
      const human = this.controller.humanId;
      const won = debrief.winnerId === human;
      const card = pickEndingCard(debrief, human);
      const reasons = debrief.reasons
        .slice(0, 4)
        .map((r) => `<li>${escapeHtml(r)}</li>`)
        .join('');

      let st = document.getElementById('sl-ending-style') as HTMLStyleElement | null;
      if (!st) {
        st = document.createElement('style');
        st.id = 'sl-ending-style';
        document.head.appendChild(st);
      }
      st.textContent = endingCss;

      const overlay = document.createElement('div');
      overlay.id = 'sl-ending-overlay';
      overlay.className = `${won ? 'win' : 'lose'} tone-${card.tone}`;
      overlay.innerHTML = `
        <canvas class="slf-fx" data-fx aria-hidden="true"></canvas>
        <div class="slf-card" role="dialog" aria-modal="true" aria-label="${won ? 'Victory' : 'Defeat'}">
          <div class="slf-head">
            <span class="tag">${won ? 'CITY YOURS' : 'CITY LOST'}</span>
            <span class="tone">${escapeHtml(card.tone.toUpperCase())}</span>
          </div>
          <div class="slf-art" style="background-image:url('${card.art}')">
            <div class="slf-art-fade"></div>
            <span class="slf-art-badge">${escapeHtml(card.badge)}</span>
          </div>
          <div class="slf-body">
            <h2 class="slf-headline">${escapeHtml(card.headline)}</h2>
            <p class="slf-sub">${escapeHtml(card.subhead)}</p>
            <p class="slf-body-text">${escapeHtml(card.body)}</p>
            <div class="slf-meta">
              <span>Style <b>${escapeHtml(debrief.playerStyle)}</b></span>
              <span>Turns <b>${debrief.turnsPlayed}</b></span>
              <span>Winner <b>${escapeHtml(debrief.winnerName)}</b></span>
            </div>
            ${
              reasons
                ? `<ul class="slf-reasons">${reasons}</ul>`
                : ''
            }
            <p class="slf-thanks">
              <span class="ty-label">// TRANSMISSION</span>
              ${escapeHtml(card.thankYou)}
            </p>
            <div class="slf-actions">
              <button type="button" class="slf-btn" data-dismiss>
                ${won ? 'ACKNOWLEDGE VICTORY' : 'ACKNOWLEDGE DEFEAT'}
                <span class="sub">Close when you have finished gloating or grieving</span>
              </button>
              <button type="button" class="slf-btn ghost" data-menu>
                BACK TO MENU
              </button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      const canvas = overlay.querySelector('[data-fx]') as HTMLCanvasElement;
      const stopFx = won
        ? startLightFireworks(canvas)
        : startDefeatStatic(canvas);

      SFX.play(won ? 'win' : 'lose');

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        stopFx();
        document.body.style.overflow = prevOverflow;
        overlay.remove();
        resolve();
      };

      overlay.querySelector('[data-dismiss]')?.addEventListener('click', () => {
        SFX.play('ui');
        finish();
      });
      overlay.querySelector('[data-menu]')?.addEventListener('click', () => {
        SFX.play('ui');
        finish();
        this.controller.persist();
        this.teardown();
        this.scene.start('Menu');
      });

      const btn = overlay.querySelector('[data-dismiss]') as HTMLButtonElement | null;
      btn?.focus();
    });
  }

  /** Full-screen event card — stays until ACKNOWLEDGE (no auto-timeout). */
  private showEventCard(flash: CityEventFlash): Promise<void> {
    return new Promise((resolve) => {
      const def = EVENT_DEFS.find((e) => e.id === flash.id);
      const art = def
        ? eventArtUrl(def)
        : '/assets/events/tone_neutral.jpg';
      const toneKey = flash.tone ?? 'neutral';
      const tone = toneKey.toUpperCase();
      const effects = flash.messages
        .map((m) => `<li>${escapeHtml(m)}</li>`)
        .join('');

      // Self-contained CSS (overlay is outside #sl-hybrid-root — .act styles do not apply)
      let st = document.getElementById('sl-event-style') as HTMLStyleElement | null;
      if (!st) {
        st = document.createElement('style');
        st.id = 'sl-event-style';
        document.head.appendChild(st);
      }
      st.textContent = eventCss;

      const overlay = document.createElement('div');
      overlay.id = 'sl-event-overlay';
      overlay.innerHTML = `
        <div class="sle-card tone-${escapeHtml(toneKey)}" role="dialog" aria-modal="true" aria-label="City event">
          <div class="sle-head">
            <span class="tag">CITY EVENT</span>
            <span class="tone">${escapeHtml(tone)}</span>
          </div>
          <div class="sle-art" style="background-image:url('${art}')">
            <div class="sle-art-fade"></div>
            <span class="sle-art-badge">${escapeHtml(flash.name.toUpperCase())}</span>
          </div>
          <div class="sle-body">
            <h2 class="sle-name">${escapeHtml(flash.name)}</h2>
            <p class="sle-desc">${escapeHtml(flash.description)}</p>
            ${
              effects
                ? `<div class="sle-effects"><div class="sle-effects-head">TRANSMISSION</div><ul>${effects}</ul></div>`
                : ''
            }
            <button type="button" class="sle-btn" data-dismiss>
              ACKNOWLEDGE
              <span class="sub">Continue when ready</span>
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        overlay.remove();
        resolve();
      };

      const btn = overlay.querySelector('[data-dismiss]') as HTMLButtonElement | null;
      btn?.addEventListener('click', () => {
        SFX.play('ui');
        finish();
      });
      // Focus the button so Enter/Space also works; do not auto-close on backdrop or timer
      btn?.focus();
    });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Cheap canvas fireworks — few bursts, auto-stops. Returns cancel fn. */
function startLightFireworks(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => undefined;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0;
  let h = 0;
  const resize = () => {
    w = canvas.clientWidth || window.innerWidth;
    h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();

  type P = { x: number; y: number; vx: number; vy: number; life: number; max: number; hue: number; size: number };
  const particles: P[] = [];
  let burstsLeft = 6;
  let nextBurst = 0;
  let raf = 0;
  let alive = true;
  const t0 = performance.now();

  const burst = (x: number, y: number) => {
    const hue = 40 + Math.random() * 80; // gold → cyan-ish
    const n = 22 + Math.floor(Math.random() * 10);
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      const sp = 1.2 + Math.random() * 3.2;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 0.6,
        life: 0,
        max: 36 + Math.random() * 28,
        hue: hue + Math.random() * 40,
        size: 1.5 + Math.random() * 2,
      });
    }
  };

  const tick = (now: number) => {
    if (!alive) return;
    // Cap total runtime ~3.5s
    if (now - t0 > 3600 && particles.length === 0) {
      ctx.clearRect(0, 0, w, h);
      return;
    }

    if (burstsLeft > 0 && now >= nextBurst) {
      burst(w * (0.15 + Math.random() * 0.7), h * (0.12 + Math.random() * 0.35));
      burstsLeft -= 1;
      nextBurst = now + 280 + Math.random() * 320;
    }

    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]!;
      p.life += 1;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.04;
      p.vx *= 0.99;
      if (p.life >= p.max) {
        particles.splice(i, 1);
        continue;
      }
      const alpha = 1 - p.life / p.max;
      ctx.beginPath();
      ctx.fillStyle = `hsla(${p.hue}, 95%, 62%, ${alpha * 0.85})`;
      ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    if (alive && (particles.length > 0 || burstsLeft > 0 || now - t0 < 3600)) {
      raf = requestAnimationFrame(tick);
    }
  };

  raf = requestAnimationFrame(tick);
  const onResize = () => resize();
  window.addEventListener('resize', onResize);

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    ctx.clearRect(0, 0, w, h);
  };
}

/** Soft static sparkles for defeat — even lighter than fireworks. */
function startDefeatStatic(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => undefined;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0;
  let h = 0;
  const resize = () => {
    w = canvas.clientWidth || window.innerWidth;
    h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();

  let raf = 0;
  let alive = true;
  const t0 = performance.now();
  const dots = Array.from({ length: 28 }, () => ({
    x: Math.random(),
    y: Math.random(),
    s: 0.8 + Math.random() * 1.6,
    ph: Math.random() * Math.PI * 2,
  }));

  const tick = (now: number) => {
    if (!alive) return;
    if (now - t0 > 2800) {
      ctx.clearRect(0, 0, w, h);
      return;
    }
    ctx.clearRect(0, 0, w, h);
    const t = (now - t0) / 1000;
    for (const d of dots) {
      const a = 0.15 + 0.35 * (0.5 + 0.5 * Math.sin(t * 3 + d.ph));
      ctx.fillStyle = `rgba(255, 100, 130, ${a})`;
      ctx.fillRect(d.x * w, d.y * h, d.s, d.s);
    }
    if (alive) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  const onResize = () => resize();
  window.addEventListener('resize', onResize);

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    ctx.clearRect(0, 0, w, h);
  };
}
