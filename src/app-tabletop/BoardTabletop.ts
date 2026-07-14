import { gangDefById } from '../content';
import { parseSectorId, type CombatResult, type GameState, type SectorId } from '../engine';
import boardCss from './boardTabletop.css?inline';

const CELL = 78;
const BOARD_VIEW_KEY = 'sector-lords-board-view';

/** Distinct neon route colors so multi-crew orders stay readable */
const ROUTE_COLORS = [
  '#ff2bd6',
  '#2bf0ff',
  '#fcee0a',
  '#7dff6b',
  '#c8a0ff',
  '#ff8a3d',
  '#4d9fff',
  '#ff5a7a',
] as const;

type PendingOrderMark = {
  gangId: string;
  from: SectorId;
  to: SectorId;
  type: string;
  name: string;
};

function routeColorFor(gangId: string): string {
  let h = 2166136261;
  for (let i = 0; i < gangId.length; i++) {
    h ^= gangId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ROUTE_COLORS[Math.abs(h) % ROUTE_COLORS.length]!;
}

function monogramOf(name: string): string {
  const parts = name
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
  }
  const s = parts[0] ?? name;
  return s.slice(0, 2).toUpperCase() || '??';
}

function shortCrewName(name: string): string {
  if (name.length <= 11) return name;
  return `${name.slice(0, 10)}…`;
}

function orderTypeLabel(type: string): string {
  const t = (type || 'move').toLowerCase();
  if (t === 'claim') return 'CLAIM';
  if (t === 'attack') return 'ATK';
  if (t === 'scout') return 'SCOUT';
  if (t === 'move') return 'MOVE';
  return t.toUpperCase();
}

function orderTypeClass(type: string): string {
  const t = (type || 'move').toLowerCase();
  if (t === 'claim') return 'kind-claim';
  if (t === 'attack') return 'kind-attack';
  if (t === 'scout') return 'kind-scout';
  return 'kind-move';
}

/** War-table tilt vs flat top-down — player preference */
export type BoardViewMode = 'table' | 'flat';

export function loadBoardViewMode(): BoardViewMode {
  try {
    const v = localStorage.getItem(BOARD_VIEW_KEY);
    if (v === 'flat' || v === 'table') return v;
  } catch {
    /* ignore */
  }
  return 'table';
}

export function saveBoardViewMode(mode: BoardViewMode): void {
  try {
    localStorage.setItem(BOARD_VIEW_KEY, mode);
  } catch {
    /* ignore */
  }
}

const DISTRICT_BY_SITE: Record<string, string> = {
  casino: 'neon_strip',
  media_hub: 'corporate',
  lab: 'lab',
  armory: 'industrial',
  factory: 'industrial',
  clinic: 'residential',
};

const DISTRICTS = [
  'residential',
  'industrial',
  'neon_strip',
  'corporate',
  'docks',
  'slums',
  'lab',
] as const;

type DistrictKey = (typeof DISTRICTS)[number];

/**
 * Painted cyberpunk tabletop — district textures + holo frames.
 * CSS 3D plane only (no WebGL).
 */
export class BoardTabletop {
  private root!: HTMLDivElement;
  private stage!: HTMLDivElement;
  private plane!: HTMLDivElement;
  private styleEl!: HTMLStyleElement;
  private tiles = new Map<SectorId, HTMLElement>();
  private selected: SectorId | null = null;
  private highlights = new Set<SectorId>();
  private onSelect: ((id: SectorId) => void) | null = null;
  private onSelectGang: ((gangId: string) => void) | null = null;
  private disposed = false;
  private fieldSig = '';
  private pendingOrders: PendingOrderMark[] = [];
  private scale = 1;
  private panX = 0;
  private panY = 0;
  private panning = false;
  private lastX = 0;
  private lastY = 0;
  private downX = 0;
  private downY = 0;
  /** Tile under pointer on down — select on up if we didn't drag */
  private pendingSelect: SectorId | null = null;
  private humanId = 'player';
  private tutorialIds = new Set<SectorId>();
  private tutorialMode: 'home' | 'dest' | 'pulse' | null = null;
  private viewMode: BoardViewMode = 'table';
  /** Cached tile screen centers for hit-testing (invalidated on pan/zoom/rebuild) */
  private rectCache: Map<
    SectorId,
    { cx: number; cy: number; r: number; dest: boolean; mine: boolean }
  > | null = null;
  /** null = never painted; forces clear when orders become empty after End Turn */
  private pendingOrdersSig: string | null = null;
  private viewport: HTMLElement | null = null;
  private centerRaf = 0;
  /** Active pointers for multi-touch pan + pinch zoom (mobile) */
  private pointers = new Map<number, { x: number; y: number }>();
  private pinching = false;
  private pinchStartDist = 1;
  private pinchStartScale = 1;
  private pinchLastMidX = 0;
  private pinchLastMidY = 0;
  /** True after a pinch this gesture — suppress click on finger-up */
  private didPinch = false;
  /** Slightly generous so tiny hand jitter still counts as a click */
  private static readonly CLICK_SLOP = 16;
  private static readonly SCALE_MIN = 0.4;
  private static readonly SCALE_MAX = 2.4;

