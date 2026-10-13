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

export class Progress extends Phaser.GameObjects.Rectangle {
  constructor(scene: Phaser.Scene, width = 300) { super(scene, 0, 0, width, 18, 0xe60012) }
  setProgress(value: number, min = 0, max = 1): this { this.setScale(Math.max(0, Math.min(1, (value - min) / (max - min || 1))), 1); return this }
}
