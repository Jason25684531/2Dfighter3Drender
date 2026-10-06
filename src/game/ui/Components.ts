import Phaser from 'phaser'

export class Button extends Phaser.GameObjects.Container {
  private readonly background: Phaser.GameObjects.Rectangle
  private readonly text: Phaser.GameObjects.Text
  enabled = true
  constructor(scene: Phaser.Scene, id: string, label: string, onActivate: () => void) {
    super(scene, 0, 0)
    this.name = id
    this.background = scene.add.rectangle(0, 0, 300, 60, 0xe60012)
    this.text = scene.add.text(0, 0, label, { fontFamily: 'Arial', fontSize: '26px', color: '#ffffff' }).setOrigin(0.5)
    this.add([this.background, this.text]).setSize(300, 60).setInteractive({ useHandCursor: true })
    this.on('pointerup', () => { if (this.enabled) onActivate() })
  }
  setEnabled(enabled: boolean): this { this.enabled = enabled; this.background.setAlpha(enabled ? 1 : 0.35); return this }
  setFocused(focused: boolean): this { this.background.setStrokeStyle(focused ? 4 : 0, 0xffffff); return this }
}

export class Modal extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, label: string) { super(scene, 960, 540); this.add(scene.add.text(0, 0, label, { fontFamily: 'Arial', fontSize: '32px', color: '#fff', backgroundColor: '#e60012', padding: { x: 24, y: 18 } }).setOrigin(0.5)); this.setVisible(false) }
  open(): this { return this.setVisible(true) }
  close(): this { return this.setVisible(false) }
}

export class Progress extends Phaser.GameObjects.Rectangle {
  private value = 0
  constructor(scene: Phaser.Scene, width = 300) { super(scene, 0, 0, width, 18, 0xe60012) }
  setProgress(value: number, min = 0, max = 1): this { this.value = Math.max(0, Math.min(1, (value - min) / (max - min || 1))); this.setScale(this.value, 1); return this }
  getProgress(): number { return this.value }
}

export class RankingRow extends Phaser.GameObjects.Text {
  constructor(scene: Phaser.Scene, rank: number, player: string, score: number, highlighted = false) { super(scene, 0, 0, `${rank}. ${player} — ${score}`, { fontFamily: 'Arial', fontSize: '22px', color: highlighted ? '#e60012' : '#ffffff' }) }
}
