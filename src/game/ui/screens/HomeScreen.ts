import type Phaser from 'phaser'
import { AppState } from '../../state/AppState'
import { ActionButton, hintBar } from '../VisualComponents'
import { uiTokens } from '../tokens/uiTokens'
import { ScreenView, type ScreenContext } from './ScreenView'

/** P0：場景背景、START、排行榜按鈕與操作提示；排行在遊玩後的 P6／P7 呈現。 */
export class HomeScreen extends ScreenView {
  constructor(ctx: ScreenContext, root: Phaser.GameObjects.Container, hint: string, onBoard: () => void) {
    super(ctx, root)
    const { colors, type } = uiTokens
    const start = new ActionButton(this.scene, 'START', 420, 100, colors.playerPrimary, '開始遊戲').setPosition(740, 860)
    const board = new ActionButton(this.scene, 'BOARD', 420, 100, colors.panelRaised, '排行榜').setPosition(1180, 860)
    const begin = (): void => ctx.go(AppState.READY)
    start.on('pointerup', () => { ctx.audio?.ui('CONFIRM'); begin() })
    board.on('pointerup', () => { ctx.audio?.ui('CONFIRM'); onBoard() })
    root.add([start, board])
    this.focusable('p0', 'p0-start', start, begin)
    this.focusable('p0', 'p0-board', board, onBoard)
    ctx.ui.focus.activate('p0', 'p0-start')
    root.add([hintBar(this.scene, 960), this.label(hint, 960, 960, type.label)])
  }
}
