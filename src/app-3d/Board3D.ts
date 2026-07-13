import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GANG_DEFS } from '../content';
import type { CombatResult, GameState, SectorId } from '../engine';

const TILE = 1.2;
const GAP = 0.06;

/** Fixed tabletop look: high angle from "south", never free-orbit. */
const TABLETOP_OFFSET = new THREE.Vector3(0, 13.5, 11.5);

/**
 * Hybrid board: extruded 3D city using 2D game art (sector tiles + gang portraits).
 * Tabletop camera — fixed angle, zoom + pan only (like a board game on a table).
 */
export class Board3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private host: HTMLElement;
  private controls: OrbitControls;
  private tiles = new Map<SectorId, THREE.Mesh>();
  private portraits = new Map<string, THREE.Sprite>(); // gang instance id
  private landmarks = new Map<SectorId, THREE.Mesh>();
  private selectionRing: THREE.Mesh | null = null;
  private selected: SectorId | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private root: THREE.Group;
  private fxRoot: THREE.Group;
  private disposed = false;
  private onSelect: ((id: SectorId) => void) | null = null;
  private dragDist = 0;
  private pointerDown = new THREE.Vector2();
  private neon: THREE.PointLight;
  private cyan: THREE.PointLight;
  private boardCenter = new THREE.Vector3(4, 0, 4);
  private tileTexture: THREE.Texture | null = null;
  private portraitTextures = new Map<string, THREE.Texture>();
  private clashTexture: THREE.Texture | null = null;
  private hasFramed = false;
  /** Skip full mesh rebuild when board content unchanged (huge perf win). */
  private fieldSig = '';
  private highlightMeshes = new Map<SectorId, THREE.Mesh>();

  constructor(host: HTMLElement) {
    this.host = host;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07060f);
    this.scene.fog = new THREE.FogExp2(0x07060f, 0.028);

    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;

    this.camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 100);
    this.camera.position.copy(this.boardCenter).add(TABLETOP_OFFSET);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
    host.appendChild(this.renderer.domElement);

    // Tabletop controls: no rotate — zoom + pan only
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.enableRotate = false;
    this.controls.enablePan = true;
    this.controls.enableZoom = true;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 28;
    this.controls.zoomSpeed = 1.1;
    this.controls.panSpeed = 0.85;
    // Mouse: left-drag pans the board (not orbit)
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.PAN,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    this.controls.target.copy(this.boardCenter);
    this.camera.lookAt(this.boardCenter);
    this.controls.update();

    this.scene.add(new THREE.AmbientLight(0x5577aa, 0.65));
    this.neon = new THREE.PointLight(0xff2bd6, 48, 48);
    this.neon.position.set(2, 9, 2);
    this.scene.add(this.neon);
    this.cyan = new THREE.PointLight(0x2bf0ff, 42, 48);
    this.cyan.position.set(10, 8, 10);
    this.scene.add(this.cyan);
    const dir = new THREE.DirectionalLight(0xffffff, 0.45);
    dir.position.set(6, 14, 4);
    this.scene.add(dir);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshStandardMaterial({ color: 0x080812, metalness: 0.5, roughness: 0.7 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(4, -0.04, 4);
    this.scene.add(ground);

    this.root = new THREE.Group();
    this.fxRoot = new THREE.Group();
    this.scene.add(this.root, this.fxRoot);

    // Selection ring (reused)
    const ringGeo = new THREE.RingGeometry(0.55, 0.68, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x2bf0ff,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    this.selectionRing = new THREE.Mesh(ringGeo, ringMat);
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('resize', this.onResize);
    this.loop();
  }

  /**
   * Load 2D art for the 3D field. Never hangs forever — timeouts + absolute paths.
   * Portraits load in background so the board can appear quickly.
   */
  async loadArt(): Promise<void> {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');

    const load = (url: string, ms = 4000): Promise<THREE.Texture | null> => {
      // Always root-absolute so Vite public/ assets resolve correctly
      const abs = url.startsWith('/') || url.startsWith('http') ? url : `/${url.replace(/^\.\//, '')}`;
      return new Promise((resolve) => {
        let done = false;
        const finish = (t: THREE.Texture | null) => {
          if (done) return;
          done = true;
          resolve(t);
        };
        const timer = window.setTimeout(() => finish(null), ms);
        try {
          loader.load(
            abs,
            (t) => {
              window.clearTimeout(timer);
              try {
                // Three r152+ ; ignore if missing
                if ('colorSpace' in t && (THREE as unknown as { SRGBColorSpace?: string }).SRGBColorSpace) {
                  (t as THREE.Texture & { colorSpace: string }).colorSpace = (
                    THREE as unknown as { SRGBColorSpace: string }
                  ).SRGBColorSpace;
                }
              } catch {
                /* ignore colorSpace */
              }
              finish(t);
            },
            undefined,
            () => {
              window.clearTimeout(timer);
              finish(null);
            },
          );
        } catch {
          window.clearTimeout(timer);
          finish(null);
        }
      });
    };

    // Critical: tile (board can show without it)
    this.tileTexture = await load('/assets/tiles/sector_base.jpg', 3000);
    if (this.tileTexture) {
      this.tileTexture.wrapS = this.tileTexture.wrapT = THREE.ClampToEdgeWrapping;
    }

    this.clashTexture = await load('/assets/combat/clash_impact.jpg', 3000);

    // Portraits — don't block boot more than ~2.5s total
    const portraitJobs = GANG_DEFS.map(async (g) => {
      const path = g.art.portrait ?? '/assets/portraits/neon_jackals.jpg';
      const abs = path.startsWith('/') ? path : `/${path}`;
      const tex = await load(abs, 2500);
      if (tex) this.portraitTextures.set(g.id, tex);
    });

    await Promise.race([
      Promise.all(portraitJobs),
      new Promise<void>((r) => window.setTimeout(r, 2500)),
    ]);

    // Finish remaining portraits in background (no await)
    void Promise.all(portraitJobs).then(() => {
      /* textures fill in; next sync will pick them up if caller re-syncs */
    });
  }

  setOnSelect(fn: (id: SectorId) => void): void {
    this.onSelect = fn;
  }

  private onPointerDown = (ev: PointerEvent): void => {
    this.pointerDown.set(ev.clientX, ev.clientY);
    this.dragDist = 0;
  };

  private onPointerMove = (ev: PointerEvent): void => {
    if (ev.buttons === 0) return;
    this.dragDist = Math.max(
      this.dragDist,
      Math.hypot(ev.clientX - this.pointerDown.x, ev.clientY - this.pointerDown.y),
    );
  };

  private onPointerUp = (ev: PointerEvent): void => {
    // Ignore click if user was panning the table
    if (this.dragDist > 8) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.tiles.values()], false);
    if (hits[0]) {
      const id = hits[0].object.userData.sectorId as SectorId;
      this.selected = id;
      this.updateSelectionRing(id);
      this.onSelect?.(id);
    }
  };

  private updateSelectionRing(id: SectorId): void {
    if (!this.selectionRing) return;
    const mesh = this.tiles.get(id);
    if (!mesh) {
      this.selectionRing.visible = false;
      return;
    }
    this.selectionRing.visible = true;
    this.selectionRing.position.set(mesh.position.x, mesh.position.y + 0.02, mesh.position.z);
  }

  private onResize = (): void => {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private disposeMaterial(mat: THREE.Material | THREE.Material[]): void {
    if (Array.isArray(mat)) {
      for (const m of mat) m.dispose();
    } else {
      mat.dispose();
    }
  }

  private clearHighlights(): void {
    for (const m of this.highlightMeshes.values()) {
      m.geometry.dispose();
      this.disposeMaterial(m.material as THREE.Material | THREE.Material[]);
      this.root.remove(m);
    }
    this.highlightMeshes.clear();
  }

  private clearField(): void {
    this.clearHighlights();
    for (const m of this.tiles.values()) {
      m.geometry.dispose();
      // Tiles use multi-material arrays (sides + textured top)
      this.disposeMaterial(m.material as THREE.Material | THREE.Material[]);
      this.root.remove(m);
    }
    for (const s of this.portraits.values()) {
      this.disposeMaterial(s.material as THREE.Material | THREE.Material[]);
      this.root.remove(s);
    }
    for (const m of this.landmarks.values()) {
      m.geometry.dispose();
      this.disposeMaterial(m.material as THREE.Material | THREE.Material[]);
      this.root.remove(m);
    }
    this.tiles.clear();
    this.portraits.clear();
    this.landmarks.clear();
  }

  /** Glow rings on legal move/claim/attack neighbors. */
  setHighlights(ids: SectorId[]): void {
    this.clearHighlights();
    for (const id of ids) {
      const tile = this.tiles.get(id);
      if (!tile) continue;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.42, 0.58, 28),
        new THREE.MeshBasicMaterial({
          color: 0x7dff6b,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(tile.position.x, tile.position.y + 0.04, tile.position.z);
      this.root.add(ring);
      this.highlightMeshes.set(id, ring);
    }
  }

  buildGrid(state: GameState): void {
    this.clearField();

    for (const sector of Object.values(state.sectors)) {
      const height =
        0.2 +
        (sector.owner ? 0.28 : 0) +
        sector.unrest * 0.06 +
        (sector.landmark ? 0.35 : 0) +
        Math.min(0.3, sector.gangIds.length * 0.05);

      const ownerColor = sector.owner
        ? state.players[sector.owner]?.color ?? 0x444466
        : 0x222233;

      // Side material: solid owner tint
      const sideMat = new THREE.MeshStandardMaterial({
        color: ownerColor,
        metalness: 0.45,
        roughness: 0.4,
        emissive: ownerColor,
        emissiveIntensity: sector.owner ? 0.12 : 0.02,
      });

      // Top: 2D sector art with owner tint
      const topMat = new THREE.MeshStandardMaterial({
        map: this.tileTexture,
        color: sector.owner ? ownerColor : 0x8899aa,
        metalness: 0.25,
        roughness: 0.55,
        emissive: sector.landmark ? 0x442266 : 0x000000,
        emissiveIntensity: sector.landmark ? 0.25 : 0,
      });

      const geo = new THREE.BoxGeometry(TILE - GAP, height, TILE - GAP);
      // materials: right, left, top, bottom, front, back
      const mesh = new THREE.Mesh(geo, [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
      mesh.position.set(sector.x * TILE, height / 2, sector.y * TILE);
      mesh.userData.sectorId = sector.id;
      this.root.add(mesh);
      this.tiles.set(sector.id, mesh);

      // 2D portrait billboards for gangs (stacked slightly)
      sector.gangIds.forEach((gid, i) => {
        const gang = state.gangs[gid];
        if (!gang) return;
        const tex =
          this.portraitTextures.get(gang.defId) ??
          this.portraitTextures.get('neon_jackals') ??
          null;
        if (!tex) return;
        const mat = new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          depthTest: true,
        });
        const sprite = new THREE.Sprite(mat);
        const scale = 0.55;
        sprite.scale.set(scale, scale, 1);
        const ox = (i % 2) * 0.22 - 0.1;
        const oz = Math.floor(i / 2) * 0.22 - 0.05;
        sprite.position.set(
          sector.x * TILE + ox,
          height + 0.35 + i * 0.05,
          sector.y * TILE + oz,
        );
        sprite.userData.gangId = gid;
        sprite.userData.sectorId = sector.id;
        this.root.add(sprite);
        this.portraits.set(gid, sprite);
      });

      if (sector.landmark) {
        const star = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.18, 0),
          new THREE.MeshStandardMaterial({
            color: 0xffc14a,
            emissive: 0xff2bd6,
            emissiveIntensity: 0.6,
            metalness: 0.6,
            roughness: 0.3,
          }),
        );
        star.position.set(sector.x * TILE + 0.35, height + 0.35, sector.y * TILE - 0.3);
        this.root.add(star);
        this.landmarks.set(sector.id, star);
      }
    }

    const cx = ((state.mapWidth - 1) * TILE) / 2;
    const cz = ((state.mapHeight - 1) * TILE) / 2;
    this.boardCenter.set(cx, 0, cz);
    if (!this.hasFramed) {
      this.frameTabletop(this.boardCenter);
      this.hasFramed = true;
    }

    if (this.selected) this.updateSelectionRing(this.selected);
  }

  /** Snap camera to fixed tabletop angle over a point (preserves zoom distance). */
  private frameTabletop(target: THREE.Vector3, preserveDistance = false): void {
    const dist = preserveDistance
      ? this.camera.position.distanceTo(this.controls.target)
      : TABLETOP_OFFSET.length();
    const dir = TABLETOP_OFFSET.clone().normalize();
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.camera.lookAt(target);
    this.controls.update();
  }

  private fingerprint(state: GameState): string {
    // Orders don't affect tile mesh layout — omit them for fewer rebuilds
    const sectors = Object.values(state.sectors)
      .map(
        (s) =>
          `${s.id}:${s.owner ?? '-'}:${s.unrest}:${s.gangIds.join(',')}:${s.landmark?.id ?? ''}`,
      )
      .join('|');
    const gangs = Object.values(state.gangs)
      .map((g) => `${g.id}:${g.defId}:${g.sectorId}:${g.hp}`)
      .join('|');
    return `${sectors}#${gangs}#tex${this.portraitTextures.size}`;
  }

  sync(state: GameState, selected?: SectorId | null): void {
    if (selected !== undefined) this.selected = selected;
    const sig = this.fingerprint(state);
    if (sig !== this.fieldSig || this.tiles.size === 0) {
      this.fieldSig = sig;
      this.buildGrid(state);
    } else if (this.selected) {
      this.updateSelectionRing(this.selected);
    } else if (this.selectionRing) {
      this.selectionRing.visible = false;
    }
    const heat = state.cityHeat / 100;
    this.neon.intensity = 40 + heat * 45;
    this.cyan.intensity = 38 + (1 - heat) * 18;
  }

  focusSector(id: SectorId): void {
    const mesh = this.tiles.get(id);
    if (!mesh) return;
    const target = new THREE.Vector3(mesh.position.x, 0, mesh.position.z);
    // Soft pan toward sector; keep fixed viewing angle
    const next = this.controls.target.clone().lerp(target, 0.55);
    this.frameTabletop(next, true);
  }

  playCombatFx(result: CombatResult): void {
    const mesh = this.tiles.get(result.sectorId);
    const [sx, sy] = result.sectorId.split(',').map(Number) as [number, number];
    const base = new THREE.Vector3(
      sx * TILE,
      mesh ? mesh.position.y + 0.6 : 1,
      sy * TILE,
    );

    // 2D clash card floating over the fight
    if (this.clashTexture) {
      const card = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.clashTexture,
          transparent: true,
          opacity: 0.95,
        }),
      );
      card.scale.set(1.4, 1.4, 1);
      card.position.copy(base).add(new THREE.Vector3(0, 0.8, 0));
      this.fxRoot.add(card);
      const t0 = performance.now();
      const fade = (): void => {
        if (this.disposed) return;
        const t = (performance.now() - t0) / 1100;
        card.position.y = base.y + 0.8 + t * 0.4;
        (card.material as THREE.SpriteMaterial).opacity = Math.max(0, 0.95 * (1 - t));
        if (t < 1) requestAnimationFrame(fade);
        else {
          this.fxRoot.remove(card);
          (card.material as THREE.Material).dispose();
        }
      };
      requestAnimationFrame(fade);
    }

    const flash = new THREE.PointLight(result.attackerWon ? 0x7dff6b : 0xff2bd6, 90, 9);
    flash.position.copy(base);
    this.fxRoot.add(flash);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.28, 32),
      new THREE.MeshBasicMaterial({
        color: result.attackerWon ? 0x2bf0ff : 0xff2bd6,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(base);
    this.fxRoot.add(ring);

    const sparks: THREE.Mesh[] = [];
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 6, 6),
        new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff2bd6 : 0x2bf0ff, transparent: true }),
      );
      s.position.copy(base);
      s.userData.vel = new THREE.Vector3(
        (Math.random() - 0.5) * 0.16,
        Math.random() * 0.2 + 0.04,
        (Math.random() - 0.5) * 0.16,
      );
      this.fxRoot.add(s);
      sparks.push(s);
    }

    // Subtle zoom-in punch along the fixed tabletop axis (no free camera fly)
    const target0 = this.controls.target.clone();
    const camStart = this.camera.position.clone();
    const dir = camStart.clone().sub(target0).normalize();
    const camPunch = camStart.clone().addScaledVector(dir, -1.8);
    const t0 = performance.now();
    const animate = (): void => {
      if (this.disposed) return;
      const t = Math.min(1, (performance.now() - t0) / 850);
      ring.scale.setScalar(1 + t * 7);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
      flash.intensity = 90 * (1 - t);
      for (const s of sparks) {
        s.position.add(s.userData.vel as THREE.Vector3);
        (s.userData.vel as THREE.Vector3).y -= 0.007;
        (s.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      }
      if (t < 0.4) this.camera.position.lerpVectors(camStart, camPunch, (t / 0.4) * 0.85);
      else this.camera.position.lerpVectors(camPunch, camStart, (t - 0.4) / 0.6);
      this.camera.lookAt(this.controls.target);

      if (t < 1) requestAnimationFrame(animate);
      else {
        this.fxRoot.remove(flash, ring, ...sparks);
        ring.geometry.dispose();
        (ring.material as THREE.Material).dispose();
        for (const s of sparks) {
          s.geometry.dispose();
          (s.material as THREE.Material).dispose();
        }
        this.camera.position.copy(camStart);
        this.camera.lookAt(this.controls.target);
      }
    };
    requestAnimationFrame(animate);
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.controls.update();
    // Soft-clamp pan so you can't slide completely off the table
    const t = this.controls.target;
    t.x = THREE.MathUtils.clamp(t.x, this.boardCenter.x - 7, this.boardCenter.x + 7);
    t.z = THREE.MathUtils.clamp(t.z, this.boardCenter.z - 7, this.boardCenter.z + 7);
    t.y = 0;
    // Keep fixed tabletop angle after pan/zoom
    const dist = this.camera.position.distanceTo(t);
    const dir = TABLETOP_OFFSET.clone().normalize();
    this.camera.position.copy(t).addScaledVector(dir, dist);
    this.camera.lookAt(t);

    if (this.selectionRing?.visible) {
      const s = 1 + 0.06 * Math.sin(performance.now() * 0.006);
      this.selectionRing.scale.set(s, s, s);
    }
    // Pulse legal destinations
    const pulse = 0.75 + 0.2 * Math.sin(performance.now() * 0.008);
    for (const h of this.highlightMeshes.values()) {
      (h.material as THREE.MeshBasicMaterial).opacity = pulse;
      const sc = 1 + 0.04 * Math.sin(performance.now() * 0.008);
      h.scale.set(sc, sc, sc);
    }
    this.neon.intensity = 42 + 12 * (0.5 + 0.5 * Math.sin(performance.now() * 0.002));
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.loop);
  };

  dispose(): void {
    this.disposed = true;
    this.controls.dispose();
    this.clearField();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
