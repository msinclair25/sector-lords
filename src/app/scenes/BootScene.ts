import Phaser from 'phaser';

/**
 * Minimal boot — hybrid Game3D uses DOM assets, not Phaser textures.
 * Loading every portrait into Phaser crashed iOS Safari (GPU/RAM).
 * Classic GameScene can load its own assets if re-enabled.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    // Intentionally empty: no bulk texture load.
  }

  create(): void {
    const { width, height } = this.scale;
    const g = this.add.graphics();
    g.fillStyle(0x05030c, 1);
    g.fillRect(0, 0, width, height);
    this.add
      .text(width / 2, height / 2, 'SECTOR LORDS\n// LOADING', {
        fontFamily: 'Orbitron, Segoe UI, sans-serif',
        fontSize: '22px',
        color: '#fcee0a',
        align: 'center',
        letterSpacing: 4,
      })
      .setOrigin(0.5)
      .setShadow(0, 0, '#ff2bd6', 12);

    // Next frame → Menu so the loading text paints once
    this.time.delayedCall(40, () => {
      this.scene.start('Menu');
    });
  }
}
