import Phaser from 'phaser'
import type { OwnedUiAction, PlayerSlotId, UIAction } from '../../input/InputManager'
import { keyLabel, loadProfiles, menuKeys, SYSTEM_BACK_KEY } from '../../input/ControlProfile'
import { NICKNAME_MAX, sectionOf, selectSectionTitles, type P1SelectionModel, type SelectFeedback, type Slot } from '../../select/P1SelectionModel'
import { ActionButton, AngularPanel, hintBar } from '../VisualComponents'
import { spriteDisplayHeight, spriteOriginY, spriteTextureFrame, spriteTextureKey, type SpriteId } from '../animation/TemporarySpriteManifest'
import { headKey } from './headCrop'
import { loadPadProfiles, PAD_SYSTEM, padLabel } from '../../input/GamepadProfile'
import { isSheetSprite } from '../animation/SheetSpriteManifest'
import { drawFrame } from '../animation/SpriteHitTest'
import { colorHex, reducedMotion, uiTokens, type UiColorToken } from '../tokens/uiTokens'
import { hudDisplay, hudLabel, typography } from '../tokens/typography'
import { stopOwnedTweens } from '../tweens'
import { NAME_KEYS, NameKeyboard } from './NameKeyboard'
import layout from '../assets/hudLayout.json'
import { AI_DIFFICULTY_LABELS } from '../../config/aiProfiles'

export type P1ViewHooks = {
  offline: boolean
  onInput: (owner: PlayerSlotId, action: OwnedUiAction) => void
  /** 右鍵或 R2：請求刪除該格的已生成角色（由 AppScene 判斷能不能刪並確認）。 */
  onDelete?: (index: number) => void
  onFocus: (owner: PlayerSlotId, index: number) => void
  onNickname: (owner: PlayerSlotId, name: string) => void
  onProcessingDone?: () => void
  onSkip?: () => void
  onAllReady: () => void
}

const { p1, colors, type } = uiTokens
type Identity = { main: number; glow: number; text: UiColorToken; tag: string; label: string }
// 鍵名跟著已存的自訂鍵位（與 InputManager 同一規則：menuKeys）。
const withKeys = (owner: PlayerSlotId, base: Identity): Identity & { keys: string; back: string; confirm: string } => ({ ...base,
  get keys() { const k = menuKeys(loadProfiles()[owner], owner); return [k.NAV_UP, k.NAV_LEFT, k.NAV_DOWN, k.NAV_RIGHT].map((codes) => keyLabel(codes[0] ?? '')).join(' ') },
  get confirm() { return keyLabel(menuKeys(loadProfiles()[owner], owner).CONFIRM[0] ?? '') },
  get back() { return keyLabel(menuKeys(loadProfiles()[owner], owner).BACK[0] ?? '') } })
const difficultyKeys = () => {
  const { NAV_LEFT, NAV_RIGHT } = menuKeys(loadProfiles().P1, 'P1')
  return [NAV_LEFT[0], NAV_RIGHT[0]].map(keyLabel).join(' ')
}
/** 每次遊玩限生成一次；PLAY AGAIN 仍是同一次遊玩，游標已預設在剛生成的角色。 */
const NAME_REQUIRED_HINT = 'ENTER A NAME FIRST · 請先輸入名稱'
const NAME_TAKEN_HINT = 'NAME ALREADY USED · 名稱已被 1P 使用，請改一個'
const FACE_USED_HINT = '本次已生成角色 · 請改選名冊中的角色，或結算後選 FINISH 重新拍照'
const identity = {
  P1: withKeys('P1', { main: colors.playerPrimary, glow: colors.playerGlow, text: 'playerGlow', tag: '1P', label: 'PLAYER 1' }),
  P2: withKeys('P2', { main: colors.enemyPrimary, glow: colors.enemyGlow, text: 'enemyGlow', tag: '2P', label: 'PLAYER 2' }),
}
const pad = (index: number): string => String(index).padStart(2, '0')
// 拍照／確認照片共用的取景框（16:9，全幅不裁切）；暱稱頁不佔用。
const VIEWFINDER = { x: 960, y: 590, width: 800, height: 450 }
const cellRect = (index: number) => layout.selectCells[index - 1]
const cellCenter = (index: number): { x: number; y: number } => {
  const { x, y, w, h } = cellRect(index)
  return { x: x + w / 2, y: y + h / 2 }
}
const slotGroup = (index: number) => index <= 4 ? 'body' : index <= 6 ? 'saga' : index <= 10 ? 'guest' : 'roster'
const groupNames = { body: '化身鬥士', saga: 'ROG SAGA 英雄', guest: '特邀鬥士', roster: '參戰者名錄' }
const groupColors = { body: colors.selectBody, saga: colors.selectSaga, guest: colors.selectGuest, roster: colors.selectRoster }
const groupBackground = { body: colors.selectBodyBackground, saga: colors.selectSagaBackground, guest: colors.selectGuestBackground, roster: colors.selectRosterBackground }
const slotKind = (slot: Slot): string => slot.type === 'EMPTY' ? '空位' : groupNames[slotGroup(slot.index)]
const selectImage = (scene: Phaser.Scene, key: keyof typeof layout.select) => {
  const { x, y } = layout.select[key]
  return scene.add.image(x, y, key).setOrigin(0)
}
const label = (scene: Phaser.Scene, x: number, y: number, text: string, color: UiColorToken = 'textSecondary', size: number = type.label): Phaser.GameObjects.Text => scene.add.text(x, y, text, { ...typography.note, fontSize: size, color: colorHex(color) })
const glowOn = (object: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite | Phaser.GameObjects.Graphics, color: number, strength = 4): void => { if (object.scene.game.renderer.type === Phaser.WEBGL) object.postFX?.addGlow(color, strength, 0, false, 0.1, 12) }

const previewFloor = Math.min(layout.selectPanels.nickname.y, layout.selectPanels.rival.y) - 30

/** Fit the visible idle pose, including its animation, inside the space beside the grid. */
function fitPreview(image: Phaser.GameObjects.Sprite, left: boolean, parentX: number, parentY: number): void {
  const n = 96
  const probe = Object.assign(document.createElement('canvas'), { width: n, height: n }).getContext('2d', { willReadFrequently: true })
  if (!probe) return
  const frames = image.anims.currentAnim?.frames.map(({ frame }) => frame) ?? [image.frame]
  for (const frame of frames) {
    drawFrame(probe, frame, n, n)
  }
  const pixels = probe.getImageData(0, 0, n, n).data
  let minX = n, minY = n, maxX = 0, maxY = 0
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (pixels[(y * n + x) * 4 + 3] < 16) continue
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + 1); maxY = Math.max(maxY, y + 1)
  }
  if (maxX <= minX) return
  const { body, guest, 'panel-p1': panel } = layout.selectPanels
  const edge = left ? 0 : guest.x + guest.w, width = left ? body.x : uiTokens.logicalWidth - edge
  const scale = Math.min(image.scaleX, (width - 20) * n / ((maxX - minX) * image.width),
    (previewFloor - panel.y - panel.h - 25) * n / ((maxY - minY) * image.height))
  image.setScale(scale)
  const center = ((minX + maxX) / (2 * n) - image.originX) * image.displayWidth
  const bottom = (maxY / n - image.originY) * image.displayHeight
  image.setPosition(edge + width / 2 - parentX - (left ? center : -center), previewFloor - parentY - bottom)
}

