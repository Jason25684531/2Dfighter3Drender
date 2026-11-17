import type Phaser from 'phaser'
import type { P1SelectView } from '../p1/P1SelectView'
import { ScreenView, type ScreenContext } from './ScreenView'

/** P1：選角畫面本體在 P1SelectView；已生成名冊還在讀取時先顯示等待字樣。 */
export class SelectScreen extends ScreenView {
  readonly view?: P1SelectView

  constructor(ctx: ScreenContext, root: Phaser.GameObjects.Container, build?: (root: Phaser.GameObjects.Container) => P1SelectView) {
    super(ctx, root)
    if (build) this.view = build(root)
    else root.add(this.label('載入已生成角色…', 960, 540))
  }

  destroy(): void { this.view?.destroy(); super.destroy() }
}
