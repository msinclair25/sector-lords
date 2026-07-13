import Phaser from 'phaser';
import { gangDefById, itemDefById, jobDefById, scenarioById, siteDefById } from '../../content';
import {
  ORDER_LABELS,
  equipmentBonuses,
  fogGangLabel,
  formatOdds,
  intelLevel,
  pathsToVictory,
  previewAttackWithIntel,
  researchableItems,
  sectorId,
  type CombatResult,
  type DebriefReport,
  type GameState,
  type GangInstance,
  type SectorId,
} from '../../engine';
import { recommendOrders } from '../../ai/heuristicAi';
import { SFX } from '../audio/SoundBank';
import { GameController } from '../GameController';
import type { Difficulty } from '../../engine';

const CELL = 72;
const MAP_OX = 24;
const MAP_OY = 88;
const TUTORIAL_KEY = 'sector-lords-tutorial-v1';

const TUTORIAL_STEPS = [
  'Welcome, Overlord. Click your cyan sector (near 1,1) to select a gang.',
  'Click an empty adjacent sector, then press Claim to expand.',
  'Open Hire / Next Hire to recruit from the rotating pool into owned land.',
  'Influence sites (labs, casinos) for cash, research, and combat bonuses.',
  'Scout borders before attacking — fog hides true odds. Then End Turn.',
];

export class GameScene extends Phaser.Scene {
  private controller!: GameController;
  private mapLayer!: Phaser.GameObjects.Container;
  private hudText!: Phaser.GameObjects.Text;
  private panelText!: Phaser.GameObjects.Text;
  private logText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private portrait!: Phaser.GameObjects.Image;
  private heatOverlay!: Phaser.GameObjects.Rectangle;
  private rainEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private tutorialText!: Phaser.GameObjects.Text;
  private selectedSector: SectorId | null = null;
  private selectedGangId: string | null = null;
  private hireIndex = 0;
  private researchIndex = 0;
  private inventIndex = 0;
  private jobIndex = 0;
  private tutorialStep = 0;
  private cellSprites = new Map<string, Phaser.GameObjects.Container>();
  private debriefOpen = false;

  constructor() {
    super('Game');
  }

  init(data: {
    controller?: GameController;
    scenarioId?: string;
    difficulty?: Difficulty;
    fresh?: boolean;
  }): void {
    if (data.controller) {
      this.controller = data.controller;
    } else if (data.fresh) {
      this.controller = new GameController();
      this.controller.newGame(data.scenarioId, data.difficulty);
    } else {
      this.controller = GameController.load() ?? new GameController();
      if (data.scenarioId || data.difficulty) {
        this.controller.newGame(data.scenarioId, data.difficulty);
      }
    }
  }

  create(): void {
    const w = this.scale.width;
    const h = this.scale.height;

    this.add.image(w / 2, h / 2, 'mood_bg').setDisplaySize(w, h).setAlpha(0.35);

    // Heat-reactive sky wash
    this.heatOverlay = this.add
      .rectangle(w / 2, h / 2, w, h, 0xff2bd6, 0)
      .setDepth(0)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.add
      .text(24, 16, 'SECTOR LORDS', {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '26px',
        color: '#ff2bd6',
        fontStyle: 'bold',
      })
      .setShadow(0, 0, '#2bf0ff', 8)
      .setDepth(5);

    this.hudText = this.add
      .text(24, 48, '', {
        fontFamily: 'Consolas, monospace',
        fontSize: '13px',
        color: '#c8f7ff',
      })
      .setDepth(5);

    this.mapLayer = this.add.container(0, 0).setDepth(2);
    this.buildMap(this.controller.state);

    const panelX = MAP_OX + 8 * CELL + 28;
    this.portrait = this.add
      .image(panelX + 60, MAP_OY + 60, 'portrait_neon_jackals')
      .setDisplaySize(120, 120)
      .setVisible(false)
      .setDepth(5);

    this.panelText = this.add
      .text(panelX, MAP_OY + 130, '', {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '12px',
        color: '#e8e6ff',
        wordWrap: { width: Math.max(280, w - panelX - 24) },
        lineSpacing: 3,
      })
      .setDepth(5);

    this.logText = this.add
      .text(MAP_OX, MAP_OY + 8 * CELL + 12, '', {
        fontFamily: 'Consolas, monospace',
        fontSize: '11px',
        color: '#9ad7e0',
        wordWrap: { width: w - 48 },
      })
      .setDepth(5);

    this.statusText = this.add
      .text(w / 2, h - 24, '', {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '14px',
        color: '#ffc14a',
      })
      .setOrigin(0.5)
      .setDepth(20);

    this.tutorialText = this.add
      .text(w / 2, 72, '', {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '14px',
        color: '#ffffff',
        backgroundColor: '#120f24cc',
        padding: { x: 12, y: 8 },
        align: 'center',
        wordWrap: { width: Math.min(640, w - 40) },
      })
      .setOrigin(0.5, 0)
      .setDepth(30)
      .setVisible(false);

    this.createRain(w, h);
    this.createButtons();
    this.controller.subscribe((s) => this.onState(s));
    this.initTutorial();

    this.input.keyboard?.on('keydown-ENTER', () => this.doEndTurn());
    this.input.keyboard?.on('keydown-U', () => {
      this.controller.undoOrder();
      this.setStatus('Undid last change.');
    });
    this.input.keyboard?.on('keydown-N', () => this.cycleNextGang());
    this.input.keyboard?.on('keydown-H', () => this.cycleHire(1));
    this.input.keyboard?.on('keydown-R', () => this.actResearch());
    this.input.keyboard?.on('keydown-T', () => this.advanceTutorial(true));
    this.input.keyboard?.on('keydown-D', () => {
      const d = this.controller.getDebrief();
      if (d) this.showDebrief(d);
    });
  }

