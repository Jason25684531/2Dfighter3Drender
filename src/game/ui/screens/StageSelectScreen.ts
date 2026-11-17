import type Phaser from 'phaser'
import type { UIAction } from '../../input/InputManager'
import { ActionButton, StageCard } from '../VisualComponents'
import { uiTokens } from '../tokens/uiTokens'
import { typography } from '../tokens/typography'
import { stageSelectViewModel } from '../ViewModels'
import { stageTextureKey, type StageId } from '../assets/TestAssetManifest'
import { ScreenView, type ScreenContext } from './ScreenView'

const SUBTITLE: Record<StageId, string> = { laboratory: '實驗室', 'company-building': '企業總部' }

/** P2：兩張場景卡＋確認。←→ 切卡即選取，↓ 到確認，↑ 回選取的卡；確認鍵在卡上直接進 P3。 */
export class StageSelectScreen extends ScreenView {
  private readonly ids: StageId[]
  private readonly cards = new Map<StageId, StageCard>()

  constructor(ctx: ScreenContext, root: Phaser.GameObjects.Container, private selected: StageId, step: number, private readonly onSelect: (id: StageId) => void, onConfirm: () => void) {
    super(ctx, root)
    const vm = stageSelectViewModel(selected)
    this.ids = vm.stages.map((stage) => stage.id)
    root.add(this.heading(vm.heading))
    root.add(this.scene.add.text(110, 174, `${step} / ${step} ・ 選擇對戰場景`, typography.instruction))
    vm.stages.forEach((stage, index) => {
      const card = new StageCard(this.scene, stage.label, stageTextureKey(stage.id), 780, 500, SUBTITLE[stage.id]).setPosition(530 + index * 860, 550).setSelected(stage.id === selected)
      // 滑鼠點卡＝選取並移到確認；鍵盤焦點即選取，確認鍵直接進 P3。
      card.setInteractive({ useHandCursor: true }).on('pointerup', () => { this.select(stage.id); ctx.ui.focus.activate('stage', 'stage-confirm') })
      root.add(card); this.cards.set(stage.id, card)
      this.focusable('stage', `stage-${stage.id}`, card, onConfirm)
    })
    const confirm = new ActionButton(this.scene, 'CONFIRM', 350, 88, uiTokens.colors.playerPrimary, '確認').setPosition(1610, 952)
    confirm.on('pointerup', onConfirm); root.add(confirm)
    this.focusable('stage', 'stage-confirm', confirm, onConfirm)
    ctx.ui.focus.activate('stage', `stage-${selected}`)
  }

  handleAction(action: UIAction): boolean {
    const focus = this.ctx.ui.focus, onCard = this.ids.some((id) => focus.current() === `stage-${id}`)
    if (onCard && (action === 'NAV_LEFT' || action === 'NAV_RIGHT')) {
      const next = this.ids[(this.ids.indexOf(this.selected) + (action === 'NAV_RIGHT' ? 1 : this.ids.length - 1)) % this.ids.length]
      this.select(next); focus.activate('stage', `stage-${next}`); return true
    }
    if (onCard && action === 'NAV_DOWN') { focus.activate('stage', 'stage-confirm'); return true }
    if (onCard && action === 'NAV_UP') return true
    if (!onCard && action === 'NAV_UP') { focus.activate('stage', `stage-${this.selected}`); return true }
    return false
  }

  private select(id: StageId): void {
    this.selected = id
    this.cards.forEach((card, key) => card.setSelected(key === id))
    this.onSelect(id)
  }
}
