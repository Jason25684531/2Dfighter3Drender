import Phaser from 'phaser'
import type { MatchSnapshot } from '../match/MatchController'

export class PrototypeHud extends Phaser.GameObjects.Container {
  private readonly bars: Phaser.GameObjects.Rectangle[] = []
  private readonly lag: Phaser.GameObjects.Rectangle[] = []
  private readonly percentages: Phaser.GameObjects.Text[] = []
  private readonly wins: Phaser.GameObjects.Text[] = []
  private readonly hp = [100, 100]
  private readonly timer: Phaser.GameObjects.Text
  private readonly status: Phaser.GameObjects.Text
  constructor(scene: Phaser.Scene, names: string[], private readonly reduced: boolean) {
    super(scene, 0, 0)
    scene.add.existing(this)
    this.setDepth(100)
    for (let i = 0; i < 2; i++) {
      const x = i ? 1110 : 90, color = i ? 0x8171ff : 0xf43d58
      const frame = scene.add.graphics().fillStyle(0x080d19, 0.96).lineStyle(3, color)
      frame.fillPoints([{ x: x - 18, y: 38 }, { x: x + 710, y: 38 }, { x: x + 728, y: 180 }, { x: x, y: 180 }], true)
      frame.strokeRect(x - 4, 94, 708, 64)
      this.add(frame)
      this.add(scene.add.text(x, 48, `${i ? '2P / CPU' : '1P'}  ${names[i]}`, { fontFamily: 'Chivo', fontSize: '28px', color: '#ffffff' }))
      const origin = i ? 1 : 0, start = i ? x + 700 : x
      this.add(scene.add.rectangle(start, 102, 700, 48, 0x22283b).setOrigin(origin, 0))
      this.lag[i] = scene.add.rectangle(start, 102, 700, 48, 0xf7cf82).setOrigin(origin, 0)
      this.bars[i] = scene.add.rectangle(start, 102, 700, 48, color).setOrigin(origin, 0)
      this.percentages[i] = scene.add.text(i ? x : x + 700, 112, '100%', { fontFamily: 'Chivo', fontSize: '28px', color: '#ffffff', stroke: '#101321', strokeThickness: 4 }).setOrigin(i ? 0 : 1, 0)
      this.wins[i] = scene.add.text(x, 167, '○ ○', { fontSize: '28px', color: '#f7cf82' })
      this.add([this.lag[i], this.bars[i], this.percentages[i], this.wins[i]])
    }
    this.add(scene.add.rectangle(960, 105, 170, 160, 0x080d19, 0.96).setStrokeStyle(3, 0x43beff))
    this.timer = scene.add.text(960, 30, '60', { fontFamily: 'Oswald', fontSize: '80px', color: '#ffffff' }).setOrigin(0.5, 0)
    this.status = scene.add.text(960, 146, 'ROUND 1', { fontFamily: 'Chivo', fontSize: '22px', color: '#9edfff' }).setOrigin(0.5, 0)
    this.add([this.timer, this.status])
  }
  sync(snapshot: MatchSnapshot): void {
    const fighters = [snapshot.world.fighters.PLAYER, snapshot.world.fighters.ENEMY]
    fighters.forEach((fighter, i) => {
      const value = Phaser.Math.Clamp(fighter.currentHP, 0, 100)
      if (value === this.hp[i]) return
      this.scene.tweens.killTweensOf(this.lag[i])
      this.bars[i].setScale(value / 100, 1)
      this.percentages[i].setText(`${value}%`)
      if (this.reduced || value > this.hp[i]) this.lag[i].setScale(value / 100, 1)
      else this.scene.tweens.add({ targets: this.lag[i], scaleX: value / 100, duration: 600 })
      this.hp[i] = value
    })
    const seconds = String(Math.ceil(snapshot.remainingTicks / 24))
    if (this.timer.text !== seconds) this.timer.setText(seconds)
    ;[snapshot.playerRoundWins, snapshot.enemyRoundWins].forEach((n, i) => {
      const text = [0, 1].map(k => k < n ? '●' : '○').join(' ')
      if (this.wins[i].text !== text) this.wins[i].setText(text)
    })
    this.status.setText(snapshot.matchState === 'MATCH_END' ? 'MATCH END' : `ROUND ${snapshot.roundNumber}`)
  }
}