  private createRain(w: number, _h: number): void {
    // Lightweight rain via many tiny rectangles (no texture required)
    const g = this.make.graphics({ x: 0, y: 0 });
    g.fillStyle(0x88ddff, 0.5);
    g.fillRect(0, 0, 2, 10);
    g.generateTexture('raindrop', 2, 10);
    g.destroy();

    this.rainEmitter = this.add.particles(0, 0, 'raindrop', {
      x: { min: 0, max: w },
      y: -20,
      lifespan: 1800,
      speedY: { min: 280, max: 420 },
      speedX: { min: -40, max: -10 },
      scale: { min: 0.4, max: 1 },
      alpha: { start: 0.35, end: 0 },
      frequency: 40,
      quantity: 2,
      blendMode: 'ADD',
    });
    this.rainEmitter.setDepth(1);
  }

  private initTutorial(): void {
    try {
      const done = localStorage.getItem(TUTORIAL_KEY);
      if (done === 'done') {
        this.tutorialStep = TUTORIAL_STEPS.length;
        return;
      }
      this.tutorialStep = done ? Number(done) || 0 : 0;
    } catch {
      this.tutorialStep = 0;
    }
    this.refreshTutorial();
  }

  private refreshTutorial(): void {
    if (this.tutorialStep >= TUTORIAL_STEPS.length) {
      this.tutorialText.setVisible(false);
      return;
    }
    this.tutorialText
      .setText(
        `TIP ${this.tutorialStep + 1}/${TUTORIAL_STEPS.length}: ${TUTORIAL_STEPS[this.tutorialStep]}  (T = next · skip later)`,
      )
      .setVisible(true);
  }

  private advanceTutorial(manual = false): void {
    if (this.tutorialStep >= TUTORIAL_STEPS.length) {
      if (manual) {
        this.tutorialStep = 0;
        try {
          localStorage.removeItem(TUTORIAL_KEY);
        } catch {
          /* ignore */
        }
        this.refreshTutorial();
      }
      return;
    }
    this.tutorialStep += 1;
    try {
      localStorage.setItem(
        TUTORIAL_KEY,
        this.tutorialStep >= TUTORIAL_STEPS.length ? 'done' : String(this.tutorialStep),
      );
    } catch {
      /* ignore */
    }
    this.refreshTutorial();
  }

  private updateAtmosphere(state: GameState): void {
    const heat = state.cityHeat / 100;
    this.heatOverlay.setAlpha(0.02 + heat * 0.12);
    if (this.rainEmitter) {
      // Heavier rain when heat high (police weather)
      this.rainEmitter.frequency = heat > 0.6 ? 18 : 40;
      this.rainEmitter.setAlpha(0.2 + heat * 0.25);
    }
  }

