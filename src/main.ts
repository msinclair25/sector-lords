import Phaser from 'phaser';
import { BootScene } from './app/scenes/BootScene';
import { MenuScene } from './app/scenes/MenuScene';
import { GameScene } from './app/scenes/GameScene';

/**
 * Hybrid Game3D is registered from MenuScene (static import).
 * Avoid dynamic import of Game3DScene — it created a circular chunk graph
 * that failed on mobile Safari ("Failed to import module").
 */
const parent = document.getElementById('app') ?? undefined;

// Cache-bust: touch a runtime string so Vite emits a new asset hash after CDN mishaps.
const BUILD_ID = '2026-07-16-mobile-pass-v31';
if (typeof window !== 'undefined') {
  (window as unknown as { __SECTOR_LORDS_BUILD__?: string }).__SECTOR_LORDS_BUILD__ =
    BUILD_ID;
}

function viewSize(): { w: number; h: number } {
  const vv = window.visualViewport;
  const w = Math.max(320, Math.floor(vv?.width ?? window.innerWidth));
  // Prefer visualViewport height on iOS (excludes URL bar collapse jank better with resize handler)
  const h = Math.max(320, Math.floor(vv?.height ?? window.innerHeight));
  return { w, h };
}

const { w: startW, h: startH } = viewSize();

const game = new Phaser.Game({
  type: Phaser.CANVAS, // lighter on iOS than WebGL when canvas is mostly hidden (hybrid HUD)
  parent,
  width: startW,
  height: startH,
  backgroundColor: '#07060f',
  scene: [BootScene, MenuScene, GameScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    antialias: false,
    pixelArt: false,
    powerPreference: 'low-power',
  },
  // Don't thrash audio — we own WebAudio / HTMLAudio in SoundBank
  audio: {
    noAudio: true,
  },
  banner: false,
});

const onViewport = (): void => {
  const { w, h } = viewSize();
  try {
    game.scale.resize(w, h);
  } catch {
    /* ignore */
  }
};
window.addEventListener('resize', onViewport, { passive: true });
window.visualViewport?.addEventListener('resize', onViewport);
window.visualViewport?.addEventListener('scroll', onViewport);