  constructor(host: HTMLElement) {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = boardCss;
    document.head.appendChild(this.styleEl);

    this.viewMode = loadBoardViewMode();

    this.root = document.createElement('div');
    this.root.id = 'sl-table-host';
    this.root.innerHTML = `
      <div class="sl-table-bg"></div>
      <div class="sl-table-vignette"></div>
      <div id="sl-table-viewport">
        <div id="sl-table-stage">
          <div id="sl-table-plane">
            <div id="sl-table-felt" aria-hidden="true">
              <div class="sl-felt-base"></div>
              <div class="sl-felt-streets"></div>
              <div class="sl-felt-circuits"></div>
              <div class="sl-felt-scan" aria-hidden="true">
                <i class="scan-h"></i>
                <i class="scan-d"></i>
                <i class="scan-ping a"></i>
                <i class="scan-ping b"></i>
                <i class="scan-ping c"></i>
              </div>
              <div class="sl-felt-rim"></div>
              <div class="sl-felt-corners">
                <span></span><span></span><span></span><span></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    host.appendChild(this.root);
    this.root.classList.toggle('is-flat', this.viewMode === 'flat');
    this.root.classList.toggle('is-table', this.viewMode === 'table');

    this.stage = this.root.querySelector('#sl-table-stage') as HTMLDivElement;
    this.plane = this.root.querySelector('#sl-table-plane') as HTMLDivElement;
    this.viewport = this.root.querySelector('#sl-table-viewport') as HTMLElement;
    this.plane.style.setProperty('--cell', `${CELL}px`);

    this.root.addEventListener('pointerdown', this.onPointerDown);
    this.root.addEventListener('pointermove', this.onPointerMove);
    this.root.addEventListener('pointerup', this.onPointerUp);
    this.root.addEventListener('pointercancel', this.onPointerUp);
    this.root.addEventListener('wheel', this.onWheel, { passive: false });
    // iOS Safari: block browser page-zoom so pinch reaches our handlers
    this.root.addEventListener('gesturestart', this.onGestureBlock, {
      passive: false,
    } as AddEventListenerOptions);
    this.root.addEventListener('gesturechange', this.onGestureBlock, {
      passive: false,
    } as AddEventListenerOptions);
    this.applyView();
  }

  getViewMode(): BoardViewMode {
    return this.viewMode;
  }

  setViewMode(mode: BoardViewMode): void {
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    saveBoardViewMode(mode);
    this.root.classList.toggle('is-flat', mode === 'flat');
    this.root.classList.toggle('is-table', mode === 'table');
    // Re-frame the full board after tilt/flat change
    this.scheduleCenter(true);
  }

  toggleViewMode(): BoardViewMode {
    const next: BoardViewMode = this.viewMode === 'table' ? 'flat' : 'table';
    this.setViewMode(next);
    return next;
  }

  async loadArt(): Promise<void> {
    const urls = [
      '/assets/ui/mood_bg.jpg',
      '/assets/ui/board_plate.jpg',
      ...DISTRICTS.map((d) => `/assets/districts/${d}.jpg`),
    ];
    await Promise.all(
      urls.map(
        (src) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = src;
            window.setTimeout(() => resolve(), 1200);
          }),
      ),
    );
  }

  setOnSelect(fn: (id: SectorId) => void): void {
    this.onSelect = fn;
  }

  setOnSelectGang(fn: (gangId: string) => void): void {
    this.onSelectGang = fn;
  }

  /** Portrait / stack-cycle chip under cursor (your crews are pointer-interactive). */
  private pickGangAt(clientX: number, clientY: number): string | null {
    const stack = document.elementsFromPoint(clientX, clientY);
    for (const node of stack) {
      const el = node as HTMLElement;
      // Cycle chip or portrait with data-gang-id.mine
      if (el.dataset?.gangId && el.classList.contains('mine')) {
        return el.dataset.gangId;
      }
      const hit = el.closest?.(
        'img[data-gang-id].mine, button.sl-stack-cycle[data-gang-id].mine, [data-gang-id].mine',
      ) as HTMLElement | null;
      if (hit?.dataset.gangId) return hit.dataset.gangId;
    }
    return null;
  }

  /**
   * Iso-safe hit test: pick nearest tile center within radius.
   * Uses a rect cache so pan/click paths don't call getBoundingClientRect
   * for every tile on every pointer event.
   */
  private pickTileAt(clientX: number, clientY: number): SectorId | null {
    this.ensureRectCache();
    const cache = this.rectCache!;
    let best: { id: SectorId; score: number } | null = null;

    for (const [id, hit] of cache) {
      const dist = Math.hypot(clientX - hit.cx, clientY - hit.cy);
      if (dist > hit.r) continue;
      let score = dist;
      if (hit.dest) score -= 55;
      const el = this.tiles.get(id);
      if (el?.classList.contains('is-selected') || el?.classList.contains('is-tut-home')) {
        score -= 12;
      }
      if (hit.mine) score -= 18;
      if (!best || score < best.score) best = { id, score };
    }

    if (best) return best.id;

    // Fallback: DOM stack (rare: cache miss / offscreen)
    const stack = document.elementsFromPoint(clientX, clientY);
    for (const node of stack) {
      const tile = (node as HTMLElement).closest?.('.sl-tile') as HTMLElement | null;
      if (tile?.dataset.sectorId && this.tiles.has(tile.dataset.sectorId)) {
        return tile.dataset.sectorId;
      }
    }
    return null;
  }

  /** Gang id under pointer on down — select on up if click didn't pan */
  private pendingGang: string | null = null;

  private onGestureBlock = (ev: Event): void => {
    ev.preventDefault();
  };

  private onPointerDown = (ev: PointerEvent): void => {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    try {
      this.root.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }

    // Second finger → pinch zoom (mobile)
    if (this.pointers.size >= 2) {
      this.beginPinch();
      return;
    }

    this.didPinch = false;
    this.downX = ev.clientX;
    this.downY = ev.clientY;
    this.lastX = ev.clientX;
    this.lastY = ev.clientY;
    const gangHit = this.pickGangAt(ev.clientX, ev.clientY);
    const tileHit = this.pickTileAt(ev.clientX, ev.clientY);
    // Green legal destinations: treat click as tile order even if a friendly
    // portrait is under the finger (otherwise move-onto-ally is impossible).
    const tileIsDest =
      !!tileHit &&
      !!this.tiles.get(tileHit)?.classList.contains('is-dest');
    if (gangHit && !tileIsDest) {
      this.pendingGang = gangHit;
      this.pendingSelect = null;
    } else {
      this.pendingGang = null;
      this.pendingSelect = tileHit;
    }
    this.panning = !this.pendingSelect && !this.pendingGang;
    if (this.panning) this.root.classList.add('is-panning');
  };

  private beginPinch(): void {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    this.pinching = true;
    this.didPinch = true;
    this.panning = false;
    this.pendingSelect = null;
    this.pendingGang = null;
    this.root.classList.add('is-panning');
    const a = pts[0]!;
    const b = pts[1]!;
    this.pinchStartDist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    this.pinchStartScale = this.scale;
    this.pinchLastMidX = (a.x + b.x) / 2;
    this.pinchLastMidY = (a.y + b.y) / 2;
  }

  /**
   * Untransformed top-left of the stage in client coordinates.
   * Stage uses transform-origin 0 0 + translate(pan) scale(s).
   */
  private stageLayoutClientOrigin(): { x: number; y: number } {
    const vp = this.viewport ?? this.root;
    const vr = vp.getBoundingClientRect();
    // offsetLeft/Top are pre-transform layout offsets within the viewport
    return {
      x: vr.left + this.stage.offsetLeft - vp.clientLeft,
      y: vr.top + this.stage.offsetTop - vp.clientTop,
    };
  }

  /**
   * Zoom so the board point under (clientX, clientY) stays put.
   * Must match applyView: origin 0 0, translate then scale.
   */
  private zoomTowardClient(clientX: number, clientY: number, nextScale: number): void {
    const prev = this.scale;
    const next = Math.min(
      BoardTabletop.SCALE_MAX,
      Math.max(BoardTabletop.SCALE_MIN, nextScale),
    );
    if (prev < 1e-6) {
      this.scale = next;
      return;
    }
    if (Math.abs(next - prev) < 1e-6) return;

    const origin = this.stageLayoutClientOrigin();
    // Local content coords under the focal point (pre-scale space)
    const lx = (clientX - origin.x - this.panX) / prev;
    const ly = (clientY - origin.y - this.panY) / prev;
    this.scale = next;
    // Re-pan so that local point still sits under the focal client point
    this.panX = clientX - origin.x - lx * next;
    this.panY = clientY - origin.y - ly * next;
  }

  private updatePinch(): void {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const a = pts[0]!;
    const b = pts[1]!;
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;

    // Two-finger pan first — content follows the pinch midpoint
    this.panX += midX - this.pinchLastMidX;
    this.panY += midY - this.pinchLastMidY;
    this.pinchLastMidX = midX;
    this.pinchLastMidY = midY;

    // Then scale about the current midpoint (fingers stay glued to the map)
    const ratio = dist / this.pinchStartDist;
    const next = this.pinchStartScale * ratio;
    this.zoomTowardClient(midX, midY, next);

    this.applyView();
  }

  private onPointerMove = (ev: PointerEvent): void => {
    if (this.pointers.has(ev.pointerId)) {
      this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    }

    if (this.pointers.size >= 2) {
      if (!this.pinching) this.beginPinch();
      this.updatePinch();
      return;
    }

    if (this.pinching) return;

    const dx = ev.clientX - this.downX;
    const dy = ev.clientY - this.downY;
    const dist = Math.hypot(dx, dy);

    // Drag past slop while aiming at a tile/crew → switch to pan (don't fire select)
    if ((this.pendingSelect || this.pendingGang) && dist > BoardTabletop.CLICK_SLOP) {
      this.pendingSelect = null;
      this.pendingGang = null;
      this.panning = true;
      this.root.classList.add('is-panning');
    }

    if (!this.panning) return;
    this.panX += ev.clientX - this.lastX;
    this.panY += ev.clientY - this.lastY;
    this.lastX = ev.clientX;
    this.lastY = ev.clientY;
    this.applyView();
  };

  private onPointerUp = (ev: PointerEvent): void => {
    this.pointers.delete(ev.pointerId);
    try {
      this.root.releasePointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }

    // End of pinch: drop to one-finger pan or idle
    if (this.pinching) {
      if (this.pointers.size >= 2) {
        this.beginPinch(); // re-seed with remaining fingers
        return;
      }
      this.pinching = false;
      if (this.pointers.size === 1) {
        const p = [...this.pointers.values()][0]!;
        this.lastX = p.x;
        this.lastY = p.y;
        this.downX = p.x;
        this.downY = p.y;
        this.panning = true;
        this.root.classList.add('is-panning');
      } else {
        this.panning = false;
        this.root.classList.remove('is-panning');
      }
      return;
    }

    if (this.didPinch) {
      this.didPinch = false;
      this.pendingSelect = null;
      this.pendingGang = null;
      this.panning = false;
      this.root.classList.remove('is-panning');
      return;
    }

    const selectId = this.pendingSelect;
    const gangId = this.pendingGang;
    this.pendingSelect = null;
    this.pendingGang = null;
    this.panning = false;
    this.root.classList.remove('is-panning');

    const dist = Math.hypot(ev.clientX - this.downX, ev.clientY - this.downY);
    if (dist > BoardTabletop.CLICK_SLOP) return;

    // Portrait click wins — pick exact crew
    const gangNow = this.pickGangAt(ev.clientX, ev.clientY) ?? gangId;
    if (gangNow) {
      this.onSelectGang?.(gangNow);
      return;
    }

    if (!selectId) return;
    // Re-pick at release in case finger slid slightly onto a neighbor
    const id = this.pickTileAt(ev.clientX, ev.clientY) ?? selectId;
    this.onSelect?.(id);
  };

  private onWheel = (ev: WheelEvent): void => {
    ev.preventDefault();
    const factor = ev.deltaY > 0 ? 0.92 : 1.08;
    this.zoomTowardClient(ev.clientX, ev.clientY, this.scale * factor);
    this.applyView();
  };

  private applyView(): void {
    // Origin 0 0 matches zoomTowardClient pan math (not center — that drifted focus)
    this.stage.style.transformOrigin = '0 0';
    this.stage.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
    this.rectCache = null;
  }

  /**
   * Safe play rectangle inside the viewport padding (leaves room for HUD chrome).
   */
  private playSafeRect(): DOMRect | null {
    const vp = this.viewport ?? this.root;
    if (!vp) return null;
    const box = vp.getBoundingClientRect();
    if (box.width < 40 || box.height < 40) return null;
    const cs = getComputedStyle(vp);
    const pt = parseFloat(cs.paddingTop) || 0;
    const pr = parseFloat(cs.paddingRight) || 0;
    const pb = parseFloat(cs.paddingBottom) || 0;
    const pl = parseFloat(cs.paddingLeft) || 0;
    return new DOMRect(
      box.left + pl,
      box.top + pt,
      Math.max(1, box.width - pl - pr),
      Math.max(1, box.height - pt - pb),
    );
  }

  /**
   * Center (and lightly fit) the painted board in the HUD play well.
   * Uses post-3D bounding boxes so iso tilt doesn't leave the map off to one side.
   */
  centerBoard(opts: { fit?: boolean } = {}): void {
    if (this.disposed || this.tiles.size === 0) return;
    const fit = opts.fit !== false;

    // Start from identity so we measure a clean frame
    this.panX = 0;
    this.panY = 0;
    this.scale = 1;
    this.applyView();

    const safe = this.playSafeRect();
    if (!safe) return;

    // Projected board bounds after CSS 3D (iso) — not the unrotated layout box
    let board = this.plane.getBoundingClientRect();
    if (board.width < 8 || board.height < 8) return;

    if (fit) {
      // Leave a little breathing room so the felt rim isn't hard-clipped
      const margin = this.viewMode === 'flat' ? 0.92 : 0.88;
      const next = Math.min(
        (safe.width / board.width) * margin,
        (safe.height / board.height) * margin,
        1.35,
      );
      this.scale = Math.max(0.48, Math.min(1.55, next));
      this.applyView();
      board = this.plane.getBoundingClientRect();
    }

    const scx = safe.left + safe.width / 2;
    const scy = safe.top + safe.height / 2;
    const bcx = board.left + board.width / 2;
    const bcy = board.top + board.height / 2;
    this.panX += scx - bcx;
    this.panY += scy - bcy;
    this.applyView();
  }

  /** Debounced center after layout / mode changes settle. */
  scheduleCenter(fit = true): void {
    if (this.centerRaf) cancelAnimationFrame(this.centerRaf);
    this.centerRaf = requestAnimationFrame(() => {
      this.centerRaf = requestAnimationFrame(() => {
        this.centerRaf = 0;
        this.centerBoard({ fit });
      });
    });
  }

  private ensureRectCache(): void {
    if (this.rectCache) return;
    const cache = new Map<
      SectorId,
      { cx: number; cy: number; r: number; dest: boolean; mine: boolean }
    >();
    for (const [id, el] of this.tiles) {
      const box = el.getBoundingClientRect();
      if (box.width < 4 || box.height < 4) continue;
      cache.set(id, {
        cx: box.left + box.width / 2,
        cy: box.top + box.height / 2,
        r: Math.max(48, Math.max(box.width, box.height) * 0.55),
        dest:
          el.classList.contains('is-dest') || el.classList.contains('is-tut-dest'),
        mine: !!el.querySelector('img.mine'),
      });
    }
    this.rectCache = cache;
  }

  private fingerprint(state: GameState): string {
    const sectors = Object.values(state.sectors)
      .map(
        (s) =>
          `${s.id}:${s.owner ?? '-'}:${s.unrest}:${s.gangIds.join(',')}:${s.sites.map((x) => `${x.defId}:${x.influencer ?? ''}`).join(',')}:${s.landmark?.id ?? ''}`,
      )
      .join('|');
    const gangs = Object.values(state.gangs)
      .map((g) => `${g.id}:${g.defId}:${g.sectorId}:${g.hp}`)
      .join('|');
    return `${sectors}#${gangs}`;
  }