  private createButtons(): void {
    const y = MAP_OY + 8 * CELL + 110;
    const labels: Array<{ label: string; fn: () => void; color: number }> = [
      { label: 'End Turn', fn: () => this.doEndTurn(), color: 0xff2bd6 },
      { label: 'Claim', fn: () => this.actClaim(), color: 0x2bf0ff },
      { label: 'Attack', fn: () => this.actAttack(), color: 0xff6b4a },
      { label: 'Unrest', fn: () => this.actUnrest(), color: 0xffc14a },
      { label: 'Influence', fn: () => this.actInfluence(), color: 0x7dff6b },
      { label: 'Move', fn: () => this.actMove(), color: 0xc58cff },
      { label: 'Hire (H)', fn: () => this.actHire(), color: 0x2bf0ff },
      { label: 'Next Hire', fn: () => this.cycleHire(1), color: 0x6688aa },
      { label: 'Research (R)', fn: () => this.actResearch(), color: 0x9ad7e0 },
      { label: 'Next Tech', fn: () => this.cycleResearch(1), color: 0x6688aa },
      { label: 'Fabricate', fn: () => this.actFabricate(), color: 0xffc14a },
      { label: 'Equip', fn: () => this.actEquip(), color: 0x7dff6b },
      { label: 'Scout', fn: () => this.actScout(), color: 0xc58cff },
      { label: 'Accept Job', fn: () => this.actAcceptJob(), color: 0xffc14a },
      { label: 'Next Job', fn: () => this.cycleJob(1), color: 0x6688aa },
      { label: 'Recommend', fn: () => this.actRecommend(), color: 0x9ad7e0 },
      {
        label: 'Undo',
        fn: () => {
          this.controller.undoOrder();
          this.setStatus('Undo');
        },
        color: 0x8888aa,
      },
      {
        label: 'Scenario',
        fn: () => {
          const id = this.controller.cycleScenario();
          this.selectedSector = null;
          this.selectedGangId = null;
          this.setStatus(`Scenario: ${scenarioById(id).name}`);
        },
        color: 0x666688,
      },
      {
        label: 'Difficulty',
        fn: () => {
          const d = this.controller.cycleDifficulty();
          this.selectedSector = null;
          this.selectedGangId = null;
          this.setStatus(`Difficulty: ${d}`);
        },
        color: 0x666688,
      },
      {
        label: 'Debrief',
        fn: () => {
          const d = this.controller.getDebrief();
          if (d) this.showDebrief(d);
          else this.setStatus('Debrief unlocks when the match ends.');
        },
        color: 0x9ad7e0,
      },
      {
        label: 'Tips (T)',
        fn: () => this.advanceTutorial(true),
        color: 0x8888aa,
      },
      {
        label: 'New Game',
        fn: () => {
          this.controller.newGame();
          this.selectedSector = null;
          this.selectedGangId = null;
          this.debriefOpen = false;
          this.setStatus('New game.');
          SFX.play('ui');
        },
        color: 0x666688,
      },
      {
        label: 'Menu',
        fn: () => {
          SFX.play('ui');
          this.scene.start('Menu');
        },
        color: 0x666688,
      },
    ];

    labels.forEach((b, i) => {
      const x = MAP_OX + (i % 5) * 150;
      const yy = y + Math.floor(i / 5) * 36;
      this.makeButton(x, yy, b.label, b.color, b.fn);
    });
  }

