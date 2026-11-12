import Phaser from 'phaser'
import { actionLabel, COMBAT_ACTIONS, combinationRows, ControlsEditor, keyLabel, menuKeys, RESET_ROW, type ControlProfiles } from '../../input/ControlProfile'
import { PAD_RULES, PAD_SYSTEM, padLabel, type PadCode, type PadProfiles } from '../../input/GamepadProfile'
import type { InputManager, OwnedUiAction, PlayerSlotId } from '../../input/InputManager'
import { ActionButton, AngularPanel } from '../VisualComponents'
import { colorHex, uiTokens } from '../tokens/uiTokens'
import { typography } from '../tokens/typography'

const { colors } = uiTokens
// 分組間距：移動／跳蹲／拳／腳／暫停／重設。
const rowY = (i: number): number => 200 + i * 48 + [2, 4, 6, 8, RESET_ROW].filter((start) => i >= start).length * 14
export type Device = 'KEYBOARD' | 'GAMEPAD'
export type PadSettings = { profiles: PadProfiles; onSave: (profiles: PadProfiles) => void; input: Pick<InputManager, 'padOwner' | 'padPress'> }

/** 1P／2P 操作設定面板（列表時 ←→ 切換玩家、TAB 切換鍵盤／搖桿）；開啟期間獨占鍵盤（capture），按鍵不會流到 InputManager 或 Phaser。PLAYER 1 的搖桿也能完整操作（updatePad）。 */
export class ControlsPanel {
  private readonly root: Phaser.GameObjects.Container
  private readonly rows: Array<{ focus: Phaser.GameObjects.Rectangle; key: Phaser.GameObjects.Text }> = []
  private readonly message: Phaser.GameObjects.Text
  private readonly combos: Phaser.GameObjects.Text[]
  private readonly hint: Phaser.GameObjects.Text
  private readonly title: Phaser.GameObjects.Text
  private readonly deviceLabel: Phaser.GameObjects.Text
  private readonly editors: { KEYBOARD: Record<PlayerSlotId, ControlsEditor>; GAMEPAD: Record<PlayerSlotId, ControlsEditor<PadCode>> }
  private player: PlayerSlotId = 'P1'
  private dialog?: Phaser.GameObjects.Container
  private get editor(): ControlsEditor | ControlsEditor<PadCode> { return this.editors[this.device][this.player] }