  private ownerColor(state: GameState, owner: string | null): string {
    if (!owner) return '#2a2648';
    const c = state.players[owner]?.color ?? 0x444466;
    return `#${c.toString(16).padStart(6, '0')}`;
  }

  /**
   * Coherent city neighborhoods: map quadrants lean into district themes,
   * then sites + landmarks pull a tile toward matching painted art.
   * Crop offsets keep neighbors from looking identical.
   */
  private districtFor(
    sector: GameState['sectors'][string],
    mapW: number,
    mapH: number,
  ): { url: string; cropX: string; cropY: string; key: DistrictKey } {
    const nx = mapW > 1 ? sector.x / (mapW - 1) : 0.5;
    const ny = mapH > 1 ? sector.y / (mapH - 1) : 0.5;
    const n = sector.x * 23 + sector.y * 41;

    // Soft zone defaults — city has a readable geography
    let zone: DistrictKey;
    if (nx < 0.38 && ny < 0.42) zone = 'corporate';
    else if (nx > 0.62 && ny < 0.4) zone = 'neon_strip';
    else if (nx > 0.55 && ny > 0.58) zone = 'docks';
    else if (nx < 0.4 && ny > 0.55) zone = 'industrial';
    else if (ny > 0.45 && nx > 0.35 && nx < 0.65) zone = 'slums';
    else if (nx < 0.5) zone = 'residential';
    else zone = DISTRICTS[n % DISTRICTS.length]!;

    // Primary site overrides zone when present
    const primary = sector.sites[0]?.defId;
    if (primary && DISTRICT_BY_SITE[primary]) {
      zone = DISTRICT_BY_SITE[primary] as DistrictKey;
    }
    // Secondary site occasionally wins for variety without unrest
    const secondary = sector.sites[1]?.defId;
    if (secondary && DISTRICT_BY_SITE[secondary] && n % 4 === 0) {
      zone = DISTRICT_BY_SITE[secondary] as DistrictKey;
    }
    // Landmarks punch corporate / neon
    if (sector.landmark) {
      zone = n % 2 === 0 ? 'corporate' : 'neon_strip';
    }

    // Crop within the plate so adjacent same-zone tiles still differ
    const cropX = `${18 + (n % 55)}%`;
    const cropY = `${16 + ((n * 11) % 58)}%`;
    return {
      key: zone,
      url: `url("/assets/districts/${zone}.jpg")`,
      cropX,
      cropY,
    };
  }