/** DEPTH 2：大型角色主體。內容只在格子/鎖定變化時替換，不重建畫面。 */
class HeroPreview extends Phaser.GameObjects.Container {
  private readonly beam: Phaser.GameObjects.Graphics | Phaser.GameObjects.Image
  private readonly ring?: Phaser.GameObjects.Image
  private readonly silhouette?: Phaser.GameObjects.Image
  private readonly title: Phaser.GameObjects.Text
  private readonly kind: Phaser.GameObjects.Text
  private figure?: Phaser.GameObjects.Sprite
  private stamp?: Phaser.GameObjects.Text
  private key = ''
  private pulse?: Phaser.Tweens.Tween
  private flash?: Phaser.Time.TimerEvent
  private readonly tweens: Phaser.Tweens.Tween[] = []

  constructor(scene: Phaser.Scene, private readonly owner: PlayerSlotId, private readonly mainGrid: boolean) {
    super(scene, mainGrid ? (owner === 'P1' ? 326 : 1608) : p1.hero.x[owner], p1.hero.footY)
    const id = identity[owner], left = owner === 'P1'
    const stage = scene.add.container(0, 0)
    if (mainGrid) {
      stage.setPosition(-this.x, -this.y)
      this.beam = selectImage(scene, left ? 'spotlight-p1' : 'spotlight-p2')
      this.ring = selectImage(scene, left ? 'ring-p1' : 'ring-p2')
      stage.add([this.beam, this.ring])
      if (!left) {
        this.silhouette = selectImage(scene, 'silhouette-p2')
        stage.add(this.silhouette)
      }
    } else {
      stage.setScale(left ? 1 : -1, 1)
      this.beam = scene.add.graphics().fillStyle(id.main, 1).fillPoints([new Phaser.Math.Vector2(-230, 60), new Phaser.Math.Vector2(110, 60), new Phaser.Math.Vector2(330, -780), new Phaser.Math.Vector2(-10, -780)], true)
      const lines = scene.add.graphics().lineStyle(2, id.glow, 0.5)
      for (let i = 0; i < 7; i += 1) lines.lineBetween(-160 + i * 50, 40, -20 + i * 50, -500)
      stage.add([this.beam, lines, scene.add.ellipse(0, 4, 300, 44, colors.shadow, 0.5)])
      if (!reducedMotion) this.tweens.push(scene.tweens.add({ targets: lines, y: -60, duration: 2000, repeat: -1 }))
    }
    const titleStyle = mainGrid ? hudDisplay : typography.title
    this.title = scene.add.text(left ? 96 - this.x : 1824 - this.x, 330 - this.y, '', { ...titleStyle, fontSize: type.h1, color: colorHex(id.text), stroke: colorHex('background0'), strokeThickness: uiTokens.textStroke.standard }).setOrigin(left ? 0 : 1, 0.5)
    this.kind = label(scene, this.title.x, 384 - this.y, '').setOrigin(left ? 0 : 1, 0.5).setStroke(colorHex('background0'), 5)
    if (mainGrid && left) { this.title.setVisible(false); this.kind.setVisible(false) }
    this.add([stage, this.title, this.kind])
  }

  /** stamp：READY＝已就緒；LOCKED＝已鎖定 Body、尚待拍照；CPU＝單人模式的對手。 */
  show(slot: Slot | undefined, stamp: 'READY' | 'LOCKED' | 'CPU' | undefined, nickname = '', dim = false): void {
    // 兩側全身放大約 5 倍：原圖待機（AppScene 選到時載入）到了就換，精簡版只當載入前的替身。
    const compact = slot?.entry?.spriteId, sprite: SpriteId | undefined = compact && this.scene.textures.exists(`hd-${compact}-idle`) ? `hd-${compact}` : compact
    const texture = sprite && spriteTextureKey(sprite, 'idle')
    const key = `${slot?.index}|${stamp}|${nickname}|${dim}|${sprite}|${slot?.entry?.type}|${Boolean(texture && this.scene.textures.exists(texture))}`
    if (key === this.key) return
    const relock = Boolean(stamp) && this.key.split('|')[1] === 'undefined'
    this.key = key
    const id = identity[this.owner]
    this.flash?.remove(); this.figure?.destroy(); this.stamp?.destroy(); this.stamp = undefined
    this.beam.setAlpha(slot ? (stamp ? 0.55 : 0.3) : 0.12)
    this.silhouette?.setVisible(!slot)
    this.ring?.setY(slot ? previewFloor - this.ring.height / 2 : layout.select['ring-p2'].y)
    this.setAlpha(dim ? 0.4 : 1)
    const body = slot?.type === 'BODY_TEMPLATE'
    if (sprite && texture && this.scene.textures.exists(texture)) {
      const image = this.scene.add.sprite(0, 0, texture, spriteTextureFrame(sprite)).setOrigin(0.5, spriteOriginY(sprite)).setFlipX(this.owner === 'P2')
      if (isSheetSprite(sprite) && !body && !reducedMotion && this.scene.anims.exists(`${sprite}-idle`)) image.play(`${sprite}-idle`)
      image.setScale(p1.hero.height * (this.mainGrid ? 0.9 : 1) / image.height * spriteDisplayHeight(sprite) / 520)
      if (this.mainGrid) fitPreview(image, this.owner === 'P1', this.x, this.y)
      // Body 只顯示身形剪影（暫用替身 sprite 的輪廓），不冒充已生成角色。
      if (body) { image.setTintFill(colors.textPrimary).setAlpha(0.5); glowOn(image, colors.resultGold, 3) }
      else glowOn(image, id.main)
      if (relock && !body && !reducedMotion) { image.setTintFill(colors.textPrimary); this.flash = this.scene.time.delayedCall(60, () => image.active && image.clearTint()) }
      this.figure = image
      this.addAt(image, 1)
    } else this.figure = undefined
    this.title.setText(slot ? (nickname || slot.entry?.displayName || 'EMPTY') : `PRESS ${identity.P2.confirm}`)
    const kind = slot && (slot.type === 'BODY_TEMPLATE' ? 'CUSTOM BODY · CREATE YOUR FIGHTER' : this.mainGrid ? slotKind(slot) : slot.type === 'EMPTY' ? 'EMPTY SLOT' : sectionOf(slot.index))
    this.kind.setText(slot ? `${pad(slot.index)} · ${kind}${nickname ? ' · ' + (slot.entry?.displayName ?? '') : ''}` : `TO JOIN · 按 ${identity.P2.confirm} 加入`)
    if (this.silhouette) { this.title.setVisible(!slot); this.kind.setVisible(!slot) }
    this.pulse?.stop(); this.title.setAlpha(1)
    if (!slot && !reducedMotion) this.pulse = this.scene.tweens.add({ targets: this.title, alpha: 0.45, duration: 600, yoyo: true, repeat: -1 })
    if (stamp) {
      this.stamp = this.scene.add.text(0, -250, stamp, { ...typography.title, fontSize: type.h1, color: colorHex(stamp === 'READY' ? 'statusLime' : stamp === 'CPU' ? 'enemyGlow' : 'resultGold'), stroke: colorHex('background0'), strokeThickness: uiTokens.textStroke.badge }).setOrigin(0.5).setRotation(-0.08)
      this.add(this.stamp)
    }
  }

  destroy(fromScene?: boolean): void { this.flash?.remove(); this.pulse?.stop(); stopOwnedTweens(this.tweens); super.destroy(fromScene) }
}

/** 最近一張「幾乎沒有細節」的照片；確認頁會整頁重建，所以記在模組層。 */
let blankPhoto: string | undefined

