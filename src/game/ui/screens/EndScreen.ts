import type Phaser from 'phaser'
import { ActionButton, AngularPanel } from '../VisualComponents'
import { colorHex, uiTokens } from '../tokens/uiTokens'
import { typography } from '../tokens/typography'
import type { EndViewModel } from '../ViewModels'
import { ScreenView, type ScreenContext } from './ScreenView'

/** P7：再戰一場或結束；有下一位排隊玩家時顯示 NEXT。 */
export class EndScreen extends ScreenView {
  constructor(ctx: ScreenContext, root: Phaser.GameObjects.Container, vm: EndViewModel) {
    super(ctx, root)
    const { scene } = this, { colors, type } = uiTokens, navigation = ctx.ui.navigation
    const panel = new AngularPanel(scene, 900, 500, colors.panelRaised).setPosition(960, 500)
    panel.add(scene.add.text(0, -170, 'PLAY AGAIN?', typography.title).setOrigin(0.5))
    panel.add(scene.add.text(0, -112, '再戰一場（重新選擇角色與場景）', typography.instruction).setOrigin(0.5))
    const replay = new ActionButton(scene, 'PLAY AGAIN', 470, 96).setPosition(0, -6)
    const finish = new ActionButton(scene, 'FINISH', 470, 86, colors.background1).setPosition(0, 132)
    replay.on('pointerup', () => navigation.dispatch('REPLAY'))
    finish.on('pointerup', () => navigation.dispatch('FINISH'))
    panel.add([replay, finish]); root.add(panel)
    this.focusable('end', 'play-again', replay, () => navigation.dispatch('REPLAY'))
    this.focusable('end', 'finish', finish, () => navigation.dispatch('FINISH'))
    ctx.ui.focus.activate('end', 'play-again')
    if (vm.nextPlayerName) {
      const next = new AngularPanel(scene, 430, 190, colors.panelRaised).setPosition(960, 885)
      next.add(scene.add.text(-180, -63, 'NEXT', { ...typography.secondaryAction, fontSize: type.body, color: colorHex('systemBlue') }).setOrigin(0, 0.5))
      next.add(scene.add.text(-60, 34, vm.nextPlayerName, { ...typography.secondaryAction, fontSize: type.body }).setOrigin(0, 0.5))
      root.add(next)
    }
  }
}