  private build(state: GameState): void {
    const felt = this.plane.querySelector('#sl-table-felt');
    this.plane.replaceChildren();
    if (felt) this.plane.appendChild(felt);

    this.tiles.clear();
    this.rectCache = null;
    // Rebuild wiped order-mark DOM — force re-paint of pending chips after build
    this.pendingOrdersSig = null;
    this.plane.style.setProperty('--cols', String(state.mapWidth));
    this.plane.style.setProperty('--rows', String(state.mapHeight));
    this.humanId =
      state.playerOrder.find((id) => state.players[id]?.isHuman) ?? 'player';

    this.mountAxisGuide(state.mapWidth, state.mapHeight);

    const frag = document.createDocumentFragment();

    for (const sector of Object.values(state.sectors)) {
      const d = this.districtFor(sector, state.mapWidth, state.mapHeight);

      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'sl-tile' + (sector.owner ? ' is-owned' : '');
      el.dataset.sectorId = sector.id;
      el.dataset.district = d.key;
      el.style.setProperty('--x', String(sector.x));
      el.style.setProperty('--y', String(sector.y));
      el.style.setProperty('--owner', this.ownerColor(state, sector.owner));
      el.style.setProperty('--district', d.url);
      el.style.setProperty('--crop-x', d.cropX);
      el.style.setProperty('--crop-y', d.cropY);
      // Iso depth: lower-right of board paints/hits above upper-left neighbors
      el.style.zIndex = String(sector.x + sector.y);

      // Flat painted chips only (no CSS-3D sides — those caused open walls / black voids)
      const top = document.createElement('div');
      top.className = 'sl-tile-top';
      top.innerHTML = `
        <div class="sl-tint"></div>
        <div class="sl-unrest"></div>
        <div class="sl-gloss"></div>
        <div class="sl-dest-ring"></div>
      `;

      const holo = document.createElement('div');
      holo.className = 'sl-holo';
      holo.innerHTML = `<span class="sl-holo-tr"></span><span class="sl-holo-bl"></span>`;

      // Intel layer sits ABOVE portraits so pips stay readable
      const intel = document.createElement('div');
      intel.className = 'sl-tile-intel';
      intel.setAttribute('aria-hidden', 'true');
      // Owner = tile outline (CSS is-mine / is-foe); sites = pips; unrest = # when > 0
      intel.innerHTML = `
        <div class="sl-site-pips" title="Site influence"></div>
        <span class="sl-unrest-mark" hidden title=""><span class="um-n"></span></span>
      `;

      const portraits = document.createElement('div');
      portraits.className = 'sl-tile-portraits';
      this.fillPortraits(portraits, state, sector.gangIds, null);

      const orderMark = document.createElement('div');
      orderMark.className = 'sl-order-mark';
      orderMark.hidden = true;

      el.appendChild(top);
      el.appendChild(holo);
      el.appendChild(portraits);
      el.appendChild(intel);
      el.appendChild(orderMark);
      this.applyTileIntel(el, state, sector);

      if (sector.landmark) {
        const star = document.createElement('div');
        star.className = 'sl-tile-star';
        star.textContent = '★';
        el.appendChild(star);
      }

      // Selection is handled on the host via pickTileAt (more reliable under CSS 3D)

      frag.appendChild(el);
      this.tiles.set(sector.id, el);
    }

    this.plane.appendChild(frag);
    this.ensureRoutesLayer();
  }

