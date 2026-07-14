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
const BUILD_ID = '2026-07-13-fire-police-v2';
if (typeof window !== 'undefined') {
  (window as unknown as { __SECTOR_LORDS_BUILD__?: string }).__SECTOR_LORDS_BUILD__ =
    BUILD_ID;
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent,
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#07060f',
  scene: [BootScene, MenuScene, GameScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    antialias: true,
    pixelArt: false,
  },
});