/** DEPTH 3：單一格子。 */
class GridSlotView extends AngularPanel {
  private readonly readyTags: Record<PlayerSlotId, Phaser.GameObjects.Container>
  private readonly statusLabel: Phaser.GameObjects.Text
  private readonly scan: Phaser.GameObjects.Rectangle
  private scanTween?: Phaser.Tweens.Tween
  private status?: string
  constructor(scene: Phaser.Scene, readonly slot: Slot) {
    const { w, h } = cellRect(slot.index), group = slotGroup(slot.index)
    super(scene, w, h, groupBackground[group], slot.entry ? 0.92 : 0.5, { slant: 0 })
    const body = slot.type === 'BODY_TEMPLATE', empty = !slot.entry
    const { x, y } = cellCenter(slot.index); this.setPosition(x, y)
    if (empty) {
      this.shape.setStrokeStyle(0)
      const dash = scene.add.graphics().lineStyle(1, groupColors[group], 0.7), left = -w / 2, top = -h / 2
      for (let x = left; x < -left; x += 6) { dash.lineBetween(x, top, x + 2, top); dash.lineBetween(x, -top, x + 2, -top) }
      for (let y = top; y < -top; y += 6) { dash.lineBetween(left, y, left, y + 2); dash.lineBetween(-left, y, -left, y + 2) }
      this.add([dash, label(scene, 0, 5, '等待\n挑戰者', 'textSecondary', 14).setOrigin(0.5).setAlpha(0.65)])
    }
    const bodyCard = `body-card-${slot.index}`
    const hasBodyCard = body && scene.textures.exists(bodyCard)
    if (hasBodyCard) this.add(scene.add.image(0, 0, bodyCard).setDisplaySize(w, h))
    else {
      this.setHead()
      if (body) this.add(label(scene, 0, -8, '+', 'resultGold', type.h2).setOrigin(0.5))
      this.add(label(scene, -w / 2 + 4, -h / 2, pad(slot.index), 'textPrimary', 15).setStroke(colorHex('background0'), 3))
    }
    if (!empty && !hasBodyCard) {
      const name = label(scene, 0, h / 2 - 11, slot.entry?.displayName ?? '', 'textPrimary', 14).setOrigin(0.5).setStroke(colorHex('background0'), 4)
      this.add(name.setScale(Math.min(1, (w - 6) / Math.max(1, name.width)), 1))
    }
    const tag = (owner: PlayerSlotId, offset: number): Phaser.GameObjects.Container => {
      const id = identity[owner]
      return scene.add.container(0, offset, [scene.add.rectangle(0, 0, w, 20, id.main, 0.95), label(scene, 0, 0, `${id.tag} READY`, 'textPrimary', 14).setOrigin(0.5)]).setVisible(false)
    }
    this.readyTags = { P1: tag('P1', 18), P2: tag('P2', 40) }
    this.add(Object.values(this.readyTags))
    this.scan = scene.add.rectangle(0, 0, 80, 8, colors.systemBlue, 0.4).setVisible(false)
    this.statusLabel = label(scene, 36, -40, '', 'statusLime', type.micro).setOrigin(1, 0.5)
    this.add([this.scan, this.statusLabel]); this.syncStatus()
    this.setInteractive({ useHandCursor: true })
  }
  private head?: Phaser.GameObjects.Image
  /** 頭像貼圖（512×512，AppScene 預先畫好）到了才建；身形格只畫「+」。 */
  setHead(): void {
    const sprite = this.slot.type === 'BODY_TEMPLATE' ? undefined : this.slot.entry?.spriteId
    if (this.head || !sprite || !this.scene.textures.exists(headKey(sprite))) return
    this.head = this.scene.add.image(0, -10, headKey(sprite)).setDisplaySize(72, 72); this.addAt(this.head, this.getIndex(this.shape) + 1)
  }
  setReady(owner: PlayerSlotId, ready: boolean): void { this.readyTags[owner].setVisible(ready) }
  syncStatus(): void {
    const status = this.slot.status
    if (this.status === status) return
    this.status = status; this.scanTween?.stop(); this.scan.setVisible(status === 'PROCESSING')
    if (this.slot.entry) this.shape.setStrokeStyle(1.5, groupColors[slotGroup(this.slot.index)], 0.9)
    this.statusLabel.setText(status === 'READY' ? 'NEW' : status === 'FAILED' ? '!' : status === 'PROCESSING' ? '…' : '').setColor(colorHex(status === 'FAILED' ? 'danger' : status === 'PROCESSING' ? 'systemBlue' : 'statusLime'))
    this.setAlpha(status === 'FAILED' ? 0.6 : 1)
    if (status === 'FAILED' || status === 'PROCESSING') this.shape.setStrokeStyle(2, status === 'FAILED' ? colors.danger : colors.systemBlue)
    if (status === 'PROCESSING' && !reducedMotion) this.scanTween = this.scene.tweens.add({ targets: this.scan, y: { from: 44, to: -44 }, duration: 1200, repeat: -1 })
  }
  destroy(fromScene?: boolean): void { this.scanTween?.stop(); super.destroy(fromScene) }
}

/** DEPTH 4：玩家游標。 */
class PlayerCursor extends Phaser.GameObjects.Container {
  private readonly frame: Phaser.GameObjects.Image
  private index = 0
  private slide?: Phaser.Tweens.Tween
  private shakeTween?: Phaser.Tweens.Tween
  readonly tag: Phaser.GameObjects.Text

  constructor(scene: Phaser.Scene, owner: PlayerSlotId) {
    super(scene, 0, 0)
    const id = identity[owner]
    const key = owner === 'P1' ? 'cursor-p1' : 'cursor-p2'
    this.frame = scene.add.image(0, 0, key)
    this.tag = label(scene, 0, 53, id.tag, 'textPrimary', 14).setOrigin(0.5).setBackgroundColor(colorHex('background0'))
    this.add([this.frame, this.tag])
  }

  place(index: number, locked: boolean, shared: boolean): void {
    if (index !== this.index) {
      const { x, y } = cellCenter(index)
      this.slide?.stop(); this.shakeTween?.stop()
      if (this.index && p1.cursor.slideMs) this.slide = this.scene.tweens.add({ targets: this, x, y, duration: p1.cursor.slideMs, ease: 'Cubic.Out' })
      else this.setPosition(x, y)
      this.index = index
    }
    const { w, h } = cellRect(index), left = this.frame.texture.key === 'cursor-p1'
    this.frame.setDisplaySize(w + 36, h + 36).setAlpha(locked ? 0.8 : 1)
    if (shared) this.frame.setCrop(left ? 0 : this.frame.width / 2, 0, this.frame.width / 2, this.frame.height - 20)
    else this.frame.setCrop()
    this.tag.setPosition(shared ? (left ? -23 : 23) : 0, h / 2 + 3).setVisible(shared || this.tag.text === 'CPU')
  }

  shake(): void {
    if (reducedMotion) return
    this.slide?.stop(); this.shakeTween?.stop()
    const { x, y } = cellCenter(this.index); this.setPosition(x, y)
    this.shakeTween = this.scene.tweens.add({ targets: this, x: x + 6, duration: 30, yoyo: true, repeat: 2, onComplete: () => { this.x = x } })
  }
  destroy(fromScene?: boolean): void { this.slide?.stop(); this.shakeTween?.stop(); super.destroy(fromScene) }
}