  /**
   * Edge coordinate rails so UI labels like "CLAIM 1,2" match the grid.
   * Format is X across, Y down — same as sector ids (`x,y`).
   */
  private mountAxisGuide(cols: number, rows: number): void {
    this.plane.querySelector('.sl-axis-guide')?.remove();
    const guide = document.createElement('div');
    guide.className = 'sl-axis-guide';
    guide.setAttribute('aria-hidden', 'true');

    const corner = document.createElement('div');
    corner.className = 'sl-axis-corner';
    corner.innerHTML = `<span class="ax">X</span><span class="sep">·</span><span class="ay">Y</span>`;
    guide.appendChild(corner);

    for (let x = 0; x < cols; x++) {
      const lab = document.createElement('div');
      lab.className = 'sl-axis-lab x';
      lab.style.setProperty('--i', String(x));
      lab.textContent = String(x);
      lab.title = `Column X = ${x}`;
      guide.appendChild(lab);
    }
    for (let y = 0; y < rows; y++) {
      const lab = document.createElement('div');
      lab.className = 'sl-axis-lab y';
      lab.style.setProperty('--i', String(y));
      lab.textContent = String(y);
      lab.title = `Row Y = ${y}`;
      guide.appendChild(lab);
    }

    // Subtle legend under the grid
    const legend = document.createElement('div');
    legend.className = 'sl-axis-legend';
    legend.textContent = 'BLOCK = X,Y';
    guide.appendChild(legend);

    this.plane.appendChild(guide);
  }

