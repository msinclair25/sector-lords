import Phaser from 'phaser';
import { GANG_DEFS } from '../../content';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.load.image('sector_tile', 'assets/tiles/sector_base.jpg');
    this.load.image('mood_bg', 'assets/ui/mood_bg.jpg');
    this.load.image('clash', 'assets/combat/clash_impact.jpg');

    for (const g of GANG_DEFS) {
      const path = g.art.portrait ?? 'assets/portraits/neon_jackals.jpg';
      this.load.image(`portrait_${g.id}`, path);
    }

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
  }

  create(): void {
    this.scene.start('Menu');
  }
}
