import Phaser from 'phaser'
import { actionLabel, COMBAT_ACTIONS, combinationRows, keyLabel, RESET_ROW, type ControlsEditor } from '../../input/ControlProfile'
import { p1MenuKeys } from '../../input/InputManager'
import { ActionButton, AngularPanel } from '../VisualComponents'
import { colorHex, uiTokens } from '../tokens/uiTokens'
import { typography } from '../tokens/typography'

const { colors } = uiTokens
// 分組間距：移動／跳蹲／拳／腳／防禦與暫停。
const rowY = (i: number): number => 200 + i * 48 + [2, 4, 6, 8, RESET_ROW].filter((start) => i >= start).length * 14

/** P1 操作設定面板；開啟期間獨占鍵盤（capture），按鍵不會流到 InputManager 或 Phaser。 */
export class ControlsPanel {
  private readonly root: Phaser.GameObjects.Container
  private readonly rows: Array<{ focus: Phaser.GameObjects.Rectangle; key: Phaser.GameObjects.Text }> = []
  private readonly message: Phaser.GameObjects.Text
  private readonly combos: Phaser.GameObjects.Text[]
  private readonly hint: Phaser.GameObjects.Text
  private dialog?: Phaser.GameObjects.Container

  constructor(private readonly scene: Phaser.Scene, private readonly editor: ControlsEditor, private readonly onClose: () => void) {
    this.root = scene.add.container(0, 0).setDepth(900)
    this.root.add(scene.add.rectangle(960, 540, 1920, 1080, colors.background0, 0.86).setInteractive())
    this.root.add(new AngularPanel(scene, 980, 1040, colors.panelRaised, 0.96).setPosition(960, 540))
    this.root.add(scene.add.text(520, 100, 'CONTROLS', typography.heading).setOrigin(0, 0.5))
    this.root.add(scene.add.text(1400, 120, 'PLAYER 1 · 操作設定', { ...typography.note, color: colorHex('playerGlow') }).setOrigin(1, 0.5))
    ;[...COMBAT_ACTIONS.map(actionLabel), 'RESET TO DEFAULT'].forEach((text, i) => {
      const y = rowY(i), focus = scene.add.rectangle(960, y, 860, 46, colors.playerPrimary, 0.28).setStrokeStyle(2, colors.playerGlow).setInteractive({ useHandCursor: true })
      focus.on('pointerup', () => { if (this.editor.state === 'SELECT_BINDING') { this.editor.focus = i; this.editor.activate(); this.sync() } })
      const name = scene.add.text(560, y, text, { ...typography.instruction, color: colorHex(i === RESET_ROW ? 'resultGold' : 'textPrimary') }).setOrigin(0, 0.5)
      const key = scene.add.text(1360, y, '', { ...typography.secondaryAction, fontSize: uiTokens.type.body }).setOrigin(1, 0.5)
      this.root.add([focus, name, key]); this.rows.push({ focus, key })
    })
    // 組合操作：唯讀，隨綁定更新。
    this.combos = [0, 1, 2].map((i) => scene.add.text(560, 805 + i * 40, '', { ...typography.note, color: colorHex('textSecondary') }).setOrigin(0, 0.5))
    this.root.add(this.combos)
    this.message = scene.add.text(960, 960, '', { ...typography.instruction, color: colorHex('resultGold') }).setOrigin(0.5)
    this.hint = scene.add.text(960, 1030, '', typography.note).setOrigin(0.5)
    this.root.add([this.message, this.hint])
    window.addEventListener('keydown', this.onKey, true)
    this.sync()
  }

  destroy(): void { window.removeEventListener('keydown', this.onKey, true); this.root.destroy(true) }

  private readonly onKey = (event: KeyboardEvent): void => {
    event.preventDefault(); event.stopPropagation()
    if (event.repeat) return
    const { editor } = this, code = event.code, dialog = editor.state === 'CONFLICT' || editor.state === 'CONFIRM_RESET'
    // 選單鍵跟著目前（含剛改的）鍵位，與其他畫面同一規則。
    const k = p1MenuKeys(editor.bindings), is = (...codes: (readonly string[] | undefined)[]): boolean => codes.some((list) => list?.includes(code))
    if (editor.state === 'LISTENING_FOR_KEY') editor.capture(code)
    else if (is(['ArrowUp'], k.NAV_UP) && !dialog) editor.move(-1)
    else if (is(['ArrowDown'], k.NAV_DOWN) && !dialog) editor.move(1)
    else if (is(['ArrowLeft', 'ArrowRight'], k.NAV_LEFT, k.NAV_RIGHT) && dialog) editor.move(1)
    else if (is(['Enter', 'Space'], k.CONFIRM)) editor.activate()
    else if (is(['Escape', 'Backspace'], k.BACK) && editor.back()) { this.onClose(); return }
    this.sync()
  }

  private sync(): void {
    const { editor } = this
    this.rows.forEach(({ focus, key }, i) => {
      const listening = editor.state === 'LISTENING_FOR_KEY' && editor.focus === i
      focus.setVisible(editor.focus === i)
      key.setText(i === RESET_ROW ? '' : listening ? 'PRESS A KEY...' : `[ ${keyLabel(editor.bindings[COMBAT_ACTIONS[i]])} ]`).setColor(colorHex(listening ? 'resultGold' : 'textPrimary'))
    })
    const k = p1MenuKeys(editor.bindings), label = (codes?: readonly string[]): string => keyLabel(codes?.[0] ?? '')
    this.hint.setText(`↑↓ / ${label(k.NAV_UP)} ${label(k.NAV_DOWN)} 選擇 · ENTER / ${label(k.CONFIRM)} 改鍵 · ESC / ${label(k.BACK)} 返回`)
    combinationRows(editor.bindings).forEach(({ label, keys }, i) => this.combos[i].setText(`${label}　${keys}`))
    this.message.setText(editor.state === 'CONFIRM_RESET' ? '' : editor.message)
    this.dialog?.destroy(true); this.dialog = undefined
    if (editor.state !== 'CONFLICT' && editor.state !== 'CONFIRM_RESET') return
    const reset = editor.state === 'CONFIRM_RESET'
    const dialog = this.scene.add.container(960, 540)
    dialog.add([this.scene.add.rectangle(0, 0, 1920, 1080, colors.background0, 0.6).setInteractive(), new AngularPanel(this.scene, 820, 320, colors.panel, 1)])
    dialog.add(this.scene.add.text(0, -80, reset ? 'RESET ALL PLAYER 1 CONTROLS?' : editor.message, { ...typography.secondaryAction, align: 'center', wordWrap: { width: 740 } }).setOrigin(0.5))
    ;[reset ? 'RESET' : 'SWAP', 'CANCEL'].forEach((text, i) => {
      const button = new ActionButton(this.scene, text, 300, 84, i ? colors.panelRaised : colors.playerPrimary).setPosition(i ? 170 : -170, 60).setFocused(editor.choice === i)
      button.on('pointerup', () => { editor.choice = i; editor.activate(); this.sync() })
      dialog.add(button)
    })
    this.root.add(dialog); this.dialog = dialog
  }
}