export class P1SelectView {
  private readonly heroes = {} as Record<PlayerSlotId, HeroPreview>
  private readonly cursors = {} as Partial<Record<PlayerSlotId, PlayerCursor>>
  private readonly slotViews: GridSlotView[] = []
  private readonly plates = {} as Partial<Record<PlayerSlotId, { status: Phaser.GameObjects.Text; detail: Phaser.GameObjects.Text }>>
  private nickname?: Phaser.GameObjects.Text
  private opponent?: Phaser.GameObjects.Text
  private readonly tweens: Phaser.Tweens.Tween[] = []
  private readonly timers: Phaser.Time.TimerEvent[] = []
  private modeText?: Phaser.GameObjects.Text
  private keysP2?: Phaser.GameObjects.Text
  private keysP1?: Phaser.GameObjects.Text
  private stepLabel?: Phaser.GameObjects.Text
  private banner?: Phaser.GameObjects.Container
  private bannerTimer?: Phaser.Time.TimerEvent
  private bannerTween?: Phaser.Tweens.Tween
  private nameInput?: Phaser.GameObjects.DOMElement
  // media：Phaser 定位的 camera wrapper 或 Review 照片；DOM 疊在 Canvas 上，離開確認框開啟時隱藏。
  private media?: Phaser.GameObjects.DOMElement
  private cameraVideo?: HTMLVideoElement
  private stream?: MediaStream
  private primary?: ActionButton
  private nameHint?: Phaser.GameObjects.Text
  private nameCount?: Phaser.GameObjects.Text
  private nameKeyboard?: NameKeyboard
  private keyCells: Phaser.GameObjects.Rectangle[][] = []
  private hint?: Phaser.GameObjects.Text
  private offlineLabel?: Phaser.GameObjects.Text
  private exitPanel?: Phaser.GameObjects.Container
  private exitButtons: ActionButton[] = []
  private exitChoice = 0
  private onExit?: () => void

  get exitOpen(): boolean { return Boolean(this.exitPanel) }
  refreshHeads(): void { this.slotViews.forEach((view) => view.setHead()) }
  setOffline(): void { this.offlineLabel?.setText('● OFFLINE · 成績不會被記錄').setColor(colorHex('danger')) }

  confirmExit(onExit: () => void, title = 'RETURN TO GRID? · 返回選角？', note = '只解除目前玩家的鎖定'): void {
    if (this.exitPanel) return
    this.onExit = onExit; this.exitChoice = 0
    this.timers.forEach((timer) => { timer.paused = true })
    if (this.nameInput) this.nameInput.setVisible(false)
    this.media?.setVisible(false)
    const panel = this.scene.add.container(960, 540)
    panel.add(this.scene.add.rectangle(0, 0, 1920, 1080, colors.background0, 0.85).setInteractive())
    panel.add(new AngularPanel(this.scene, 760, 340, colors.panelRaised))
    panel.add(label(this.scene, 0, -100, title, 'textPrimary', type.title).setOrigin(0.5))
    panel.add(label(this.scene, 0, -42, note, 'textSecondary', type.body).setOrigin(0.5))
    this.exitButtons = ['CANCEL', 'CONFIRM'].map((text, i) => {
      const button = new ActionButton(this.scene, text, 300, 80, i ? colors.playerPrimary : colors.panel).setPosition(i ? 170 : -170, 80)
      button.on('pointerup', () => this.closeExit(i === 1)); panel.add(button); return button
    })
    this.exitButtons[0].setFocused(true); this.root.add(panel); this.exitPanel = panel
  }

  handleExit(actions: UIAction[]): void {
    for (const action of actions) {
      if (!this.exitPanel) break
      if (action === 'BACK') this.closeExit(false)
      else if (action === 'CONFIRM') this.closeExit(this.exitChoice === 1)
      else if (action.startsWith('NAV_')) { this.exitChoice = 1 - this.exitChoice; this.exitButtons.forEach((button, i) => button.setFocused(i === this.exitChoice)) }
    }
  }

  private closeExit(confirm: boolean): void {
    this.exitPanel?.destroy(true); this.exitPanel = undefined; this.exitButtons = []
    this.timers.forEach((timer) => { timer.paused = false }); this.nameInput?.setVisible(true); this.media?.setVisible(true)
    if (confirm) this.onExit?.()
  }

  constructor(private readonly scene: Phaser.Scene, private readonly root: Phaser.GameObjects.Container, private readonly model: P1SelectionModel, private readonly hooks: P1ViewHooks) {
    const customizing = Boolean(model.owner)
    this.header(customizing)
    ;(['P1', 'P2'] as const).forEach((owner) => { this.heroes[owner] = new HeroPreview(scene, owner, !customizing); root.add(this.heroes[owner]) })
    if (customizing) this.buildChamber(); else this.buildGrid()
    this.sync()
    if (!reducedMotion && model.phase === 'GRID') {
      ;(['P1', 'P2'] as const).forEach((owner) => {
        const panel = new AngularPanel(scene, 1050, 1200, identity[owner].main, 0.8, { slant: 140 }).setPosition(owner === 'P1' ? 480 : 1440, 540)
        root.add(panel); this.tweens.push(scene.tweens.add({ targets: panel, x: owner === 'P1' ? -600 : 2520, alpha: 0, duration: 300, onComplete: () => panel.destroy() }))
      })
    }
    if (!reducedMotion && model.phase === 'REVIEW') {
      const shutter = scene.add.rectangle(VIEWFINDER.x, VIEWFINDER.y, VIEWFINDER.width, VIEWFINDER.height, colors.textPrimary); root.add(shutter)
      this.tweens.push(scene.tweens.add({ targets: shutter, alpha: 0, duration: 80, onComplete: () => shutter.destroy() }))
    }
  }

  sync(): void {
    const { model } = this
    const customizing = Boolean(model.owner)
    ;(['P1', 'P2'] as const).forEach((owner) => {
      const player = model.player(owner), hero = model.heroSlot(owner)
      const rival = owner === 'P2' ? model.rival : undefined
      const stamp = rival ? 'CPU' : model.owner === owner ? undefined : model.isReady(owner) ? 'READY' : player.locked !== undefined ? 'LOCKED' : undefined
      this.heroes[owner].show(hero, stamp, model.isBody(owner) ? player.nickname.trim() : '', customizing && owner !== model.owner)
      const plate = this.plates[owner]
      if (plate) {
        const status = model.status(owner)
        const difficulty = rival ? AI_DIFFICULTY_LABELS[rival.difficulty] : ''
        const statusText = status === 'JOIN' ? `${identity.P2.confirm} 加入` : status === 'WAITING' ? 'READY · WAITING' : status === 'OPPONENT' ? 'SELECT OPPONENT' : status === 'DIFFICULTY' ? `${difficulty} · ${difficultyKeys()} 難度` : status === 'CPU_READY' ? `CPU READY · ${difficulty}` : status
        plate.status.setText(statusText).setColor(colorHex(status === 'READY' || status === 'WAITING' || status === 'CPU_READY' ? 'statusLime' : status === 'CUSTOMIZE' || status === 'DIFFICULTY' ? 'resultGold' : status === 'OPPONENT' ? 'enemyGlow' : 'textSecondary'))
        plate.detail.setText(hero ? `${pad(hero.index)} · ${hero.entry?.displayName ?? 'EMPTY'} · ${slotKind(hero)}` : `${identity.P2.confirm} 加入 · 2P 真人對戰`)
      }
      const cursor = this.cursors[owner]
      if (cursor) {
        cursor.setVisible(player.joined || Boolean(rival)); cursor.tag.setText(rival ? 'CPU' : identity[owner].tag)
        const other = model.player(owner === 'P1' ? 'P2' : 'P1')
        if (rival) cursor.place(rival.cursor, model.phase !== 'OPPONENT', false)
        else if (player.joined) cursor.place(player.locked ?? player.cursor, player.locked !== undefined, other.joined && (other.locked ?? other.cursor) === (player.locked ?? player.cursor))
      }
      this.slotViews.forEach((view) => { view.setReady(owner, player.joined && player.locked === view.slot.index && model.isReady(owner)); view.syncStatus() })
    })
    if (model.phase !== 'GRID' && model.phase !== 'OPPONENT') this.hint?.setText('') // 拒絕提示只屬於選格階段
    const duo = model.player('P2').joined
    this.nickname?.setText(model.player('P1').nickname.trim() || model.heroSlot('P1')?.entry?.displayName || '—')
    this.opponent?.setText(duo ? model.player('P2').nickname.trim() || model.heroSlot('P2')?.entry?.displayName || '—' : model.heroSlot('P2')?.entry?.displayName || 'CPU')
    const commands = (owner: PlayerSlotId): string => {
      const player = model.player(owner), id = identity[owner]
      if (owner === 'P1' && model.phase === 'OPPONENT') return `1P  ${id.keys} 選對手 · ${id.confirm} 確認 · ${id.back} 返回`
      if (owner === 'P1' && (model.phase === 'DIFFICULTY' || (model.rival && model.phase === 'ALL_READY'))) return `1P  ${difficultyKeys()} 難度 · ${id.confirm} 確認 · ${id.back} 返回`
      return !player.joined ? `2P  ${id.confirm} 加入` : player.locked !== undefined ? `${id.tag}  ${id.back} 解除鎖定` : `${id.tag}  ${id.keys} 移動 · ${id.confirm} 確認${owner === 'P2' ? ` · ${id.back} 退出` : ''}`
    }
    this.keysP1?.setText(commands('P1'))
    this.stepLabel?.setText(model.phase === 'NAME' ? '02 / 05 · 輸入暱稱' : customizing ? '03 / 05 · 拍照' : `01 / ${model.slots.some(slot => slot.type === 'BODY_TEMPLATE' && (model.player('P1').locked === slot.index || model.player('P2').locked === slot.index)) ? '05' : '03'} · 選擇角色`)
    this.modeText?.setText(duo ? '1P VS 2P · 雙人對戰' : '1P VS CPU · 單人挑戰')
    this.keysP2?.setText(commands('P2'))
    if (model.phase === 'ALL_READY' && !this.banner) this.showBanner()
    if (model.phase !== 'ALL_READY' && this.banner) { this.bannerTimer?.remove(); this.bannerTween?.stop(); this.banner.destroy(); this.banner = undefined }
  }