  constructor(private readonly scene: Phaser.Scene, profiles: ControlProfiles, onSave: (profiles: ControlProfiles) => void, private readonly pad: PadSettings, private readonly onClose: () => void, private device: Device = 'KEYBOARD') {
    this.editors = {
      KEYBOARD: { P1: new ControlsEditor(profiles, onSave, 'P1'), P2: new ControlsEditor(profiles, onSave, 'P2') },
      GAMEPAD: { P1: new ControlsEditor(pad.profiles, pad.onSave, 'P1', PAD_RULES), P2: new ControlsEditor(pad.profiles, pad.onSave, 'P2', PAD_RULES) },
    }
    this.root = scene.add.container(0, 0).setDepth(900)
    this.root.add(scene.add.rectangle(960, 540, 1920, 1080, colors.background0, 0.86).setInteractive())
    this.root.add(new AngularPanel(scene, 980, 1040, colors.panelRaised, 0.96).setPosition(960, 540))
    this.root.add(scene.add.text(520, 100, 'CONTROLS', typography.heading).setOrigin(0, 0.5))
    this.title = scene.add.text(1400, 120, '', typography.note).setOrigin(1, 0.5).setInteractive({ useHandCursor: true })
    this.title.on('pointerup', () => this.switchPlayer())
    this.deviceLabel = scene.add.text(1400, 158, '', typography.note).setOrigin(1, 0.5).setInteractive({ useHandCursor: true })
    this.deviceLabel.on('pointerup', () => this.switchDevice())
    this.root.add([this.title, this.deviceLabel])
    ;[...COMBAT_ACTIONS.map(actionLabel), 'RESET TO DEFAULT'].forEach((text, i) => {
      const y = rowY(i), focus = scene.add.rectangle(960, y, 860, 46, colors.playerPrimary, 0.28).setStrokeStyle(2, colors.playerGlow).setInteractive({ useHandCursor: true })
      focus.on('pointerup', () => { if (this.editor.state === 'SELECT_BINDING') { this.editor.focus = i; this.activate(); this.sync() } })
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

  /**
   * 每幀由場景呼叫，p1 是 PLAYER 1 手把本幀的選單動作。
   * 擷取狀態在處理本幀動作之前判斷：啟動擷取的那一下 ✕ 同時也是新按下的鍵碼，要等下一幀才開始收。
   * 擷取中 R1（任一方的返回）等同 Escape；GAMEPAD 分頁只收目前玩家自己手把的新按下。
   */
  updatePad(p1: readonly OwnedUiAction[]): void {
    const { editor } = this
    if (editor.state === 'LISTENING_FOR_KEY') {
      const code = this.device === 'GAMEPAD' ? this.pad.input.padPress(this.player) : undefined
      if (p1.includes('BACK') || code === PAD_SYSTEM.BACK) editor.capture('Escape')
      else if (code) editor.capture(code)
      else return
      this.sync(); return
    }
    p1.forEach((action) => this.command(action))
  }

  private switchPlayer(): void { if (this.editor.state !== 'SELECT_BINDING') return; this.player = this.player === 'P1' ? 'P2' : 'P1'; this.editor.message = ''; this.sync() }
  private switchDevice(): void { if (this.editor.state !== 'SELECT_BINDING') return; const focus = this.editor.focus; this.device = this.device === 'KEYBOARD' ? 'GAMEPAD' : 'KEYBOARD'; this.editor.focus = focus; this.editor.message = ''; this.sync() }
  /** 該玩家還沒有手把時不進入擷取：擷取只認玩家自己的手把，否則會一直等不到。 */
  private activate(): void {
    const { editor } = this
    if (this.device === 'GAMEPAD' && editor.state === 'SELECT_BINDING' && editor.focus !== RESET_ROW && this.pad.input.padOwner(this.player) === undefined) { editor.message = `PRESS ANY BUTTON ON THE PLAYER ${this.player.slice(1)} STICK FIRST`; return }
    editor.activate()
  }
  /** 列表與對話框的選單動作；鍵盤與 1P 手把共用。 */
  private command(action: OwnedUiAction): void {
    const { editor } = this, dialog = editor.state === 'CONFLICT' || editor.state === 'CONFIRM_RESET'
    if (action === 'NAV_UP' || action === 'NAV_DOWN') { if (!dialog) editor.move(action === 'NAV_UP' ? -1 : 1) }
    else if (action === 'NAV_LEFT' || action === 'NAV_RIGHT') { if (dialog) editor.move(1); else { this.switchPlayer(); return } }
    else if (action === 'CONFIRM') this.activate()
    else if (editor.back()) { this.onClose(); return }
    this.sync()
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    event.preventDefault(); event.stopPropagation()
    if (event.repeat) return
    const { editor } = this, code = event.code
    if (editor.state === 'LISTENING_FOR_KEY') { if (this.device === 'KEYBOARD' || code === 'Escape') editor.capture(code); this.sync(); return }
    if (code === 'Tab') { this.switchDevice(); return }
    // 選單鍵跟著目前（含剛改的）鍵盤鍵位，與其他畫面同一規則；GAMEPAD 分頁也用鍵盤操作面板。
    const k = menuKeys(this.editors.KEYBOARD[this.player].bindings, this.player), is = (...codes: (readonly string[] | undefined)[]): boolean => codes.some((list) => list?.includes(code))
    const action: OwnedUiAction | undefined = is(['ArrowUp'], k.NAV_UP) ? 'NAV_UP' : is(['ArrowDown'], k.NAV_DOWN) ? 'NAV_DOWN' : is(['ArrowLeft'], k.NAV_LEFT) ? 'NAV_LEFT' : is(['ArrowRight'], k.NAV_RIGHT) ? 'NAV_RIGHT' : is(['Enter', 'Space'], k.CONFIRM) ? 'CONFIRM' : is(['Escape', 'Backspace'], k.BACK) ? 'BACK' : undefined
    if (action) this.command(action)
  }

  private sync(): void {
    const { editor } = this, p2 = this.player === 'P2', gamepad = this.device === 'GAMEPAD', primary = p2 ? colors.enemyPrimary : colors.playerPrimary, glow = p2 ? colors.enemyGlow : colors.playerGlow
    this.title.setText(`◀ PLAYER ${this.player.slice(1)} ▶ · 操作設定`).setColor(colorHex(p2 ? 'enemyGlow' : 'playerGlow'))
    this.deviceLabel.setText(gamepad ? 'KEYBOARD  [ GAMEPAD ]  · TAB' : '[ KEYBOARD ]  GAMEPAD  · TAB')
    this.rows.forEach(({ focus, key }, i) => {
      const listening = editor.state === 'LISTENING_FOR_KEY' && editor.focus === i
      focus.setVisible(editor.focus === i).setFillStyle(primary, 0.28).setStrokeStyle(2, glow)
      key.setText(i === RESET_ROW ? '' : listening ? gamepad ? 'PRESS A BUTTON...' : 'PRESS A KEY...' : `[ ${editor.rules.label(editor.bindings[COMBAT_ACTIONS[i]])} ]`).setColor(colorHex(listening ? 'resultGold' : 'textPrimary'))
    })
    const k = menuKeys(this.editors.KEYBOARD[this.player].bindings, this.player), label = (codes?: readonly string[]): string => keyLabel(codes?.[0] ?? '')
    // 面板只聽 1P 搖桿，所以確認鍵顯示 1P 的輕踢鍵。
    const confirm = padLabel(this.editors.GAMEPAD.P1.bindings.LIGHT_KICK), back = padLabel(PAD_SYSTEM.BACK)
    this.hint.setText(!gamepad
      ? `↑↓ / ${label(k.NAV_UP)} ${label(k.NAV_DOWN)} 選擇 · ENTER / ${label(k.CONFIRM)} 改鍵 · ESC / ${label(k.BACK)} 返回 · ← → 切換玩家`
      : editor.state === 'LISTENING_FOR_KEY'
        ? `按下 ${this.player.slice(1)}P 搖桿要綁定的按鈕 · ${back} / ESC 取消`
        : `1P 搖桿：↑↓ 選擇 · ${confirm} 改鍵 · ${back} 返回 · ← → 切換玩家 · TAB 鍵盤`)
    combinationRows(editor.bindings, editor.rules.label).forEach(({ label, keys }, i) => this.combos[i].setText(`${label}　${keys}`))
    this.message.setText(editor.state === 'CONFIRM_RESET' ? '' : editor.message)
    this.dialog?.destroy(true); this.dialog = undefined
    if (editor.state !== 'CONFLICT' && editor.state !== 'CONFIRM_RESET') return
    const reset = editor.state === 'CONFIRM_RESET'
    const dialog = this.scene.add.container(960, 540)
    dialog.add([this.scene.add.rectangle(0, 0, 1920, 1080, colors.background0, 0.6).setInteractive(), new AngularPanel(this.scene, 820, 320, colors.panel, 1)])
    dialog.add(this.scene.add.text(0, -80, reset ? `RESET ALL PLAYER ${this.player.slice(1)} ${gamepad ? 'GAMEPAD ' : ''}CONTROLS?` : editor.message, { ...typography.secondaryAction, align: 'center', wordWrap: { width: 740 } }).setOrigin(0.5))
    ;[reset ? 'RESET' : 'SWAP', 'CANCEL'].forEach((text, i) => {
      const button = new ActionButton(this.scene, text, 300, 84, i ? colors.panelRaised : primary).setPosition(i ? 170 : -170, 60).setFocused(editor.choice === i)
      button.on('pointerup', () => { editor.choice = i; editor.activate(); this.sync() })
      dialog.add(button)
    })
    this.root.add(dialog); this.dialog = dialog
  }
}
