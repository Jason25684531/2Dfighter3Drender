import type Phaser from 'phaser'
import { AppState } from '../../state/AppState'
import { ActionButton, AngularPanel } from '../VisualComponents'
import { colorHex, uiTokens } from '../tokens/uiTokens'
import { typography } from '../tokens/typography'
import type { ResultViewModel } from '../ViewModels'
import { ScreenView, type ScreenContext } from './ScreenView'

/** P6：統計／結果／排行三欄；沒有結果（例如重整後）時只留背景。 */
export class ResultScreen extends ScreenView {
  constructor(ctx: ScreenContext, root: Phaser.GameObjects.Container, vm: ResultViewModel | undefined, private readonly readyAt: number) {
    super(ctx, root)
    if (vm) this.renderColumns(vm)
  }

  private renderColumns(vm: ResultViewModel): void {
    const { scene, root } = this, { colors, type } = uiTokens
    root.add(this.heading('MATCH RESULT'))
    const columns = [{ x: 353, w: 514, title: 'STATISTICS' }, { x: 960, w: 644, title: 'RESULT' }, { x: 1567, w: 514, title: 'RANKING' }]
    const [statistics, result, ranking] = columns.map(({ x, w, title }) => {
      const height = title === 'STATISTICS' ? Math.min(640, 150 + vm.statistics.length * 88) : 640
      const panel = new AngularPanel(scene, w, height, colors.panelRaised).setPosition(x, 230 + height / 2)
      panel.add(scene.add.text(-w / 2 + 32, -height / 2 + 45, title, typography.secondaryAction).setOrigin(0, 0.5))
      panel.add(scene.add.rectangle(0, -height / 2 + 100, w - 52, 1, colors.lineDim, 0.9))
      root.add(panel)
      return panel
    })
    const statStep = Math.min(88, 480 / Math.max(1, vm.statistics.length))
    vm.statistics.forEach((stat, index) => {
      const y = -statistics.height / 2 + 145 + index * statStep
      statistics.add(scene.add.text(-215, y, stat.label, { ...typography.note, fontSize: type.label, color: colorHex('textSecondary') }).setOrigin(0, 0.5))
      statistics.add(scene.add.text(215, y, String(stat.value), { ...typography.number, fontSize: type.body }).setOrigin(1, 0.5))
      statistics.add(scene.add.rectangle(0, y + statStep / 2, 450, 1, colors.lineDim, 0.65))
    })
    const win = vm.outcome === 'WIN'
    const headlineColor = win ? colorHex('playerGlow') : vm.outcome === 'DRAW' ? colorHex('systemBlue') : colorHex('textSecondary')
    const headline = scene.add.text(0, -170, vm.headline, { ...typography.announcer, fontSize: type.h1, color: headlineColor, stroke: colorHex('background0'), strokeThickness: uiTokens.textStroke.result, shadow: win ? { color: colorHex('playerPrimary'), blur: uiTokens.shadowBlur.focal, fill: true } : undefined }).setOrigin(0.5).setScale(0.88).setAlpha(0)
    result.add(headline)
    this.tween({ targets: headline, scale: 1, alpha: 1, duration: uiTokens.motionMs.focalReveal, ease: 'Cubic.Out' })
    if (vm.title) result.add(new AngularPanel(scene, 530, 62, colors.resultGold, 1).setPosition(0, -38))
    const title = scene.add.text(0, -38, vm.title, { ...typography.secondaryAction, fontSize: type.title, color: colorHex('background0') }).setOrigin(0.5).setAlpha(0)
    const scoreLabel = scene.add.text(0, 40, 'SCORE', { ...typography.note, fontSize: type.label, color: colorHex('textSecondary') }).setOrigin(0.5).setAlpha(0)
    const score = scene.add.text(0, 120, String(vm.score), { ...typography.number, fontSize: type.display }).setOrigin(0.5).setAlpha(0)
    const rank = scene.add.text(0, 207, 'RANK  ' + (vm.rank ?? 'NOT RANKED'), { ...typography.note, fontSize: type.body, color: colorHex('textSecondary') }).setOrigin(0.5).setAlpha(0)
    result.add([title, scoreLabel, score, rank])
    this.tween({ targets: [title, scoreLabel, score, rank], alpha: 1, duration: 160, delay: 100, ease: 'Cubic.Out' })
    if (vm.newRecord) {
      const badge = scene.add.text(0, 278, 'NEW RECORD', { ...typography.secondaryAction, fontSize: type.title, color: colorHex('resultGold'), stroke: colorHex('background0'), strokeThickness: uiTokens.textStroke.badge, shadow: { color: colorHex('playerPrimary'), blur: uiTokens.shadowBlur.subtle, fill: true } }).setOrigin(0.5).setAlpha(0)
      result.add(badge)
      this.tween({ targets: badge, alpha: 1, duration: 160, delay: 240, ease: 'Cubic.Out' })
    }
    const rowSpacing = Math.min(46, 460 / Math.max(1, Math.min(20, vm.ranking.length)))
    vm.ranking.slice(0, 20).forEach((row, index) => {
      const y = -180 + index * rowSpacing
      if (row.highlighted) ranking.add(scene.add.rectangle(0, y, 460, rowSpacing - 4, colors.playerPrimary, 0.24))
      ranking.add(scene.add.rectangle(0, y + rowSpacing / 2, 462, 1, colors.lineDim, 0.66))
      if (row.highlighted) ranking.add(scene.add.rectangle(-227, y, 4, rowSpacing - 4, colors.playerGlow, 0.95))
      ranking.add(scene.add.text(-210, y, String(row.rank).padStart(2, '0') + '  ' + row.name, { ...typography.note, fontSize: type.label, color: colorHex('textPrimary') }).setOrigin(0, 0.5))
      ranking.add(scene.add.text(210, y, String(row.score), { ...typography.number, fontSize: type.label, color: row.highlighted ? colorHex('textPrimary') : colorHex('textSecondary') }).setOrigin(1, 0.5))
    })
    const next = new ActionButton(scene, 'CONTINUE', 380, 88, colors.playerPrimary, '繼續').setPosition(960, 952)
    const proceed = (): void => this.ctx.go(AppState.END)
    root.add(next)
    this.holdConfirm('result', 'result-next', next, proceed, this.readyAt)
  }
}