  feedback(owner: PlayerSlotId, feedback: SelectFeedback): void {
    if (feedback === 'FACE_GENERATION_USED') { this.nameHint?.setText(FACE_USED_HINT).setVisible(true) }
    if (feedback === 'REJECTED') {
      const rival = owner === 'P1' ? this.model.rival : undefined // 單人選對手時被拒絕的是對手游標
      this.cursors[rival ? 'P2' : owner]?.shake()
      const slot = this.model.heroSlot(rival ? 'P2' : owner)
      if (!this.hint) { this.hint = label(this.scene, 960, 444, '', 'resultGold', type.body).setOrigin(0.5); this.root.add(this.hint) }
      this.hint.setText(rival && slot?.index === this.model.player('P1').locked ? 'YOURSELF · 不可選擇自己' : slot?.type === 'EMPTY' ? 'EMPTY SLOT · 空位不可選取' : slot?.status === 'PROCESSING' ? 'PROCESSING · 處理中' : 'UNAVAILABLE · 暫不可用')
    }
    if (feedback === 'JOIN_HINT' && !reducedMotion) this.tweens.push(this.scene.tweens.add({ targets: this.heroes.P2, alpha: 0.55, duration: 90, yoyo: true }))
    if (feedback === 'NAME_REQUIRED') { this.nameHint?.setText(NAME_REQUIRED_HINT).setColor(colorHex('danger')).setVisible(true); (this.nameInput?.node as HTMLInputElement | undefined)?.focus() }
    if (feedback === 'NAME_TAKEN') { this.nameHint?.setText(NAME_TAKEN_HINT).setColor(colorHex('danger')).setVisible(true); (this.nameInput?.node as HTMLInputElement | undefined)?.focus() }
  }

  cameraUnavailable(): void { this.nameHint?.setText('CAMERA UNAVAILABLE · 請允許相機或跳過拍照').setVisible(true) }

  destroy(): void {
    stopOwnedTweens(this.tweens); this.timers.splice(0).forEach((timer) => timer.remove()); this.bannerTimer?.remove(); this.bannerTween?.stop()
    this.nameInput?.destroy(); this.nameInput = undefined
    this.stream?.getTracks().forEach((track) => track.stop()); this.stream = undefined; this.cameraVideo = undefined; this.media?.destroy(); this.media = undefined
  }

  /** Capture 按下確認時以相機原生解析度擷取 webcam 畫面（換頭需要臉部細節）；照片只存在 model 記憶體。 */
  captureOnConfirm(owner: PlayerSlotId, action: OwnedUiAction): void {
    const video = this.cameraVideo
    if (this.model.phase !== 'CUSTOMIZE' || owner !== this.model.owner || action !== 'CONFIRM' || !this.model.nicknameValid(owner) || !(video instanceof HTMLVideoElement) || !video.videoWidth) return
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight
    const context = canvas.getContext('2d'); if (!context) return
    context.translate(canvas.width, 0); context.scale(-1, 1) // 與鏡像預覽一致
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const photo = canvas.toDataURL('image/jpeg', 0.85)
    this.model.setPhoto(owner, photo)
    // ponytail: 亮度標準差 < 40 視為「沒拍到人」（實測：鏡頭被遮的灰畫面 33、有人臉 52–83），只提醒不擋；誤報多再改用人臉偵測。
    const probe = Object.assign(document.createElement('canvas'), { width: 160, height: 90 }).getContext('2d', { willReadFrequently: true })
    if (!probe) return
    probe.drawImage(canvas, 0, 0, 160, 90)
    const pixels = probe.getImageData(0, 0, 160, 90).data, count = pixels.length / 4
    let sum = 0, squares = 0
    for (let i = 0; i < pixels.length; i += 4) { const light = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3; sum += light; squares += light * light }
    blankPhoto = Math.sqrt(squares / count - (sum / count) ** 2) < 40 ? photo : undefined
  }

  /** UX v03 UC03-1：四角 L 型對位標記，只框臉；放在 DOM 取景框內才不會被影像蓋住。 */
  private faceCorners(owner: PlayerSlotId): HTMLElement[] {
    const color = colorHex(identity[owner].text), box = { width: 300, height: 360 }, arm = 48
    return [[0, 0], [1, 0], [0, 1], [1, 1]].map(([right, bottom]) => {
      const corner = document.createElement('div')
      corner.style.cssText = `position:absolute;width:${arm}px;height:${arm}px;box-sizing:border-box;left:${(VIEWFINDER.width - box.width) / 2 + right * (box.width - arm)}px;top:${(VIEWFINDER.height - box.height) / 2 + bottom * (box.height - arm)}px;border:0 solid ${color};border-${bottom ? 'bottom' : 'top'}-width:6px;border-${right ? 'right' : 'left'}-width:6px`
      return corner
    })
  }