  private makeButton(
    x: number,
    y: number,
    label: string,
    color: number,
    onClick: () => void,
  ): void {
    const bg = this.add
      .rectangle(x, y, 140, 30, 0x120f24, 0.92)
      .setStrokeStyle(2, color)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(x + 70, y + 15, label, {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '12px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setDepth(1);
    bg.on('pointerover', () => bg.setFillStyle(color, 0.25));
    bg.on('pointerout', () => bg.setFillStyle(0x120f24, 0.92));
    bg.on('pointerdown', () => {
      SFX.play('ui');
      onClick();
    });
  }

  private buildMap(state: GameState): void {
    this.mapLayer.removeAll(true);
    this.cellSprites.clear();

    for (let y = 0; y < state.mapHeight; y++) {
      for (let x = 0; x < state.mapWidth; x++) {
        const id = sectorId(x, y);
        const cx = MAP_OX + x * CELL;
        const cy = MAP_OY + y * CELL;
        const container = this.add.container(cx, cy);
        const tile = this.add
          .image(0, 0, 'sector_tile')
          .setOrigin(0, 0)
          .setDisplaySize(CELL - 2, CELL - 2)
          .setInteractive({ useHandCursor: true });
        tile.on('pointerdown', () => this.selectSector(id));
        container.add(tile);

        const border = this.add
          .rectangle(0, 0, CELL - 2, CELL - 2)
          .setOrigin(0, 0)
          .setStrokeStyle(2, 0x333355)
          .setFillStyle(0x000000, 0);
        container.add(border);

        const label = this.add.text(4, 4, '', {
          fontFamily: 'Consolas, monospace',
          fontSize: '10px',
          color: '#ffffff',
        });
        container.add(label);

        this.mapLayer.add(container);
        this.cellSprites.set(id, container);
      }
    }
  }

  private onState(state: GameState): void {
    this.paintMap(state);
    this.paintHud(state);
    this.paintPanel(state);
    this.paintLog(state);
    this.paintPortrait(state);
    this.updateAtmosphere(state);
    if (state.winnerId) {
      this.setStatus(`${state.players[state.winnerId]?.name} controls the city! (Debrief)`);
    }
  }

  private paintPortrait(state: GameState): void {
    const gang = this.selectedGangId ? state.gangs[this.selectedGangId] : null;
    if (gang) {
      const key = `portrait_${gang.defId}`;
      this.portrait
        .setTexture(this.textures.exists(key) ? key : 'portrait_neon_jackals')
        .setVisible(true);
      return;
    }
    // Show focused hire-pool candidate when no gang selected
    if (state.hirePool.length > 0) {
      const entry = state.hirePool[this.hireIndex % state.hirePool.length]!;
      const key = `portrait_${entry.defId}`;
      this.portrait
        .setTexture(this.textures.exists(key) ? key : 'portrait_neon_jackals')
        .setVisible(true);
      return;
    }
    this.portrait.setVisible(false);
  }

  private paintMap(state: GameState): void {
    for (const sector of Object.values(state.sectors)) {
      const container = this.cellSprites.get(sector.id);
      if (!container) continue;
      const border = container.list[1] as Phaser.GameObjects.Rectangle;
      const label = container.list[2] as Phaser.GameObjects.Text;
      const owner = sector.owner ? state.players[sector.owner] : null;
      const color = owner?.color ?? 0x333355;
      const selected = this.selectedSector === sector.id;
      border.setStrokeStyle(selected ? 3 : 2, selected ? 0xffffff : color);
      border.setFillStyle(owner ? color : 0x000000, owner ? 0.22 : 0);

      const unrest = sector.unrest;
      const viewer = this.controller.humanId;
      const intel = intelLevel(state, viewer, sector.id);
      const gLabel = fogGangLabel(state, viewer, sector.id);
      const fogMark = intel === 0 ? '░' : intel === 1 ? '▒' : '';
      const star = sector.landmark && intel > 0 ? '★' : '';
      label.setText(
        `${sector.x},${sector.y}${fogMark}${star}\n${gLabel !== '0' && gLabel !== '~0' ? `⚔${gLabel}` : ''}${unrest && intel > 0 ? ` ☢${unrest}` : ''}`,
      );
      if (sector.landmark) {
        border.setStrokeStyle(selected ? 3 : 2, selected ? 0xffffff : 0xffc14a);
      }
    }
  }

  private paintHud(state: GameState): void {
    const me = state.players[this.controller.humanId]!;
    const fc = this.controller.forecast();
    const paths = pathsToVictory(state);
    const myScore = paths.scores.find((s) => s.playerId === this.controller.humanId);
    const research = me.researchProgress
      ? `${itemDefById(me.researchProgress.itemId).name} ${me.researchProgress.points}/${itemDefById(me.researchProgress.itemId).researchCost}`
      : 'idle';
    const scen = scenarioById(state.scenarioId);
    this.hudText.setText(
      `${scen.name} · ${state.difficulty}  |  Turn ${state.turn}  |  $${me.cash} (→$${fc.projectedCash[me.id] ?? me.cash})  |  Sup ${me.support}  |  Heat ${state.cityHeat} (${fc.policeRisk})  |  R&D: ${research}  |  ${paths.label}: ${myScore?.value ?? 0}`,
    );
  }

  private paintPanel(state: GameState): void {
    const me = state.players[this.controller.humanId]!;
    const lines: string[] = [];
    lines.push('— SECTOR / GANG —');
    if (!this.selectedSector) {
      lines.push('Click a sector on the map.');
    } else {
      const s = state.sectors[this.selectedSector]!;
      const owner = s.owner ? state.players[s.owner]?.name : 'Neutral';
      lines.push(`Sector ${s.id}  Owner: ${owner}  Unrest ${s.unrest}/10`);
      if (s.landmark) {
        lines.push(
          `★ LANDMARK: ${s.landmark.name} (+$${s.landmark.cashBonus}/t, +${s.landmark.supportBonus} sup)`,
        );
      }
      lines.push('Sites:');
      s.sites.forEach((site, i) => {
        const def = siteDefById(site.defId);
        const inf = site.influencer ? state.players[site.influencer]?.name : '—';
        lines.push(`  [${i}] ${def.name} (inf: ${inf}) +$${def.cashBonus} R+${def.researchBonus}`);
      });
      lines.push('Gangs:');
      if (s.gangIds.length === 0) lines.push('  (none)');
      for (const gid of s.gangIds) {
        const g = state.gangs[gid]!;
        const def = gangDefById(g.defId);
        const eq = equipmentBonuses(state, gid);
        const mark = this.selectedGangId === gid ? '►' : ' ';
        const gear =
          g.equipped.length > 0
            ? g.equipped.map((id) => itemDefById(id).name).join(', ')
            : 'unarmed';
        lines.push(
          `${mark} ${def.name} [${state.players[g.ownerId]?.name}] C${def.combat + eq.combat}/D${def.defense + eq.defense} T${def.tech} HP${g.hp}`,
        );
        lines.push(`    ${def.signature}`);
        lines.push(`    Gear: ${gear}`);
      }
    }

    lines.push('');
    lines.push('— HIRE POOL (Next Hire / H) —');
    state.hirePool.forEach((h, i) => {
      const def = gangDefById(h.defId);
      const mark = i === this.hireIndex % Math.max(1, state.hirePool.length) ? '►' : ' ';
      lines.push(`${mark} ${def.name} $${def.hireCost} C${def.combat} T${def.tech}`);
    });

    lines.push('');
    lines.push('— RESEARCH / GEAR —');
    lines.push(`Unlocked: ${me.researchedItemIds.map((id) => itemDefById(id).name).join(', ') || 'none'}`);
    const inv = Object.entries(me.inventory);
    lines.push(
      `Inventory: ${inv.map(([id, n]) => `${itemDefById(id).name}×${n}`).join(', ') || 'empty'}`,
    );
    if (this.selectedGangId && state.gangs[this.selectedGangId]?.ownerId === this.controller.humanId) {
      const opts = researchableItems(state, this.controller.humanId, this.selectedGangId);
      if (opts.length) {
        const pick = opts[this.researchIndex % opts.length]!;
        lines.push(`Research target: ${pick.name} (tech ${pick.techLevel}, cost ${pick.researchCost})`);
      } else {
        lines.push('Research target: (none available for this gang)');
      }
    }

    lines.push('');
    lines.push('— JOB BOARD —');
    if (state.jobBoard.length === 0) lines.push('  (empty — refreshes periodically)');
    state.jobBoard.forEach((id, i) => {
      const def = jobDefById(id);
      const mark = i === this.jobIndex % Math.max(1, state.jobBoard.length) ? '►' : ' ';
      lines.push(`${mark} ${def.name} ($${def.rewardCash}, ${def.timeLimit}t)`);
      lines.push(`    ${def.description}`);
    });
    const myJobs = state.activeJobs.filter((j) => j.playerId === this.controller.humanId);
    if (myJobs.length) {
      lines.push('Active:');
      for (const j of myJobs) {
        const def = jobDefById(j.defId);
        lines.push(
          `  ${def.name}: ${j.progress}/${def.goalCount} (exp T${j.expiresTurn})`,
        );
      }
    }

    lines.push('');
    lines.push('— YOUR ORDERS —');
    const mine = state.orders.filter((o) => o.playerId === this.controller.humanId);
    if (mine.length === 0) lines.push('  (none yet)');
    for (const o of mine) {
      const g = state.gangs[o.gangId];
      const name = g ? gangDefById(g.defId).name : o.gangId;
      const extra = o.itemId
        ? ` ${itemDefById(o.itemId).name}`
        : o.targetSectorId
          ? ` → ${o.targetSectorId}`
          : '';
      lines.push(`  ${ORDER_LABELS[o.type]} — ${name}${extra}`);
    }

    const fc = this.controller.forecast();
    if (fc.pendingBattles.length) {
      lines.push('');
      lines.push('— BATTLE FORECAST —');
      for (const b of fc.pendingBattles) {
        const odds = b.fogged
          ? `~${Math.round(b.winChanceMin * 100)}–${Math.round(b.winChanceMax * 100)}%`
          : `~${Math.round(b.winChance * 100)}%`;
        lines.push(`  Attack ${b.sectorId}: ${odds} win${b.fogged ? ' (fog)' : ''}`);
      }
    }

    this.panelText.setText(lines.join('\n'));
  }

  private paintLog(state: GameState): void {
    const recent = state.log.slice(-7);
    this.logText.setText(recent.map((e) => `[T${e.turn}] ${e.message}`).join('\n'));
  }

  private selectSector(id: SectorId): void {
    if (this.debriefOpen) return;
    const state = this.controller.state;
    if (this.selectedSector === id) {
      const s = state.sectors[id]!;
      const mine = s.gangIds.filter((g) => state.gangs[g]?.ownerId === this.controller.humanId);
      if (mine.length === 0) this.selectedGangId = null;
      else {
        const idx = mine.indexOf(this.selectedGangId ?? '');
        this.selectedGangId = mine[(idx + 1) % mine.length]!;
      }
    } else {
      this.selectedSector = id;
      const s = state.sectors[id]!;
      this.selectedGangId =
        s.gangIds.find((g) => state.gangs[g]?.ownerId === this.controller.humanId) ?? null;
    }
    this.paintMap(state);
    this.paintPanel(state);
    this.paintPortrait(state);
    // Tutorial: selecting own sector advances step 0
    if (
      this.tutorialStep === 0 &&
      state.sectors[id]?.owner === this.controller.humanId
    ) {
      this.advanceTutorial();
    }
  }

  private requireMyGang(): GangInstance | null {
    const state = this.controller.state;
    if (this.selectedGangId) {
      const g = state.gangs[this.selectedGangId];
      if (g && g.ownerId === this.controller.humanId) return g;
    }
    if (this.selectedSector) {
      const s = state.sectors[this.selectedSector]!;
      for (const gid of s.gangIds) {
        const g = state.gangs[gid];
        if (g && g.ownerId === this.controller.humanId) {
          this.selectedGangId = gid;
          return g;
        }
      }
    }
    this.setStatus('Select one of your gangs (click your sector).');
    return null;
  }

  private actMove(): void {
    const gang = this.requireMyGang();
    if (!gang || !this.selectedSector || this.selectedSector === gang.sectorId) {
      this.setStatus('Click destination sector, then Move.');
      return;
    }
    const err = this.controller.orderForGang('move', gang.id, this.selectedSector);
    this.setStatus(err ?? `Move ordered → ${this.selectedSector}`);
    SFX.play(err ? 'error' : 'ui');
  }

  private actClaim(): void {
    const gang = this.requireMyGang();
    if (!gang || !this.selectedSector || this.selectedSector === gang.sectorId) {
      this.setStatus('Click empty adjacent sector, then Claim.');
      return;
    }
    const target = this.selectedSector;
    const err = this.controller.orderForGang('claim', gang.id, target);
    this.setStatus(err ?? `Claim ordered → ${target}`);
    SFX.play(err ? 'error' : 'claim');
    if (!err) {
      this.flashSector(target, 0x2bf0ff);
      if (this.tutorialStep === 1) this.advanceTutorial();
    }
  }

  private flashSector(id: SectorId, color: number): void {
    const container = this.cellSprites.get(id);
    if (!container) return;
    const border = container.list[1] as Phaser.GameObjects.Rectangle;
    const prev = border.strokeColor;
    border.setStrokeStyle(4, color);
    this.tweens.add({
      targets: border,
      alpha: 0.3,
      yoyo: true,
      duration: 180,
      repeat: 2,
      onComplete: () => {
        border.setAlpha(1);
        border.setStrokeStyle(2, prev);
      },
    });
  }

  private actAttack(): void {
    const gang = this.requireMyGang();
    if (!gang || !this.selectedSector || this.selectedSector === gang.sectorId) {
      this.setStatus('Select enemy sector, then Attack.');
      return;
    }
    const prev = previewAttackWithIntel(
      this.controller.state,
      [gang.id],
      this.selectedSector,
      this.controller.humanId,
    );
    const err = this.controller.orderForGang('attack', gang.id, this.selectedSector);
    this.setStatus(err ?? `Attack ${this.selectedSector} (${formatOdds(prev)}).`);
    SFX.play(err ? 'error' : 'attack');
  }

  private actScout(): void {
    const gang = this.requireMyGang();
    if (!gang || !this.selectedSector || this.selectedSector === gang.sectorId) {
      this.setStatus('Select adjacent sector, then Scout.');
      return;
    }
    const err = this.controller.orderForGang('scout', gang.id, this.selectedSector);
    this.setStatus(err ?? `Scout ${this.selectedSector} ordered (full intel 4 turns).`);
    SFX.play(err ? 'error' : 'ui');
  }

  private cycleJob(dir: number): void {
    const n = this.controller.state.jobBoard.length;
    if (n === 0) {
      this.setStatus('No jobs on the board.');
      return;
    }
    this.jobIndex = (this.jobIndex + dir + n) % n;
    this.paintPanel(this.controller.state);
    const def = jobDefById(this.controller.state.jobBoard[this.jobIndex]!);
    this.setStatus(`Job focus: ${def.name}`);
  }

  private actAcceptJob(): void {
    const board = this.controller.state.jobBoard;
    if (board.length === 0) {
      this.setStatus('Job board empty.');
      return;
    }
    const id = board[this.jobIndex % board.length]!;
    const msg = this.controller.acceptJob(id);
    this.setStatus(msg);
    this.jobIndex = 0;
  }

  private actUnrest(): void {
    const gang = this.requireMyGang();
    if (!gang) return;
    const err = this.controller.orderForGang('unrest', gang.id);
    this.setStatus(err ?? 'Unrest ordered.');
    SFX.play(err ? 'error' : 'unrest');
  }

  private actInfluence(): void {
    const gang = this.requireMyGang();
    if (!gang) return;
    const sector = this.controller.state.sectors[gang.sectorId]!;
    const slot = sector.sites.findIndex((s) => s.influencer !== this.controller.humanId);
    if (slot < 0) {
      this.setStatus('All sites already influenced.');
      return;
    }
    const err = this.controller.orderForGang('influence', gang.id, undefined, slot as 0 | 1 | 2);
    this.setStatus(err ?? `Influence site [${slot}] ordered.`);
  }

  private cycleHire(dir: number): void {
    const n = this.controller.state.hirePool.length;
    if (n === 0) return;
    this.hireIndex = (this.hireIndex + dir + n) % n;
    this.paintPanel(this.controller.state);
    const def = gangDefById(this.controller.state.hirePool[this.hireIndex]!.defId);
    this.setStatus(`Hire focus: ${def.name}`);
  }

  private actHire(): void {
    const state = this.controller.state;
    if (state.hirePool.length === 0) {
      this.setStatus('Hire pool empty.');
      return;
    }
    const entry = state.hirePool[this.hireIndex % state.hirePool.length]!;
    let sid: string | null = this.selectedSector;
    if (!sid || state.sectors[sid]?.owner !== this.controller.humanId) {
      sid = Object.values(state.sectors).find((s) => s.owner === this.controller.humanId)?.id ?? null;
    }
    if (!sid) {
      this.setStatus('Need an owned sector to hire into.');
      return;
    }
    const def = gangDefById(entry.defId);
    const err = this.controller.hire(entry.defId, sid);
    this.setStatus(err ?? `Hired ${def.name}.`);
    SFX.play(err ? 'error' : 'hire');
    this.hireIndex = 0;
  }

  private cycleResearch(dir: number): void {
    const gang = this.requireMyGang();
    if (!gang) return;
    const opts = researchableItems(
      this.controller.state,
      this.controller.humanId,
      gang.id,
    );
    if (opts.length === 0) {
      this.setStatus('No researchable items for this gang.');
      return;
    }
    this.researchIndex = (this.researchIndex + dir + opts.length) % opts.length;
    this.paintPanel(this.controller.state);
    this.setStatus(`Research focus: ${opts[this.researchIndex]!.name}`);
  }

  private actResearch(): void {
    const gang = this.requireMyGang();
    if (!gang) return;
    const me = this.controller.state.players[this.controller.humanId]!;
    let itemId = me.researchProgress?.itemId;
    if (!itemId) {
      const opts = researchableItems(this.controller.state, this.controller.humanId, gang.id);
      if (opts.length === 0) {
        this.setStatus('Nothing to research with this gang (need higher tech or all unlocked).');
        return;
      }
      itemId = opts[this.researchIndex % opts.length]!.id;
    }
    const err = this.controller.orderForGang('research', gang.id, undefined, undefined, itemId);
    this.setStatus(err ?? `Research ${itemDefById(itemId).name} ordered.`);
    SFX.play(err ? 'error' : 'research');
  }

  private actFabricate(): void {
    const me = this.controller.state.players[this.controller.humanId]!;
    if (me.researchedItemIds.length === 0) {
      this.setStatus('Research something first.');
      return;
    }
    // Prefer items not in inventory
    const pick =
      me.researchedItemIds.find((id) => (me.inventory[id] ?? 0) === 0) ??
      me.researchedItemIds[this.inventIndex % me.researchedItemIds.length]!;
    const msg = this.controller.fabricate(pick);
    this.setStatus(msg);
  }

  private actEquip(): void {
    const gang = this.requireMyGang();
    if (!gang) return;
    const me = this.controller.state.players[this.controller.humanId]!;
    const inv = Object.keys(me.inventory).filter((id) => (me.inventory[id] ?? 0) > 0);
    if (inv.length === 0) {
      this.setStatus('Inventory empty — Fabricate researched gear first.');
      return;
    }
    const itemId = inv[this.inventIndex % inv.length]!;
    this.inventIndex++;
    const msg = this.controller.equip(gang.id, itemId);
    this.setStatus(msg);
  }

  private actRecommend(): void {
    const rec = recommendOrders(this.controller.state, this.controller.humanId);
    let added = 0;
    for (const o of rec) {
      if (!this.controller.tryQueue(o)) added++;
    }
    this.setStatus(`Recommended ${added} order(s).`);
  }

  private doEndTurn(): void {
    if (this.debriefOpen) return;
    if (this.controller.state.winnerId) {
      const d = this.controller.getDebrief();
      if (d) this.showDebrief(d);
      else this.setStatus('Game over — New Game to play again.');
      return;
    }
    const { message, combats, results, debrief } = this.controller.endTurn();
    this.setStatus(message);
    SFX.play(combats > 0 ? 'combat' : 'endTurn');
    if (this.tutorialStep === 4) this.advanceTutorial();
    if (combats > 0) {
      this.cameras.main.flash(200, 255, 43, 214);
      this.playClashReel(results, () => {
        if (debrief) {
          SFX.play(debrief.winnerId === this.controller.humanId ? 'win' : 'lose');
          this.showDebrief(debrief);
        }
      });
    } else if (debrief) {
      SFX.play(debrief.winnerId === this.controller.humanId ? 'win' : 'lose');
      this.showDebrief(debrief);
    }
    // City event sting
    if (this.controller.state.log.some((l) => l.kind === 'event' && l.turn >= this.controller.state.turn - 1)) {
      SFX.play('event');
    }
    this.selectedGangId = null;
  }

  private playClashReel(results: CombatResult[], onDone?: () => void): void {
    const { width, height } = this.scale;
    const overlay = this.add
      .rectangle(width / 2, height / 2, width, height, 0x000000, 0.55)
      .setDepth(40);
    const img = this.add
      .image(width / 2, height / 2 - 40, 'clash')
      .setDisplaySize(320, 320)
      .setDepth(41);
    const first = results[0]!;
    const title = this.add
      .text(width / 2, height / 2 + 140, first.summary, {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '16px',
        color: first.attackerWon ? '#7dff6b' : '#ff6b4a',
        align: 'center',
        wordWrap: { width: width - 80 },
      })
      .setOrigin(0.5)
      .setDepth(41);
    const sub = this.add
      .text(
        width / 2,
        height / 2 + 180,
        `Power ${first.attackerPower.toFixed(1)} vs ${first.defenderPower.toFixed(1)} · ~${Math.round(first.attackerWinChance * 100)}%`,
        { fontFamily: 'Consolas, monospace', fontSize: '13px', color: '#c8f7ff' },
      )
      .setOrigin(0.5)
      .setDepth(41);

    this.tweens.add({
      targets: [img],
      scale: 1.08,
      duration: 400,
      yoyo: true,
    });

    this.time.delayedCall(1600, () => {
      overlay.destroy();
      img.destroy();
      title.destroy();
      sub.destroy();
      onDone?.();
    });
  }

  private showDebrief(report: DebriefReport): void {
    if (this.debriefOpen) return;
    this.debriefOpen = true;
    const { width, height } = this.scale;
    const won = report.winnerId === this.controller.humanId;

    const root = this.add.container(0, 0).setDepth(50);
    const bg = this.add
      .rectangle(width / 2, height / 2, Math.min(720, width - 40), Math.min(520, height - 40), 0x0a0818, 0.96)
      .setStrokeStyle(2, won ? 0x7dff6b : 0xff2bd6);
    root.add(bg);

    const title = this.add
      .text(width / 2, height / 2 - 220, won ? 'CITY TAKEN' : 'CITY LOST', {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '28px',
        color: won ? '#7dff6b' : '#ff2bd6',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    root.add(title);

    const body = [
      report.summary,
      '',
      'Why it went this way:',
      ...report.reasons.map((r) => `• ${r}`),
      '',
      'Final standings:',
      ...report.finalScores.map(
        (s) =>
          `  ${s.name}: ${s.sectors} sectors · $${s.cash} · ${s.gangs} gangs · sup ${s.support}`,
      ),
      '',
      'Timeline:',
      ...report.timeline.slice(-6).map((t) => `  ${t}`),
    ].join('\n');

    const text = this.add
      .text(width / 2, height / 2 + 10, body, {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '13px',
        color: '#e8e6ff',
        align: 'left',
        wordWrap: { width: Math.min(640, width - 80) },
        lineSpacing: 3,
      })
      .setOrigin(0.5);
    root.add(text);

    const btnY = height / 2 + Math.min(220, height / 2 - 40);
    const closeBg = this.add
      .rectangle(width / 2 - 90, btnY, 160, 36, 0x120f24)
      .setStrokeStyle(2, 0x2bf0ff)
      .setInteractive({ useHandCursor: true });
    const closeTxt = this.add
      .text(width / 2 - 90, btnY, 'Close', {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '14px',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    const againBg = this.add
      .rectangle(width / 2 + 90, btnY, 160, 36, 0x120f24)
      .setStrokeStyle(2, 0xff2bd6)
      .setInteractive({ useHandCursor: true });
    const againTxt = this.add
      .text(width / 2 + 90, btnY, 'New Game', {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '14px',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    root.add([closeBg, closeTxt, againBg, againTxt]);

    const dismiss = () => {
      root.destroy(true);
      this.debriefOpen = false;
    };
    closeBg.on('pointerdown', dismiss);
    againBg.on('pointerdown', () => {
      dismiss();
      this.controller.newGame();
      this.selectedSector = null;
      this.selectedGangId = null;
      this.setStatus('New game.');
    });
  }

  private cycleNextGang(): void {
    const state = this.controller.state;
    const mine = Object.values(state.gangs).filter(
      (g) => g.ownerId === this.controller.humanId && g.hp > 0,
    );
    if (mine.length === 0) return;
    const idx = mine.findIndex((g) => g.id === this.selectedGangId);
    const next = mine[(idx + 1) % mine.length]!;
    this.selectedGangId = next.id;
    this.selectedSector = next.sectorId;
    this.paintMap(state);
    this.paintPanel(state);
    this.paintPortrait(state);
    this.setStatus(`Selected ${gangDefById(next.defId).name}`);
  }

  private setStatus(msg: string): void {
    this.statusText.setText(msg);
  }
}
