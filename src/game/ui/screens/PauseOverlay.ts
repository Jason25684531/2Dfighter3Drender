import type Phaser from 'phaser'
import { ActionButton, AngularPanel } from '../VisualComponents'
import { uiTokens } from '../tokens/uiTokens'
import { typography } from '../tokens/typography'
import { ScreenView, type ScreenContext } from './ScreenView'

type OverlayAction = 'CONTINUE' | 'RESTART' | 'EXIT' | 'CONFIRM' | 'CANCEL'
const EXIT_LOCK_MS = 400

/** P4 暫停選單與重開／離開確認。確認框開啟後 0.4 秒內忽略輸入，避免連按穿透。 */
export class PauseOverlay extends ScreenView {
  private lockedUntil = 0

  constructor(ctx: ScreenContext, parent: Phaser.GameObjects.Container, hint: string, private readonly onRestart: () => void) {
    super(ctx, ctx.scene.add.container(0, 0))
    parent.add(this.root)
    const { scene, root } = this, { colors } = uiTokens, navigation = ctx.ui.navigation
    root.add(scene.add.rectangle(960, 540, 1920, 1080, colors.background0, uiTokens.opacity.overlay))
    const confirmAction = navigation.getConfirmationAction(), confirmMode = Boolean(confirmAction)
    if (confirmMode) this.lockedUntil = performance.now() + EXIT_LOCK_MS
    const panel = new AngularPanel(scene, 650, 400, colors.panelRaised).setPosition(960, 540)
    panel.add(scene.add.text(0, -140, confirmAction === 'RESTART' ? 'RESTART MATCH?' : confirmMode ? 'EXIT GAME?' : 'PAUSED', typography.title).setOrigin(0.5))
    if (confirmAction === 'RESTART') panel.add(scene.add.text(0, -74, '本局將從 Round 1 重開，保留角色素材與舞台；本局成績不列入排行榜', typography.note).setOrigin(0.5))
    else if (confirmAction === 'EXIT') panel.add(scene.add.text(0, -74, '將結束這場遊戲並回到首頁，本局成績不列入排行榜', typography.note).setOrigin(0.5))
    panel.add(scene.add.rectangle(0, -92, 560, 1, colors.lineDim, 0.9))
    panel.add(scene.add.text(0, 160, hint, typography.note).setOrigin(0.5))
    const group = confirmMode ? 'overlay-confirm' : 'overlay'
    const actions: OverlayAction[] = confirmMode ? ['CONFIRM', 'CANCEL'] : ['CONTINUE', 'RESTART', 'EXIT']
    actions.forEach((action, index) => {
      const button = new ActionButton(scene, action, 380, 66, action === 'CONTINUE' || action === 'CONFIRM' ? colors.playerPrimary : colors.panel).setPosition(0, -20 + index * 88)
      button.on('pointerup', () => this.act(action))
      panel.add(button)
      this.focusable(group, 'overlay-' + action, button, () => this.act(action))
    })
    root.add(panel)
    ctx.ui.focus.activate(group, confirmMode ? 'overlay-CANCEL' : 'overlay-CONTINUE')
  }

  get inputLocked(): boolean { return this.ctx.ui.navigation.isExitConfirmationOpen() && performance.now() < this.lockedUntil }

  private act(action: OverlayAction): void {
    if (this.inputLocked) return
    const navigation = this.ctx.ui.navigation
    if (action === 'CONTINUE') navigation.dispatch('CLOSE_MENU')
    else if (action === 'CANCEL') navigation.dispatch('BACK')
    else if (action === 'RESTART' || action === 'EXIT') navigation.openExitConfirmation(action)
    else {
      // 先關選單讓時鐘恢復，再離開戰鬥；反過來時鐘會停在暫停狀態到下一場。
      const confirmation = navigation.getConfirmationAction()
      navigation.dispatch('CLOSE_MENU')
      if (confirmation === 'RESTART') this.onRestart()
      else navigation.dispatch('FINISH')
    }
  }
}