  private ensureRoutesLayer(): SVGSVGElement {
    let svg = this.plane.querySelector('.sl-order-routes') as SVGSVGElement | null;
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'sl-order-routes');
      svg.setAttribute('aria-hidden', 'true');
      this.plane.appendChild(svg);
    }
    return svg;
  }

  private fillPortraits(
    host: HTMLElement,
    state: GameState,
    gangIds: string[],
    selectedCrewId: string | null,
  ): void {
    host.replaceChildren();
    const tileId = host.parentElement?.dataset?.sectorId;
    // Living crews on this tile only
    const living = gangIds.filter((gid) => {
      const g = state.gangs[gid];
      return !!g && g.hp > 0 && (!tileId || g.sectorId === tileId);
    });
    const unique = [...new Set(living)];
    const mine = unique.filter(
      (gid) => state.gangs[gid]?.ownerId === this.humanId,
    );
    const foes = unique.filter(
      (gid) => state.gangs[gid]?.ownerId !== this.humanId,
    );

    // Free crews first in stack ring, then ordered — selected always painted on top
    const freeMine = mine.filter(
      (gid) => !state.orders.some((o) => o.gangId === gid),
    );
    const busyMine = mine.filter((gid) => !freeMine.includes(gid));
    const mineRing = [...freeMine, ...busyMine];
    if (selectedCrewId && mineRing.includes(selectedCrewId)) {
      mineRing.sort((a, b) => {
        if (a === selectedCrewId) return -1;
        if (b === selectedCrewId) return 1;
        return 0;
      });
    }

    const isStack = mineRing.length > 1;
    host.classList.toggle('is-stack', isStack);
    host.classList.toggle('has-foes', foes.length > 0);

    // Overlapping stack: selected + up to 2 peeks (not a row of 4 tiny faces)
    const maxPeek = isStack ? 3 : 4;
    const shownMine = mineRing.slice(0, maxPeek);
    // Paint back-to-front so selected (first) ends on top in DOM after reverse draw
    const paintOrder = [...shownMine].reverse();
    for (const gid of paintOrder) {
      const g = state.gangs[gid]!;
      const def = gangDefById(g.defId);
      const img = document.createElement('img');
      const src = def.art.portrait ?? 'assets/portraits/neon_jackals.jpg';
      img.src = src.startsWith('/') ? src : `/${src}`;
      img.alt = def.name;
      const busy = state.orders.some((o) => o.gangId === gid);
      img.title = busy
        ? `${def.name} (order queued) — click to select`
        : `Select ${def.name}`;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.dataset.gangId = gid;
      img.className = 'mine';
      if (busy) img.classList.add('is-busy');
      if (gid === selectedCrewId) img.classList.add('selected-crew');
      host.appendChild(img);
    }

    // Enemy peeks (small, non-interactive) — keep intel without stealing clicks
    for (const gid of foes.slice(0, 2)) {
      const g = state.gangs[gid]!;
      const def = gangDefById(g.defId);
      const img = document.createElement('img');
      const src = def.art.portrait ?? 'assets/portraits/scrap_angels.jpg';
      img.src = src.startsWith('/') ? src : `/${src}`;
      img.alt = def.name;
      img.title = def.name;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.dataset.gangId = gid;
      img.className = 'enemy';
      host.appendChild(img);
    }

    // Cycle chip: click selects next crew in the free-first ring
    if (isStack) {
      const cur =
        selectedCrewId && mineRing.includes(selectedCrewId)
          ? selectedCrewId
          : mineRing[0]!;
      // Prefer next free crew when cycling from chip
      const freeOnly = freeMine.length > 0 ? freeMine : mineRing;
      const ring = freeOnly.includes(cur) ? freeOnly : mineRing;
      const idx = Math.max(0, ring.indexOf(cur));
      const next = ring[(idx + 1) % ring.length]!;
      const freeN = freeMine.length;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'sl-stack-cycle mine';
      chip.dataset.gangId = next;
      chip.setAttribute('aria-label', `Cycle stack — ${mineRing.length} crews`);
      chip.title = `Stack ${mineRing.length} · ${freeN} free — click to next crew`;
      chip.innerHTML = `<span class="sc-n">${idx + 1}/${mineRing.length}</span>${
        freeN > 0 && freeN < mineRing.length
          ? `<span class="sc-free">${freeN} free</span>`
          : freeN === 0
            ? `<span class="sc-free busy">all set</span>`
            : ''
      }`;
      host.appendChild(chip);
    } else if (mineRing.length === 0 && foes.length > 2) {
      const more = document.createElement('span');
      more.className = 'sl-portrait-more';
      more.textContent = `+${foes.length - 2}`;
      more.title = `${foes.length} rival crews here`;
      host.appendChild(more);
    }
  }

  /**
   * Ownership via tile outline classes; site pips; unrest badge only when > 0.
   */
  private applyTileIntel(
    el: HTMLElement,
    state: GameState,
    sector: GameState['sectors'][string],
  ): void {
    const mine = sector.owner === this.humanId;
    const foe = !!sector.owner && sector.owner !== this.humanId;
    el.classList.toggle('is-owned', !!sector.owner);
    el.classList.toggle('is-mine', mine);
    el.classList.toggle('is-foe', foe);
    el.classList.toggle('is-neutral', !sector.owner);
    el.classList.toggle('has-unrest', sector.unrest > 0);
    el.classList.toggle('has-high-unrest', sector.unrest >= 5);

    const pips = el.querySelector('.sl-site-pips') as HTMLElement | null;
    if (pips) {
      const bits = sector.sites.map((site) => {
        if (!site.influencer) return 'open';
        return site.influencer === this.humanId ? 'you' : 'foe';
      });
      const youN = bits.filter((b) => b === 'you').length;
      const foeN = bits.filter((b) => b === 'foe').length;
      const openN = bits.filter((b) => b === 'open').length;
      // Hide chrome when nothing is influenced — empty triple-dots on every tile is noise
      const anyClaimed = youN + foeN > 0;
      pips.hidden = !anyClaimed;
      if (anyClaimed) {
        pips.title = `Sites: ${youN} yours · ${foeN} rival · ${openN} open`;
        const sig = bits.join(',');
        if (pips.dataset.sig !== sig) {
          pips.dataset.sig = sig;
          pips.replaceChildren();
          for (const kind of bits) {
            const i = document.createElement('i');
            i.className = `pip ${kind}`;
            i.title =
              kind === 'you'
                ? 'You influence this site'
                : kind === 'foe'
                  ? 'Rival influences this site'
                  : 'Open site';
            pips.appendChild(i);
          }
        }
      } else {
        pips.title = '';
        pips.dataset.sig = '';
        pips.replaceChildren();
      }
    }

    const unrestMark = el.querySelector('.sl-unrest-mark') as HTMLElement | null;
    const unrestN = el.querySelector('.sl-unrest-mark .um-n') as HTMLElement | null;
    if (unrestMark && unrestN) {
      if (sector.unrest > 0) {
        unrestMark.hidden = false;
        unrestN.textContent = String(sector.unrest);
        unrestMark.title = `Unrest ${sector.unrest}/10`;
        unrestMark.classList.toggle('hot', sector.unrest >= 5);
      } else {
        unrestMark.hidden = true;
        unrestN.textContent = '';
        unrestMark.classList.remove('hot');
      }
    }

    el.title = this.tileTitle(state, sector);
  }

  private tileTitle(
    state: GameState,
    sector: GameState['sectors'][string],
  ): string {
    const owner = sector.owner
      ? sector.owner === this.humanId
        ? 'You own this block'
        : `${state.players[sector.owner]?.name ?? 'Rival'} owns this block`
      : 'Unclaimed block';
    const sites = sector.sites
      .map((s, i) => {
        const who = !s.influencer
          ? 'open'
          : s.influencer === this.humanId
            ? 'you'
            : 'rival';
        return `site ${i + 1}:${who}`;
      })
      .join(', ');
    const unrest =
      sector.unrest > 0 ? ` · unrest ${sector.unrest}` : '';
    return `${sector.id} · ${owner} · ${sites}${unrest}`;
  }

  private refreshChrome(state: GameState, selectedCrewId: string | null): void {
    // Hit cache may be stale after class changes that affect layout rarely;
    // selection chrome alone doesn't move centers, so keep cache.
    for (const sector of Object.values(state.sectors)) {
      const el = this.tiles.get(sector.id);
      if (!el) continue;

      el.style.setProperty('--owner', this.ownerColor(state, sector.owner));
      el.classList.toggle('is-selected', sector.id === this.selected);
      el.classList.toggle('is-dest', this.highlights.has(sector.id));
      this.applyTileIntel(el, state, sector);
      el.classList.remove('is-tut-home', 'is-tut-dest', 'is-tut-pulse');
      if (this.tutorialIds.has(sector.id) && this.tutorialMode) {
        if (this.tutorialMode === 'home') el.classList.add('is-tut-home');
        else if (this.tutorialMode === 'dest') el.classList.add('is-tut-dest');
        else el.classList.add('is-tut-pulse');
      }
      el.classList.toggle(
        'is-enemy-focus',
        sector.id === this.selected &&
          !!sector.owner &&
          sector.owner !== this.humanId,
      );

      const portraits = el.querySelector('.sl-tile-portraits') as HTMLElement | null;
      if (portraits) {
        const living = sector.gangIds.filter((id) => {
          const g = state.gangs[id];
          return g && g.hp > 0 && g.sectorId === sector.id;
        });
        const unique = [...new Set(living)];
        const orderSig = unique
          .map((id) => (state.orders.some((o) => o.gangId === id) ? '1' : '0'))
          .join('');
        // Full rebuild when roster, selection, or busy flags change
        const sig = `${unique.join(',')}|${selectedCrewId ?? ''}|${orderSig}`;
        if (portraits.dataset.gangSig !== sig) {
          portraits.dataset.gangSig = sig;
          this.fillPortraits(portraits, state, unique, selectedCrewId);
          this.rectCache = null;
        }
      }
    }

    this.paintOrderMarks();
  }

  /**
   * Route ribbons + colored path lines.
   * Stacks multiple crews on the same tile; monogram + name show who is who.
   */
  private paintOrderMarks(): void {
    const orderSig = this.pendingOrders
      .map((o) => `${o.gangId}:${o.from}>${o.to}:${o.type}`)
      .join('|');
    if (orderSig === this.pendingOrdersSig) return;
    this.pendingOrdersSig = orderSig;

    for (const el of this.tiles.values()) {
      el.classList.remove('is-order-from', 'is-order-to');
      const orderMark = el.querySelector('.sl-order-mark') as HTMLElement | null;
      if (orderMark) {
        orderMark.hidden = true;
        orderMark.innerHTML = '';
        orderMark.classList.remove('stacked');
      }
    }

    // Draw connecting routes first (under badges, still on the plane)
    this.paintOrderRoutes();

    // Group badges per tile so multi-gang stacks instead of overwriting
    type Badge = {
      role: 'from' | 'to';
      order: PendingOrderMark;
      color: string;
    };
    const byTile = new Map<SectorId, Badge[]>();
    const push = (sid: SectorId, badge: Badge) => {
      const list = byTile.get(sid) ?? [];
      list.push(badge);
      byTile.set(sid, list);
    };

    for (const o of this.pendingOrders) {
      const color = routeColorFor(o.gangId);
      push(o.from, { role: 'from', order: o, color });
      push(o.to, { role: 'to', order: o, color });
    }

    for (const [sid, badges] of byTile) {
      const el = this.tiles.get(sid);
      if (!el) continue;
      const mark = el.querySelector('.sl-order-mark') as HTMLElement | null;
      if (!mark) continue;

      let hasFrom = false;
      let hasTo = false;
      const html: string[] = [];
      for (const b of badges) {
        if (b.role === 'from') hasFrom = true;
        else hasTo = true;
        html.push(this.routeBadgeHtml(b));
      }
      if (hasFrom) el.classList.add('is-order-from');
      if (hasTo) el.classList.add('is-order-to');
      mark.hidden = false;
      mark.classList.toggle('stacked', badges.length > 1);
      mark.innerHTML = html.join('');
    }
  }

  private routeBadgeHtml(b: {
    role: 'from' | 'to';
    order: PendingOrderMark;
    color: string;
  }): string {
    const o = b.order;
    const mono = monogramOf(o.name);
    const who = shortCrewName(o.name);
    const kind = orderTypeClass(o.type);
    const typeLbl = orderTypeLabel(o.type);
    if (b.role === 'from') {
      return `<div class="sl-route-badge from ${kind}" style="--route:${b.color}" title="${escapeHtml(o.name)} → ${escapeHtml(o.to)} (${typeLbl})">
        <span class="sl-route-mono" aria-hidden="true">${escapeHtml(mono)}</span>
        <span class="sl-route-meta">
          <span class="sl-route-who">${escapeHtml(who)}</span>
          <span class="sl-route-act">→ ${typeLbl} ${escapeHtml(o.to)}</span>
        </span>
      </div>`;
    }
    return `<div class="sl-route-badge to ${kind}" style="--route:${b.color}" title="${escapeHtml(o.name)} arriving · ${typeLbl}">
      <span class="sl-route-mono" aria-hidden="true">${escapeHtml(mono)}</span>
      <span class="sl-route-meta">
        <span class="sl-route-who">${escapeHtml(who)}</span>
        <span class="sl-route-act">${typeLbl} ←</span>
      </span>
    </div>`;
  }

  /** Colored dashed lines between order from/to (transform with the iso plane). */
  private paintOrderRoutes(): void {
    const svg = this.ensureRoutesLayer();
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // defs: arrowheads per unique color
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svg.appendChild(defs);
    const colorsUsed = new Set<string>();

    this.pendingOrders.forEach((o, index) => {
      if (o.from === o.to) return;
      let from: { x: number; y: number };
      let to: { x: number; y: number };
      try {
        from = parseSectorId(o.from);
        to = parseSectorId(o.to);
      } catch {
        return;
      }
      const color = routeColorFor(o.gangId);
      if (!colorsUsed.has(color)) {
        colorsUsed.add(color);
        const mid = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        const midId = `sl-arr-${color.replace('#', '')}`;
        mid.setAttribute('id', midId);
        mid.setAttribute('markerWidth', '7');
        mid.setAttribute('markerHeight', '7');
        mid.setAttribute('refX', '5');
        mid.setAttribute('refY', '3.5');
        mid.setAttribute('orient', 'auto');
        mid.setAttribute('markerUnits', 'strokeWidth');
        const tip = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        tip.setAttribute('d', 'M0,0 L7,3.5 L0,7 Z');
        tip.setAttribute('fill', color);
        mid.appendChild(tip);
        defs.appendChild(mid);
      }
      const midId = `sl-arr-${color.replace('#', '')}`;

      const x1 = from.x * CELL + CELL / 2;
      const y1 = from.y * CELL + CELL / 2;
      const x2 = to.x * CELL + CELL / 2;
      const y2 = to.y * CELL + CELL / 2;
      // Parallel offset when several routes share a corridor
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const slot = (index % 5) - 2;
      const ox = (-dy / len) * 5 * slot;
      const oy = (dx / len) * 5 * slot;
      // Shorten ends so badges stay readable
      const inset = Math.min(18, len * 0.22);
      const ux = dx / len;
      const uy = dy / len;
      const sx = x1 + ux * inset + ox;
      const sy = y1 + uy * inset + oy;
      const ex = x2 - ux * inset + ox;
      const ey = y2 - uy * inset + oy;

      // Soft glow underlay
      const glow = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      glow.setAttribute('x1', String(sx));
      glow.setAttribute('y1', String(sy));
      glow.setAttribute('x2', String(ex));
      glow.setAttribute('y2', String(ey));
      glow.setAttribute('class', 'sl-route-glow');
      glow.setAttribute('stroke', color);
      svg.appendChild(glow);

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(sx));
      line.setAttribute('y1', String(sy));
      line.setAttribute('x2', String(ex));
      line.setAttribute('y2', String(ey));
      line.setAttribute('class', 'sl-route-line');
      line.setAttribute('stroke', color);
      line.setAttribute('marker-end', `url(#${midId})`);
      svg.appendChild(line);
    });
  }

  setPendingOrders(orders: PendingOrderMark[]): void {
    this.pendingOrders = orders;
    // Force paint even when clearing to [] ('' === '' used to skip and leave ghosts)
    this.pendingOrdersSig = null;
    this.paintOrderMarks();
  }

  setHighlights(ids: SectorId[]): void {
    this.highlights = new Set(ids);
    for (const [id, el] of this.tiles) {
      const on = this.highlights.has(id);
      el.classList.toggle('is-dest', on);
      // Keep hit bias in sync without full rebuild
      const hit = this.rectCache?.get(id);
      if (hit) hit.dest = on || el.classList.contains('is-tut-dest');
    }
  }

  sync(
    state: GameState,
    selected?: SectorId | null,
    selectedCrewId: string | null = null,
  ): void {
    if (selected !== undefined) this.selected = selected;
    this.humanId =
      state.playerOrder.find((id) => state.players[id]?.isHuman) ?? 'player';
    const sig = this.fingerprint(state);
    const wasEmpty = this.tiles.size === 0;
    if (sig !== this.fieldSig || wasEmpty) {
      this.fieldSig = sig;
      this.build(state);
      // First map paint: frame the full board in the play well
      if (wasEmpty) this.scheduleCenter(true);
    }
    this.refreshChrome(state, selectedCrewId);
  }

  /**
   * Tutorial pulses on specific tiles (home beacon, extra dest attention).
   * Cleared with empty ids or mode null.
   */
  setTutorialHighlights(
    ids: SectorId[],
    mode: 'home' | 'dest' | 'pulse' | null = 'pulse',
  ): void {
    this.tutorialIds = new Set(ids);
    this.tutorialMode = ids.length ? mode : null;
    for (const [id, el] of this.tiles) {
      el.classList.remove('is-tut-home', 'is-tut-dest', 'is-tut-pulse');
      if (!this.tutorialIds.has(id) || !this.tutorialMode) continue;
      if (this.tutorialMode === 'home') el.classList.add('is-tut-home');
      else if (this.tutorialMode === 'dest') el.classList.add('is-tut-dest');
      else el.classList.add('is-tut-pulse');
    }
  }

  focusSector(id: SectorId): void {
    const el = this.tiles.get(id);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const host = this.root.getBoundingClientRect();
    this.panX += (host.left + host.width / 2 - (rect.left + rect.width / 2)) * 0.35;
    this.panY += (host.top + host.height / 2 - (rect.top + rect.height / 2)) * 0.35;
    this.applyView();
  }

  playCombatFx(result: CombatResult): void {
    // Double pulse + focus so the fight sector pops before the clash modal
    this.pulseTile(result.sectorId, 'attack', false);
    this.focusSector(result.sectorId);
    window.setTimeout(() => this.pulseTile(result.sectorId, 'attack', !result.attackerWon), 280);
  }

  /**
   * Short travel / action FX: flash origin, then destination.
   * enemy=true uses magenta accent for rival actions.
   */
  playTravelFx(
    from: SectorId,
    to: SectorId,
    kind: 'move' | 'claim' | 'attack' | 'scout' | 'unrest' | 'influence' | 'research' = 'move',
    enemy = false,
  ): void {
    const pulseKind =
      kind === 'attack' ? 'attack' : kind === 'claim' ? 'claim' : kind === 'unrest' ? 'unrest' : 'move';
    this.pulseTile(from, pulseKind, enemy);
    if (to && to !== from) {
      window.setTimeout(() => this.pulseTile(to, pulseKind, enemy), 160);
    }
  }

  pulseTile(
    id: SectorId,
    kind: 'move' | 'claim' | 'attack' | 'unrest' = 'move',
    enemy = false,
  ): void {
    const el = this.tiles.get(id);
    if (!el) return;
    const cls =
      kind === 'attack'
        ? 'fx-combat'
        : kind === 'claim'
          ? 'fx-claim'
          : kind === 'unrest'
            ? 'fx-unrest'
            : enemy
              ? 'fx-enemy'
              : 'fx-order';
    el.classList.remove('fx-order', 'fx-claim', 'fx-combat', 'fx-enemy', 'fx-unrest');
    void el.offsetWidth;
    el.classList.add(cls);
    if (enemy && kind !== 'attack') el.classList.add('fx-enemy');
    window.setTimeout(() => {
      el.classList.remove('fx-order', 'fx-claim', 'fx-combat', 'fx-enemy', 'fx-unrest');
    }, 520);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.centerRaf) cancelAnimationFrame(this.centerRaf);
    this.root.removeEventListener('pointerdown', this.onPointerDown);
    this.root.removeEventListener('pointermove', this.onPointerMove);
    this.root.removeEventListener('pointerup', this.onPointerUp);
    this.root.removeEventListener('pointercancel', this.onPointerUp);
    this.root.removeEventListener('wheel', this.onWheel);
    this.root.removeEventListener('gesturestart', this.onGestureBlock);
    this.root.removeEventListener('gesturechange', this.onGestureBlock);
    this.pointers.clear();
    this.root.remove();
    this.styleEl.remove();
    this.tiles.clear();
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