  private startCamera(owner: PlayerSlotId, note: Phaser.GameObjects.Text, band: Phaser.GameObjects.Text): void {
    const wrapper = document.createElement('div')
    wrapper.style.cssText = `position:relative;width:${VIEWFINDER.width}px;height:${VIEWFINDER.height}px;overflow:hidden;background:#000;display:none`
    const video = document.createElement('video')
    video.muted = true; video.playsInline = true; video.autoplay = true; video.setAttribute('aria-label', 'Camera preview')
    video.style.cssText = `width:${VIEWFINDER.width}px;height:${VIEWFINDER.height}px;object-fit:cover;transform:scaleX(-1);background:#000;display:block`
    wrapper.append(video, ...this.faceCorners(owner))
    const media = this.scene.add.dom(VIEWFINDER.x, VIEWFINDER.y, wrapper)
    this.media = media; this.cameraVideo = video
    const fail = (): void => { if (note.active) note.setText('CAMERA UNAVAILABLE · 相機無法使用，請允許相機或跳過').setColor(colorHex('resultGold')) }
    if (!navigator.mediaDevices?.getUserMedia) { fail(); return }
    navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false }).then((stream) => {
      if (this.media !== media || this.cameraVideo !== video) { stream.getTracks().forEach((track) => track.stop()); return } // 授權回來前已離開 Capture
      this.stream = stream; video.srcObject = stream; wrapper.style.display = 'block'; note.setVisible(false)
      band.setText('CAMERA · 確認照片後上傳並生成角色')
    }, fail)
  }

  private header(customizing: boolean): void {
    const { scene, root } = this
    if (!customizing) {
      root.add(scene.add.text(70, 44, 'CHARACTER SELECT', { ...hudDisplay, fontSize: 28 }))
      const headline = { ...hudDisplay, fontSize: 64 }
      const choose = scene.add.text(0, 27, 'CHOOSE YOUR ', headline)
      const fighter = scene.add.text(0, 27, 'FIGHTER', { ...headline, color: colorHex('playerGlow') })
      choose.setX(960 - (choose.width + fighter.width) / 2)
      root.add([choose, fighter.setX(choose.x + choose.width)])
      root.add(label(scene, 960, 98, '選擇你的角色', 'textPrimary', 24).setOrigin(0.5, 0))
      this.stepLabel = label(scene, 70, 76, '', 'textSecondary', 17); root.add(this.stepLabel)
      this.offlineLabel = label(scene, 1849, 82, this.hooks.offline ? '● OFFLINE · 成績不會被記錄' : '● ONLINE', this.hooks.offline ? 'danger' : 'statusLime', 16).setOrigin(1, 0)
      root.add(this.offlineLabel)
      return
    }
    root.add(scene.add.text(96, 96, customizing ? 'CUSTOMIZE YOUR FIGHTER' : 'CHARACTER SELECT', typography.heading).setOrigin(0, 0.5))
    this.stepLabel = label(scene, customizing ? 940 : 740, 110, '', 'textPrimary', type.body).setOrigin(0, 0.5); root.add(this.stepLabel)
    this.offlineLabel = label(scene, 1824, 90, this.hooks.offline ? '● OFFLINE · 成績不會被記錄' : '● ONLINE', this.hooks.offline ? 'danger' : 'statusLime').setOrigin(1, 0.5)
    root.add(this.offlineLabel)
  }

  private buildGrid(): void {
    const { scene, root, model } = this
    const titles = selectSectionTitles(model.slots)
    for (const group of ['body', 'saga', 'guest', 'roster'] as const) {
      const { x, y, w, h } = layout.selectPanels[group]
      const tag = new AngularPanel(scene, w, h, groupColors[group], 0.96, { slant: 9 }).setPosition(x + w / 2, y + h / 2)
      tag.shape.setStrokeStyle(0)
      tag.add(scene.add.text(0, 0, titles[group], { ...hudLabel, fontSize: 16, color: colorHex(group === 'roster' ? 'textPrimary' : 'background0') }).setOrigin(0.5))
      root.add(tag)
    }
    for (const key of Object.keys(layout.select) as (keyof typeof layout.select)[]) {
      if (key.startsWith('decoration-')) root.add(selectImage(scene, key))
    }
    model.slots.forEach((slot) => {
      const view = new GridSlotView(scene, slot)
      view.on('pointerover', () => this.hooks.onFocus('P1', slot.index)).on('pointerup', (pointer: Phaser.Input.Pointer) => { this.hooks.onFocus('P1', slot.index); if (pointer.button === 2) this.hooks.onDelete?.(slot.index); else this.hooks.onInput('P1', 'CONFIRM') })
      this.slotViews.push(view); root.add(view)
    })
    ;(['P1', 'P2'] as const).forEach((owner) => { const cursor = new PlayerCursor(scene, owner); this.cursors[owner] = cursor; root.add(cursor) })
    ;(['P1', 'P2'] as const).forEach((owner) => this.plate(owner))
    this.nickname = this.smallPlate('nickname', '1P NICKNAME', 'playerGlow')
    this.opponent = this.smallPlate('rival', 'OPPONENT', 'enemyGlow')
    this.modeText = label(scene, 1849, 47, '', 'textPrimary', 23).setOrigin(1, 0); root.add(this.modeText)
    root.add([hintBar(scene, 1048, 35), label(scene, 960, 1048, `${keyLabel(SYSTEM_BACK_KEY)} 返回標題 · 右鍵／${padLabel(PAD_SYSTEM.DELETE)} 刪除生成角色`, 'textSecondary', 17).setOrigin(0.5)])
    this.keysP1 = label(scene, 65, 1048, '', 'playerGlow', 17).setOrigin(0, 0.5); root.add(this.keysP1)
    this.keysP2 = label(scene, 1854, 1048, '', 'enemyGlow', 17).setOrigin(1, 0.5); root.add(this.keysP2)
  }

  private plate(owner: PlayerSlotId): void {
    const { scene, root } = this, id = identity[owner], left = owner === 'P1'
    const { x, y, w, h } = layout.selectPanels[left ? 'panel-p1' : 'panel-p2']
    const plate = scene.add.container(x + w / 2, y + h / 2)
    const cut = 33, edge = w / 2, top = -h / 2
    const points = [-edge, top, edge, top, edge - cut, -top, -edge, -top]
    const shape = scene.add.polygon(0, 0, left ? points : points.map((v, i) => i % 2 ? v : -v), colors.background0, 0.85).setOrigin(0).setStrokeStyle(1, colors.lineDim)
    plate.add([shape, scene.add.rectangle(left ? -edge + 3 : edge - 3, 0, 6, h, id.main)])
    plate.add(scene.add.text(left ? -248 : 248, -18, id.label, { ...hudDisplay, fontSize: 31, color: colorHex(id.text) }).setOrigin(left ? 0 : 1, 0.5))
    const status = label(scene, left ? 222 : -222, -20, '', 'textSecondary', 17).setOrigin(left ? 1 : 0, 0.5)
    const detail = label(scene, left ? -248 : 248, 21, '', 'textPrimary', 19).setOrigin(left ? 0 : 1, 0.5)
    plate.add([status, detail]); root.add(plate)
    this.plates[owner] = { status, detail }
  }

  private smallPlate(key: 'nickname' | 'rival', title: string, color: UiColorToken): Phaser.GameObjects.Text {
    const { scene, root } = this, { x, y, w, h } = layout.selectPanels[key]
    root.add(scene.add.rectangle(x, y + 25, w, h - 25, colors.background0, 0.77).setOrigin(0).setStrokeStyle(1, colors[color], 0.6))
    root.add(label(scene, key === 'nickname' ? x : x + w, y - 4, title, color, 16).setOrigin(key === 'nickname' ? 0 : 1))
    const value = label(scene, x + 16, y + 37, '', 'textPrimary', 21)
    root.add(value)
    return value
  }

  private showBanner(): void {
    const panel = new AngularPanel(this.scene, 1100, 130, colors.resultGold, 0.96).setPosition(960, 720)
    panel.add(this.scene.add.text(0, 0, 'ALL READY · 全員就緒', { ...typography.announcer, fontSize: type.h1, color: colorHex('background0'), strokeThickness: 0 }).setOrigin(0.5))
    this.banner = panel; this.root.add(panel)
    if (!reducedMotion) { panel.setScale(0.6, 1).setAlpha(0); this.tweens.push(this.scene.tweens.add({ targets: panel, scaleX: 1, alpha: 1, duration: uiTokens.motionMs.enter, ease: 'Cubic.Out' })) }
    this.bannerTimer = this.scene.time.delayedCall(p1.allReadyMs, () => {
      if (reducedMotion) { this.hooks.onAllReady(); return }
      this.bannerTween = this.scene.tweens.add({ targets: panel, scaleX: 2.5, scaleY: 12, angle: -8, duration: 240, onComplete: () => this.hooks.onAllReady() })
    })
  }

  private buildChamber(): void {
    const { scene, root, model } = this
    const owner = model.owner as PlayerSlotId, id = identity[owner], player = model.player(owner), slot = model.heroSlot(owner) as Slot
    // NEXT UP 佇列條
    const queue = new AngularPanel(scene, 640, 64, colors.panelRaised, 0.9).setPosition(960, 210)
    queue.add(label(scene, -290, 0, 'NEXT UP', 'resultGold', type.body).setOrigin(0, 0.5))
    ;(['P1', 'P2'] as const).filter((p) => model.player(p).joined).forEach((p, i) => {
      const state = p === owner ? 'NOW' : model.isReady(p) ? 'READY' : 'NEXT'
      queue.add(label(scene, -100 + i * 220, 0, `${identity[p].tag} · ${state}`, p === owner ? identity[p].text : state === 'READY' ? 'statusLime' : 'textSecondary', type.body).setOrigin(0, 0.5))
    })
    root.add(queue)
    const chamber = new AngularPanel(scene, 860, 720, colors.panel, 0.92, { slant: 18 }).setPosition(960, 640)
    chamber.shape.setStrokeStyle(2, colors.systemBlue, 0.7); root.add(chamber)
    root.add(label(scene, 960, 300, `${id.label} · ${slot.entry?.displayName ?? ''}`, id.text, type.title).setOrigin(0.5))
    const framed = model.phase === 'CUSTOMIZE' || model.phase === 'REVIEW', viewfinder = framed ? VIEWFINDER : { x: 960, y: 640, width: 640, height: 340 }
    if (model.phase !== 'NAME') {
      root.add(scene.add.rectangle(viewfinder.x, viewfinder.y, viewfinder.width, viewfinder.height, colors.background0, 0.92).setStrokeStyle(2, colors.systemBlue, 0.9))
      if (!framed) {
        const lines = scene.add.graphics().lineStyle(1, colors.lineDim, 0.6)
        for (let i = 1; i < 3; i += 1) { lines.lineBetween(640 + i * 640 / 3, 470, 640 + i * 640 / 3, 810); lines.lineBetween(640, 470 + i * 340 / 3, 1280, 470 + i * 340 / 3) }
        root.add(lines)
      }
    }
    const button = (text: string, subtitle: string, x: number, color: number, action: OwnedUiAction, width = 320): ActionButton => {
      const b = new ActionButton(scene, text, width, 84, color, subtitle).setPosition(x, 940)
      b.on('pointerup', () => this.hooks.onInput(owner, action)); root.add(b); return b
    }
    if (model.phase === 'NAME') {
      // 第 1 頁：只輸入暱稱（UX v03 UC02-4）；鍵盤直接打字，手把用螢幕鍵盤。1P 完成才輪到 2P。
      root.add(label(scene, 660, 352, 'PLAYER NAME · 玩家名稱', 'textSecondary').setOrigin(0, 0.5))
      this.nameCount = label(scene, 1260, 352, '', 'textSecondary').setOrigin(1, 0.5); root.add(this.nameCount)
      this.nameInput = this.createNameInput(owner, player.nickname)
      this.nameHint = label(scene, 960, 446, NAME_REQUIRED_HINT, 'danger').setOrigin(0.5); root.add(this.nameHint)
      this.buildNameKeyboard(owner)
      button('BACK', `${id.back} · 返回選角`, 790, colors.panelRaised, 'BACK')
      this.primary = button('NEXT', `${id.confirm} / ENTER · 下一步拍照`, 1130, id.main, 'CONFIRM')
      this.refreshName(owner)
    } else if (model.phase === 'CUSTOMIZE') {
      // 第 2 頁：只拍照（UX v03 UC03-1）；無倒數，預設焦點在【拍照】。
      const band = new AngularPanel(scene, VIEWFINDER.width, 36, colors.resultGold, 1, { slant: 10 }).setPosition(VIEWFINDER.x, VIEWFINDER.y - VIEWFINDER.height / 2 + 18)
      const bandText = label(scene, 0, 0, 'PROTOTYPE / CAMERA NOT CONNECTED · 原型 · 相機未連接', 'background0').setOrigin(0.5)
      band.add(bandText); root.add(band)
      const cameraNote = label(scene, VIEWFINDER.x, VIEWFINDER.y, 'CAMERA CONNECTING · 相機連線中（請允許使用相機）', 'systemBlue', type.body).setOrigin(0.5)
      root.add(cameraNote); this.startCamera(owner, cameraNote, bandText)
      root.add(label(scene, 960, 840, 'ALIGN YOUR FACE · 把臉對準框裡，正面直視鏡頭', 'textPrimary', type.body).setOrigin(0.5))
      const pad = loadPadProfiles()[owner]
      button('BACK', `${id.back} / ${padLabel(PAD_SYSTEM.BACK)} · 返回上一頁`, 660, colors.panelRaised, 'BACK', 260)
      this.primary = button('TAKE PHOTO', `${id.confirm} / ENTER / ${padLabel(pad.LIGHT_KICK)} ${padLabel(pad.LIGHT_PUNCH)} · 拍照`, 1260, id.main, 'CONFIRM', 260).setEnabled(!player.faceGenUsed)
      const skip = new ActionButton(scene, 'SKIP PHOTO', 260, 84, colors.panelRaised, `${keyLabel(loadProfiles()[owner].LIGHT_KICK)} / ${padLabel(pad.HEAVY_KICK)} · 跳過拍照`).setPosition(960, 940)
      skip.on('pointerup', () => this.hooks.onSkip?.()); root.add(skip)
      this.nameHint = label(scene, 960, 876, player.faceGenUsed ? FACE_USED_HINT : '', 'textSecondary').setOrigin(0.5).setVisible(Boolean(player.faceGenUsed)); root.add(this.nameHint)
    } else if (model.phase === 'REVIEW') {
      if (player.photo) {
        const image = document.createElement('img'); image.src = player.photo; image.alt = 'Captured photo'
        image.style.cssText = `width:${VIEWFINDER.width}px;height:${VIEWFINDER.height}px;object-fit:contain;background:#000`
        this.media = scene.add.dom(VIEWFINDER.x, VIEWFINDER.y, image)
        root.add(player.photo === blankPhoto ? label(scene, 960, 350, 'NO FACE? · 畫面幾乎沒有細節，可能沒拍到人或鏡頭被遮住，建議重拍', 'resultGold').setOrigin(0.5) : label(scene, 960, 350, 'PHOTO · 確認後將上傳生成角色', 'statusLime').setOrigin(0.5))
      } else {
        root.add(label(scene, 960, 790, 'MOCK PHOTO · 模擬照片', 'textSecondary').setOrigin(0.5))
      }
      root.add(label(scene, 960, 330, player.nickname.trim(), 'textPrimary', type.body).setOrigin(0.5))
      root.add(scene.add.text(960, 868, 'USE THIS PHOTO? · 使用這張照片？', typography.secondaryAction).setOrigin(0.5))
      button('RETAKE', `${id.back} · 重拍`, 790, colors.panelRaised, 'BACK')
      button('CONFIRM', `${id.confirm} · 確認送出`, 1130, id.main, 'CONFIRM')
    } else if (model.phase === 'FAILED') {
      root.add(label(scene, 960, 600, 'GENERATION FAILED', 'danger', type.h2).setOrigin(0.5))
      root.add(label(scene, 960, 680, '本次生成已送出，不能重試；請返回選角', 'textPrimary', type.body).setOrigin(0.5))
      button('CHOOSE ANOTHER', `${id.back} · 返回選角`, 790, colors.panelRaised, 'BACK')
      button('USED', `${id.confirm} · 已送出`, 1130, id.main, 'CONFIRM').setEnabled(false)
    } else {
      this.buildProcessing(slot, player.nickname.trim())
    }
    if (model.phase !== 'CUSTOMIZE') root.add(label(scene, 960, 1048, model.phase === 'PROCESSING' ? 'MOCK PROCESSING · 請稍候' : `${id.tag}  ${id.confirm} 確認 · ${id.back} 返回`, id.text).setOrigin(0.5))
  }

  private buildProcessing(slot: Slot, nickname: string): void {
    const { scene, root } = this
    root.add(label(scene, 960, 400, `PROCESSING CHARACTER · 角色生成中   ${slot.entry?.displayName ?? ''} · ${nickname}`, 'textPrimary', type.body).setOrigin(0.5))
    const rings = [130, 165, 200].map((radius, i) => {
      const ring = scene.add.graphics().setPosition(960, 640).lineStyle(3, colors.systemBlue, 0.35 + i * 0.15).beginPath()
      ring.arc(0, 0, radius, 0, Math.PI * 1.4).strokePath()
      if (!reducedMotion) this.tweens.push(scene.tweens.add({ targets: ring, angle: i % 2 ? -360 : 360, duration: 1800 + i * 400, repeat: -1 }))
      return ring
    })
    root.add(rings)
    root.add(this.scene.add.rectangle(960, 840, 600, 16, colors.background0).setStrokeStyle(1, colors.lineBright))
    const bar = scene.add.rectangle(660, 840, 600, 16, colors.systemBlue).setOrigin(0, 0.5).setScale(0, 1)
    const percent = scene.add.text(960, 940, '0%', typography.number).setOrigin(0.5)
    const steps = ['REQUESTING', 'PROCESSING', 'READY'].map((step, i) => label(scene, 760 + i * 200, 884, step, 'textSecondary').setOrigin(0.5))
    root.add([bar, percent, ...steps])
    root.add(label(scene, 960, 1004, 'MOCK PROCESSING · 模擬處理 · 未連接生成服務', 'resultGold').setOrigin(0.5))
    const show = (value: number): void => { bar.setScale(value, 1); percent.setText(Math.round(value * 100) + '%'); steps.forEach((step, i) => step.setColor(colorHex(value >= [0, 0.25, 1][i] ? (i === 2 ? 'statusLime' : 'systemBlue') : 'textSecondary'))) }
    show(0)
    if (!reducedMotion) this.tweens.push(scene.tweens.addCounter({ from: 0, to: 1, duration: p1.processingMs, onUpdate: (tween) => show(tween.getValue() ?? 0) }))
    if (this.hooks.onProcessingDone) this.timers.push(scene.time.delayedCall(p1.processingMs, () => { show(1); this.hooks.onProcessingDone?.() }))
  }

  private createNameInput(owner: PlayerSlotId, value: string): Phaser.GameObjects.DOMElement {
    const input = document.createElement('input')
    input.maxLength = NICKNAME_MAX; input.value = value; input.placeholder = 'PLAYER NAME'; input.autocomplete = 'off'; input.setAttribute('aria-label', 'Player name')
    input.style.cssText = `width:600px;height:56px;padding:0 16px;box-sizing:border-box;border:0;border-bottom:3px solid ${colorHex(identity[owner].text)};background:${colorHex('background1')};color:${colorHex('textPrimary')};font:24px Chivo,'Noto Sans TC',sans-serif;outline:none`
    // 打字期間不讓按鍵進入遊戲輸入（WASD/J/K/Backspace 都是文字）；Enter 完成輸入並進拍照頁，Esc 只離開輸入框。
    input.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.isComposing || (event.key !== 'Enter' && event.key !== 'Escape')) return
      event.preventDefault(); input.blur()
      if (event.key === 'Enter') this.hooks.onInput(owner, 'CONFIRM')
    })
    input.addEventListener('input', () => { this.hooks.onNickname(owner, input.value); this.refreshName(owner) })
    const element = this.scene.add.dom(960, 392, input)
    // 一進頁面就能直接打字；輪到 2P 時同樣重建、同樣取得焦點。
    this.scene.time.delayedCall(0, () => { if (input.isConnected) input.focus() })
    return element
  }

  /** 手把在暱稱頁：方向選字、確認輸入。選到 OK 或不在暱稱頁時回傳 false，讓確認照常進下一頁。 */
  nameKey(owner: PlayerSlotId, action: OwnedUiAction): boolean {
    const keyboard = this.nameKeyboard
    if (!keyboard || this.model.phase !== 'NAME' || owner !== this.model.owner) return false
    if (keyboard.move(action)) { this.paintKeys(); return true }
    const name = action === 'CONFIRM' ? keyboard.type(this.model.player(owner).nickname, NICKNAME_MAX) : undefined
    if (name === undefined) return false
    const input = this.nameInput?.node as HTMLInputElement | undefined
    if (input) input.value = name
    this.hooks.onNickname(owner, name); this.refreshName(owner)
    return true
  }

  private buildNameKeyboard(owner: PlayerSlotId): void {
    const { scene, root } = this, keyboard = this.nameKeyboard = new NameKeyboard()
    root.add(label(scene, 960, 486, 'STICK KEYBOARD · 搖桿選字 ✕ 輸入 · 選 OK 下一步', 'textSecondary').setOrigin(0.5))
    this.keyCells = NAME_KEYS.map((keys, r) => keys.map((key, c) => {
      const width = keys.length === 3 ? 200 : 56, x = 960 - 310 + c * (width + 6) + width / 2, y = 536 + r * 58
      const cell = scene.add.rectangle(x, y, width, 50, colors.background1).setStrokeStyle(2, colors.lineDim).setInteractive({ useHandCursor: true })
      cell.on('pointerup', () => { keyboard.row = r; keyboard.col = c; this.paintKeys(); if (!this.nameKey(owner, 'CONFIRM')) this.hooks.onInput(owner, 'CONFIRM') })
      root.add([cell, label(scene, x, y, key, 'textPrimary', type.body).setOrigin(0.5)])
      return cell
    }))
    this.paintKeys()
  }

  private paintKeys(): void {
    const keyboard = this.nameKeyboard
    this.keyCells.forEach((row, r) => row.forEach((cell, c) => {
      const on = keyboard?.row === r && keyboard.col === c
      cell.setFillStyle(on ? colors.systemBlue : colors.background1).setStrokeStyle(2, on ? colors.lineBright : colors.lineDim)
    }))
  }

  private refreshName(owner: PlayerSlotId): void {
    const valid = this.model.nicknameValid(owner)
    this.nameCount?.setText(`${this.model.player(owner).nickname.length}/${NICKNAME_MAX}`)
    this.primary?.setEnabled(valid)
    if (valid) this.nameHint?.setVisible(false)
    else this.nameHint?.setText(NAME_REQUIRED_HINT).setColor(colorHex('danger')).setVisible(true)
  }
}
