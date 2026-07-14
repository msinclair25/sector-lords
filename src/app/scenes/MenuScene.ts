import Phaser from 'phaser';
import { SCENARIOS, scenarioById } from '../../content';
import { describeVictoryGoal } from '../../engine';
import type { Difficulty } from '../../engine';
import { GameController } from '../GameController';
import {
  loadBoardViewMode,
  saveBoardViewMode,
  type BoardViewMode,
} from '../../app-tabletop/BoardTabletop';
import { SFX } from '../audio/SoundBank';
import menuCss from '../ui/menuLanding.css?inline';
// Static import — dynamic import('./Game3DScene') created a circular chunk
// (Game3D → index → Game3D) that fails on mobile Safari with
// "Failed to import module Game3DScene".
import { Game3DScene } from './Game3DScene';

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard', 'overlord'];

/**
 * Cinematic HTML landing menu — same chrome language as hybrid HUD.
 */
export class MenuScene extends Phaser.Scene {
  private scenarioIndex = 0;
  private diffIndex = 1;
  private root: HTMLDivElement | null = null;
  private styleEl: HTMLStyleElement | null = null;

  constructor() {
    super('Menu');
  }

  create(): void {
    this.game.canvas.style.display = 'none';

    this.styleEl = document.createElement('style');
    this.styleEl.textContent = menuCss;
    document.head.appendChild(this.styleEl);

    const parent = document.getElementById('app') ?? document.body;
    this.root = document.createElement('div');
    this.root.id = 'sl-menu-root';
    parent.appendChild(this.root);

    this.render();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown());
  }

  private render(): void {
    if (!this.root) return;
    const hasSave = GameController.hasSave();
    const meta = GameController.peekSave();
    const scen = SCENARIOS[this.scenarioIndex]!;
    const diff = DIFFS[this.diffIndex]!;

    let saveBlock = '';
    if (hasSave && meta) {
      let scenName = meta.scenarioId;
      try {
        scenName = scenarioById(meta.scenarioId).name;
      } catch {
        /* keep id */
      }
      const when = new Date(meta.savedAt).toLocaleString();
      const ended = meta.winnerId ? ' · FINISHED' : '';
      saveBlock = `
        <div class="sl-save-strip">
          <div class="lbl">SAVED WAR TABLE${ended}</div>
          <div class="meta">Turn ${meta.turn} · ${escapeHtml(scenName)} · $${meta.cash} · support ${meta.support}<br/>${escapeHtml(when)} · this browser</div>
        </div>
        <button type="button" class="sl-btn continue" data-act="continue">▶  Continue</button>
      `;
    }

    this.root.innerHTML = `
      <div class="sl-menu-bg"></div>
      <div class="sl-menu-vignette"></div>
      <div class="sl-menu-scan"></div>
      <div class="sl-menu-frame"></div>
      <div class="sl-menu-corners"><span></span><span></span></div>
      <div class="sl-menu-layout">
        <header class="sl-menu-hero">
          <h1 class="sl-title-art">
            <img
              src="/assets/ui/title_logo.png"
              alt="Sector Lords"
              width="960"
              height="540"
              decoding="async"
              fetchpriority="high"
            />
          </h1>
          <p class="tagline">Claim the grid · Burn the rivals</p>
          <p class="sub">Cyberpunk crime war · painted city tabletop</p>
        </header>

        <div class="sl-menu-panel">
          ${saveBlock}

          <div class="sl-scenario">
            <div class="sc-lbl">// SCENARIO</div>
            <div class="sc-name">${escapeHtml(scen.name)}</div>
            <p class="sc-desc">${escapeHtml(scen.description)}</p>
            <p class="sc-goal"><span class="sc-goal-tag">GOAL</span> ${escapeHtml(describeVictoryGoal(scen.victory))}</p>
            <div class="sc-stats">
              <span class="sl-chip">${scen.aiCount} AI</span>
              <span class="sl-chip gold">START $${scen.startingCash}</span>
              <span class="sl-chip">${scen.mapWidth}×${scen.mapHeight}</span>
              <span class="sl-chip">${
                scen.victory.type === 'elimination'
                  ? 'NO CLOCK'
                  : `${'turns' in scen.victory ? scen.victory.turns : '?'} TURNS`
              }</span>
            </div>
          </div>

          <div class="sl-status-row">
            <span class="sl-status-pill diff">DIFF // ${diff.toUpperCase()}</span>
            <span class="sl-status-pill ${SFX.isEnabled() ? 'on' : ''}">SFX // ${SFX.isEnabled() ? 'ON' : 'OFF'}</span>
            <span class="sl-status-pill music ${SFX.isMusicEnabled() ? 'on' : ''}">MUSIC // ${SFX.isMusicEnabled() ? 'ON' : 'OFF'}</span>
            <span class="sl-status-pill ${loadBoardViewMode() === 'flat' ? 'on' : ''}">BOARD // ${loadBoardViewMode() === 'flat' ? 'FLAT' : 'TABLE'}</span>
          </div>

          <div class="sl-row">
            <button type="button" class="sl-btn cyan" data-act="scen-prev">◀ Scenario</button>
            <button type="button" class="sl-btn cyan" data-act="scen-next">Scenario ▶</button>
          </div>
          <div class="sl-row">
            <button type="button" class="sl-btn gold" data-act="diff-prev">◀ Diff</button>
            <button type="button" class="sl-btn gold" data-act="diff-next">Diff ▶</button>
          </div>
          <div class="sl-row">
            <button type="button" class="sl-btn ghost" data-act="sfx">Toggle SFX</button>
            <button type="button" class="sl-btn ghost" data-act="music">Toggle Music</button>
          </div>
          <div class="sl-row">
            <button type="button" class="sl-btn ghost" data-act="board-view" style="width:100%">
              Board: ${loadBoardViewMode() === 'flat' ? 'Flat (clear)' : 'War table (tilt)'} — toggle
            </button>
          </div>

          <button type="button" class="sl-btn primary" data-act="play">
            ${hasSave ? '▶  New Game' : '▶  Jack In'}
          </button>
        </div>

        <footer class="sl-menu-credit">
          <div class="sl-credit-row">
            <span class="sl-credit-lbl">// DESIGNED BY</span>
            <span class="sl-credit-name">Morgan Sinclair</span>
            <a
              class="sl-credit-x"
              href="https://x.com/morganinc"
              target="_blank"
              rel="noopener noreferrer"
              title="Morgan Sinclair on X"
            >@morganinc</a>
          </div>
          <div class="sl-credit-row co">
            <span class="sl-credit-lbl">// WITH</span>
            <span class="sl-credit-name grok">Grok</span>
            <span class="sl-credit-sep">·</span>
            <a
              class="sl-credit-x xai"
              href="https://x.ai"
              target="_blank"
              rel="noopener noreferrer"
              title="xAI"
            >xAI</a>
            <span class="sl-credit-sep">·</span>
            <span class="sl-credit-lbl music">MUSIC BY</span>
            <span class="sl-credit-name gemini">Gemini</span>
          </div>
          <a
            class="sl-coffee"
            href="https://buymeacoffee.com/morganinc"
            target="_blank"
            rel="noopener noreferrer"
            title="Buy Morgan a coffee"
          >
            <span class="sl-coffee-lbl">// SUPPORT</span>
            <span class="sl-coffee-msg">If you enjoy this, buy me a coffee</span>
            <span class="sl-coffee-cta">☕ buymeacoffee.com/morganinc</span>
          </a>
        </footer>
        <p class="sl-menu-foot">Autosave · green glow moves · scroll zoom</p>
      </div>
    `;

    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('button[data-act]')) {
      btn.addEventListener('click', () => this.onAct(btn.dataset.act!));
    }
  }

  private onAct(act: string): void {
    void SFX.unlock();

    if (act === 'scen-prev') {
      this.scenarioIndex = (this.scenarioIndex - 1 + SCENARIOS.length) % SCENARIOS.length;
      SFX.play('ui');
      this.render();
      return;
    }
    if (act === 'scen-next') {
      this.scenarioIndex = (this.scenarioIndex + 1) % SCENARIOS.length;
      SFX.play('ui');
      this.render();
      return;
    }
    if (act === 'diff-prev') {
      this.diffIndex = (this.diffIndex - 1 + DIFFS.length) % DIFFS.length;
      SFX.play('ui');
      this.render();
      return;
    }
    if (act === 'diff-next') {
      this.diffIndex = (this.diffIndex + 1) % DIFFS.length;
      SFX.play('ui');
      this.render();
      return;
    }
    if (act === 'sfx') {
      void SFX.unlock().then(() => {
        SFX.setEnabled(!SFX.isEnabled());
        SFX.play('ui');
        this.render();
      });
      return;
    }
    if (act === 'music') {
      void SFX.unlock().then(() => {
        const next = !SFX.isMusicEnabled();
        SFX.setMusicEnabled(next);
        if (next) SFX.startMusic();
        SFX.play('ui');
        this.render();
      });
      return;
    }
    if (act === 'board-view') {
      const cur = loadBoardViewMode();
      const next: BoardViewMode = cur === 'table' ? 'flat' : 'table';
      saveBoardViewMode(next);
      SFX.play('ui');
      this.render();
      return;
    }
    if (act === 'continue') {
      void this.launchHybrid(true);
      return;
    }
    if (act === 'play') {
      void this.launchHybrid(false);
    }
  }

  private async launchHybrid(continueSave: boolean): Promise<void> {
    await SFX.unlock();
    if (!SFX.isMusicEnabled()) SFX.setMusicEnabled(true);
    SFX.startMusic();
    SFX.play('endTurn');

    if (this.root) {
      const load = document.createElement('div');
      load.className = 'sl-loading';
      load.textContent = 'SPINNING UP WAR TABLE…';
      this.root.appendChild(load);
    }

    try {
      if (!this.scene.get('Game3D')) {
        this.scene.add('Game3D', Game3DScene, false);
      }
      SFX.startMusic();
      this.teardown();
      this.scene.start('Game3D', {
        scenarioId: SCENARIOS[this.scenarioIndex]!.id,
        difficulty: DIFFS[this.diffIndex] as Difficulty,
        continueSave,
      });
    } catch (e) {
      console.error('[Sector Lords] failed to start Game3D', e);
      if (this.root) {
        const load = this.root.querySelector('.sl-loading');
        if (load) {
          load.classList.add('error');
          load.innerHTML = `FAILED TO START<br/><small>${
            e instanceof Error ? escapeHtml(e.message) : escapeHtml(String(e))
          }</small>`;
        }
      }
      SFX.play('error');
    }
  }

  private teardown(): void {
    this.root?.remove();
    this.root = null;
    this.styleEl?.remove();
    this.styleEl = null;
    this.game.canvas.style.display = '';
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
