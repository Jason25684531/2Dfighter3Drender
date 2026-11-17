import type Phaser from 'phaser'
import { AppState } from '../../state/AppState'
import type { ExperienceFlow } from '../../app/ExperienceFlow'
import { ActionButton, AngularPanel, Announcer } from '../VisualComponents'
import { uiTokens } from '../tokens/uiTokens'
import { typography } from '../tokens/typography'
import { finishAnnouncements } from '../ViewModels'
import { TemporarySpriteRenderer } from '../animation/TemporarySpriteRenderer'
import { outcomeFor } from '../animation/TemporarySpriteManifest'
import { ArenaScreen, type Matchup, type ScreenContext } from './ScreenView'

/** P5 停在最後的戰鬥畫面：贏家播勝利動作（播完停最後一格），KO 的輸家倒地；由遊戲時鐘每 tick 推進。 */
export class PresentationScreen extends ArenaScreen {
  private readonly player: TemporarySpriteRenderer
  private readonly enemy: TemporarySpriteRenderer
  private frame = 0

  constructor(ctx: ScreenContext, root: Phaser.GameObjects.Container, matchup: Matchup, private readonly flow: ExperienceFlow) {
    super(ctx, root, matchup.stageId, uiTokens.backdrop.presentation)
    const { scene, arena } = this, { colors, type } = uiTokens, floorY = flow.match.world.getConfig().floorY
    this.player = new TemporarySpriteRenderer(scene, matchup.playerSprite, floorY)
    this.enemy = new TemporarySpriteRenderer(scene, matchup.enemySprite, floorY)
    this.tick()
    this.stage.world.add([this.player, this.enemy])
    const darken = scene.add.rectangle(960, 540, 1920, 1080, colors.background0, uiTokens.backdrop.impact)
    const rays = scene.add.graphics().setPosition(960, 450)
    for (let i = 0; i < 26; i += 1) { const angle = i * Math.PI * 2 / 26; rays.fillStyle(colors.playerPrimary, 0.1).fillTriangle(0, 0, Math.cos(angle) * 1500, Math.sin(angle) * 1500, Math.cos(angle + 0.04) * 1500, Math.sin(angle + 0.04) * 1500) }
    this.tween({ targets: rays, angle: 360, duration: 12000, repeat: -1 })
    const impact = scene.add.graphics()
    impact.lineStyle(20, colors.danger, 0.46).lineBetween(465, 610, 1455, 315)
    impact.lineStyle(6, colors.resultGold, 0.62).lineBetween(520, 635, 1405, 370)
    impact.lineStyle(3, colors.playerGlow, 0.38).lineBetween(580, 660, 1320, 410)
    // 暗化、光芒與斜線都放在角色後面：只壓暗場景，勝利動作保持全亮。
    arena.addAt([darken, rays, impact], arena.getIndex(this.stage.world))
    const result = flow.result
    if (!result) return
    // 與 P4 同一個 Announcer，縮成一半疊在角色頭頂上方（y < 290），不遮住任何一方。
    const [call, outcome] = finishAnnouncements(result)
    const announce = (announcement: typeof call, y: number): Phaser.GameObjects.Container => scene.add.container(960, y, [new Announcer(scene).show(announcement).setPosition(0, 0)]).setScale(0.5)
    root.add([announce(call, 105), announce(outcome, 240)])
    flow.match.getRoundSummaries().forEach((round, index, rounds) => {
      const panel = new AngularPanel(scene, 210, 100, round.winner === 'PLAYER' ? colors.playerPrimary : round.winner === 'ENEMY' ? colors.enemyPrimary : colors.panelRaised).setPosition(960 + (index - (rounds.length - 1) / 2) * 230, 868)
      panel.add(this.label('ROUND ' + round.roundNumber, 0, -22, type.label))
      panel.add(scene.add.text(0, 18, round.winner === 'PLAYER' ? 'WIN' : round.winner === 'ENEMY' ? 'LOSE' : 'DRAW', typography.action).setOrigin(0.5)); root.add(panel)
    })
    const next = new ActionButton(scene, 'VIEW RESULTS', 420, 96, colors.playerPrimary, '查看結算').setPosition(960, 990)
    const proceed = (): void => ctx.go(AppState.RESULT)
    next.on('pointerup', proceed)
    root.add(next); this.focusable('presentation', 'presentation-next', next, proceed); ctx.ui.focus.activate('presentation')
  }

  tick(): void {
    // 淡入期間停在第一格，畫面完全顯示後才開始播，勝利動作才看得完整。
    const { fighters } = this.flow.match.getSnapshot().world, winner = this.flow.result?.winner, tick = this.root.alpha < 1 ? this.frame : this.frame++
    this.player.update(fighters.PLAYER, tick, { outcome: outcomeFor('PLAYER', 'MATCH_END', winner) })
    this.enemy.update(fighters.ENEMY, tick, { outcome: outcomeFor('ENEMY', 'MATCH_END', winner) })
  }
}
