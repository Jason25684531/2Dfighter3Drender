import Phaser from 'phaser'
import { AppState } from '../../state/AppState'
import { hintBar } from '../VisualComponents'
import { reducedMotion, uiTokens } from '../tokens/uiTokens'
import { ScreenView, type ScreenContext } from './ScreenView'

const HOME = '/test-assets/ui/home'
// 設計稿 P0_UI/完整畫面.png（4K）量出的按鈕中心，換算成 1920×1080；三顆都水平置中。
const BUTTONS = [
  { id: 'start', y: 731 },
  { id: 'leaderboard', y: 818 },
  { id: 'settings', y: 893 },
] as const
type HomeButtonId = (typeof BUTTONS)[number]['id']
// 選中版多了外光暈，圖的上緣比框多留一點；往上挪 4px 讓框與未選中版對齊。
const CHOSEN_OFFSET_Y = -4

export const TITLE_TEXTURE = 'home-title'
export const loadHomeAssets = (scene: Phaser.Scene): void => {
  scene.load.image(TITLE_TEXTURE, `${HOME}/title-screen.jpg`)
  for (const { id } of BUTTONS) { scene.load.image(`home-${id}`, `${HOME}/${id}.png`); scene.load.image(`home-${id}-chosen`, `${HOME}/${id}-chosen.png`) }
}

/** 設計稿的按鈕：未選中是灰框；選中換成發光框與 >> 並輕微呼吸。點擊範圍＝未選中的框。 */
class HomeButton extends Phaser.GameObjects.Container {
  private readonly idle: Phaser.GameObjects.Image
  private readonly chosen: Phaser.GameObjects.Image
  private pulse?: Phaser.Tweens.Tween
  constructor(scene: Phaser.Scene, id: HomeButtonId, y: number) {
    super(scene, 960, y)
    this.idle = scene.add.image(0, 0, `home-${id}`)
    this.chosen = scene.add.image(0, CHOSEN_OFFSET_Y, `home-${id}-chosen`).setVisible(false)
    this.add([this.idle, this.chosen])
    this.setSize(this.idle.width, this.idle.height).setInteractive({ useHandCursor: true })
  }
  setFocused(focused: boolean): this {
    this.idle.setVisible(!focused); this.chosen.setVisible(focused)
    this.pulse?.stop(); this.chosen.setAlpha(1)
    if (focused && !reducedMotion) this.pulse = this.scene.tweens.add({ targets: this.chosen, alpha: 0.78, duration: 700, yoyo: true, repeat: -1 })
    return this
  }
  destroy(fromScene?: boolean): void { this.pulse?.stop(); super.destroy(fromScene) }
}

/** P0：標題畫面（背景已含標題與版權）＋ START／LEADERBOARD／SETTINGS；上下或滑鼠移動選擇，確認或點擊執行。 */
export class HomeScreen extends ScreenView {
  constructor(ctx: ScreenContext, root: Phaser.GameObjects.Container, hint: string, onBoard: () => void, onSettings: () => void) {
    super(ctx, root)
    const actions: Record<HomeButtonId, () => void> = { start: () => ctx.go(AppState.READY), leaderboard: onBoard, settings: onSettings }
    for (const { id, y } of BUTTONS) {
      const button = new HomeButton(this.scene, id, y)
      button.on('pointerup', () => { ctx.audio?.ui('CONFIRM'); actions[id]() })
      root.add(button)
      this.focusable('p0', `p0-${id}`, button, actions[id])
    }
    ctx.ui.focus.activate('p0', 'p0-start')
    root.add([hintBar(this.scene, 968, 40), this.label(hint, 960, 968, uiTokens.type.micro)])
  }
}
