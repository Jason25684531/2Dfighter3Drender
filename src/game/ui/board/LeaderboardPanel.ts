import Phaser from 'phaser'
import { ActionButton, AngularPanel } from '../VisualComponents'
import { colorHex, uiTokens } from '../tokens/uiTokens'
import { typography } from '../tokens/typography'
import type { LeaderboardPanelModel, LeaderboardPanelStatus } from '../ViewModels'

const { colors } = uiTokens
const STATUS_TEXT: Record<LeaderboardPanelStatus, string> = { LOADING: 'LOADING ・ 載入中…', READY: '', EMPTY: 'NO RECORDS YET ・ 尚無紀錄', OFFLINE: 'OFFLINE ・ 無法連線，稍後再試' }
const ROW_TOP = 250, ROW_STEP = 62

/** 首頁排行榜覆蓋面板（Top 10）；開啟期間獨占鍵盤，ESC／K／ENTER／J／Backspace 關閉，不流到 P0。 */
export class LeaderboardPanel {
  private readonly root: Phaser.GameObjects.Container
  private readonly rows: Phaser.GameObjects.Container
  private readonly status: Phaser.GameObjects.Text

  constructor(private readonly scene: Phaser.Scene, model: LeaderboardPanelModel, private readonly onClose: () => void) {
    this.root = scene.add.container(0, 0).setDepth(900)
    this.root.add(scene.add.rectangle(960, 540, 1920, 1080, colors.background0, 0.86).setInteractive())
    this.root.add(new AngularPanel(scene, 1000, 880, colors.panelRaised, 0.96).setPosition(960, 520))
    this.root.add(scene.add.text(480, 130, 'LEADERBOARD', typography.heading).setOrigin(0, 0.5))
    this.root.add(scene.add.text(1440, 150, 'TOP 10 ・ 排行榜', { ...typography.note, color: colorHex('resultGold') }).setOrigin(1, 0.5))
    this.rows = scene.add.container(0, 0); this.root.add(this.rows)
    this.status = scene.add.text(960, 520, '', { ...typography.instruction, color: colorHex('textSecondary') }).setOrigin(0.5); this.root.add(this.status)
    const close = new ActionButton(scene, 'CLOSE', 320, 80, colors.panelRaised, '關閉').setPosition(960, 900).setFocused(true)
    close.on('pointerup', () => this.onClose()); this.root.add(close)
    this.root.add(scene.add.text(960, 970, 'ESC / K / ENTER 關閉', typography.note).setOrigin(0.5))
    window.addEventListener('keydown', this.onKey, true)
    this.update(model)
  }

  update(model: LeaderboardPanelModel): void {
    this.rows.removeAll(true); this.status.setText(STATUS_TEXT[model.status])
    model.rows.forEach((row, i) => {
      const y = ROW_TOP + i * ROW_STEP, top = row.rank === 1
      this.rows.add([
        this.scene.add.rectangle(960, y, 880, 50, top ? colors.playerPrimary : colors.background0, top ? 0.3 : 0.5).setStrokeStyle(1, colors.lineDim),
        this.scene.add.text(560, y, String(row.rank), { ...typography.secondaryAction, color: colorHex(top ? 'resultGold' : 'textSecondary') }).setOrigin(0.5),
        this.scene.add.text(640, y, row.name, { ...typography.instruction, color: colorHex('textPrimary') }).setOrigin(0, 0.5),
        this.scene.add.text(1130, y, row.title, { ...typography.note, color: colorHex('resultGold') }).setOrigin(0.5),
        this.scene.add.text(1360, y, String(row.score), { ...typography.secondaryAction, color: colorHex('textPrimary') }).setOrigin(1, 0.5),
      ])
    })
  }

  destroy(): void { window.removeEventListener('keydown', this.onKey, true); this.root.destroy(true) }

  private readonly onKey = (event: KeyboardEvent): void => {
    event.preventDefault(); event.stopPropagation()
    if (!event.repeat && ['Escape', 'KeyK', 'Enter', 'KeyJ', 'Backspace'].includes(event.code)) this.onClose()
  }
}
