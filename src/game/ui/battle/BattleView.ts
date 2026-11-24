import Phaser from 'phaser'
import type { CombatEvent, CombatWorld, FighterId } from '../../combat/CombatWorld'
import type { MatchSnapshot, RoundSummary, Announce } from '../../match/MatchController'
import type { GameAudio } from '../../audio/GameAudio'
import { announceCue, combatCues } from '../../audio/AudioCues'
import type { InputManager } from '../../input/InputManager'
import { keyLabel } from '../../input/ControlProfile'
import { TemporarySpriteRenderer } from '../animation/TemporarySpriteRenderer'
import { createSpriteHitTest, stancePushWidth } from '../animation/SpriteHitTest'
import { outcomeFor, presentationSheetFor, resolvePresentation, spriteActionFor, type PresentationContext, type SpriteId } from '../animation/TemporarySpriteManifest'
import { isSheetSprite, sheetAnimations, sheetUrl } from '../animation/SheetSpriteManifest'
import { impactFlip, playImpactFx } from '../vfx/ImpactFx'
import { Announcer } from '../VisualComponents'
import { BattleHud } from './BattleHud'
import { battleAnnouncement, battleViewModel } from '../ViewModels'
import { ComboTag } from './ComboTag'
import type { StageId } from '../assets/TestAssetManifest'
import { colorHex, reducedMotion, uiTokens } from '../tokens/uiTokens'
import { typography } from '../tokens/typography'

export type BattleViewOptions = { stage: StageId; playerSprite?: SpriteId; enemySprite: SpriteId; playerName: string; enemyName: string; twoPlayer: boolean; floorY: number; maxHp: number; input: InputManager; audio?: GameAudio; combat?: CombatWorld }

export const shakeOnKnockdown = (scene: Phaser.Scene, events: CombatEvent[]): void => {
  if (!reducedMotion && events.some(event => event.type === 'KNOCKDOWN')) scene.cameras.main.shake(170, 0.005, true)
}

export class BattleView {
  readonly player: TemporarySpriteRenderer
  readonly enemy: TemporarySpriteRenderer
  private readonly hud: BattleHud
  private readonly combos: Record<FighterId, ComboTag>
  /** 頓幀期間抖動的受擊者與幅度（world）。 */
  private jitter?: { id: FighterId; amplitude: number }
  private readonly danger: Phaser.GameObjects.Text
  private readonly lastTen: Phaser.GameObjects.Text
  private readonly firstAttack: Phaser.GameObjects.Text
  private readonly announcer: Announcer
  private readonly inputDebug?: Phaser.GameObjects.Text
  private readonly boxes?: Phaser.GameObjects.Graphics
  private firstHit?: { round: number; tick: number; byPlayer: boolean }
  private previousAnnounce?: Announce
  private contexts: Partial<Record<FighterId, PresentationContext>> = {}
  /** 動畫時鐘：每次 update 加一。回合結束與開場停留時 combat tick 不前進，勝利／倒地動作仍要播。 */
  private animationTick = 0

  constructor(private readonly scene: Phaser.Scene, root: Phaser.GameObjects.Container, private readonly world: Phaser.GameObjects.Container, private readonly options: BattleViewOptions) {
    const { playerSprite, enemySprite, floorY } = options
    this.player = new TemporarySpriteRenderer(scene, playerSprite, floorY)
    this.enemy = new TemporarySpriteRenderer(scene, enemySprite, floorY)
    world.add([this.enemy, this.player])
    // 命中依出招輪廓及招式外推距離，推擠依站姿輪廓；destroy() 解除。
    options.combat?.setHitTest(createSpriteHitTest(scene, { PLAYER: this.player, ENEMY: this.enemy }, (id) => this.contexts[id], () => options.combat?.contactWidth))
    options.combat?.setPushWidth(stancePushWidth(scene, { PLAYER: this.player, ENEMY: this.enemy }, options.combat.getSnapshot().fighters))
    this.hud = new BattleHud(scene, { sprite: playerSprite, name: options.playerName }, { sprite: enemySprite, name: options.enemyName })
    root.add(this.hud)
    // 連擊標語顯示在連擊者所在的那一側（站在對手左邊 → 左側），色塊用陣營色。
    this.combos = { PLAYER: new ComboTag(scene, uiTokens.colors.playerPrimary), ENEMY: new ComboTag(scene, uiTokens.colors.enemyPrimary) }
    this.danger = scene.add.text(1550, 240, '', typography.danger).setOrigin(1, 0.5)
    this.lastTen = scene.add.text(1130, 240, '', { ...typography.note, color: colorHex('danger') }).setOrigin(0, 0.5)
    this.firstAttack = scene.add.text(710, 240, 'FIRST ATTACK!', { ...typography.note, color: colorHex('statusLime') }).setOrigin(0.5).setVisible(false)
    this.announcer = new Announcer(scene)
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('inputDebug') === '1') { this.inputDebug = scene.add.text(40, 820, '', { ...typography.note, color: colorHex('statusLime'), backgroundColor: colorHex('shadow') + 'cc', padding: { x: 12, y: 8 } }); root.add(this.inputDebug) }
    // DEV ?hitbox：畫 hurtbox（藍）與 active hitbox（紅），對照動畫調招式表。
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('hitbox')) { this.boxes = scene.add.graphics(); world.add(this.boxes) }
    root.add([this.combos.PLAYER, this.combos.ENEMY, this.danger, this.lastTen, this.firstAttack, this.announcer])
  }

  update(snapshot: MatchSnapshot, events: CombatEvent[], context: PresentationContext, round?: RoundSummary, enemyContext: PresentationContext = {}): void {
    const vm = battleViewModel(snapshot, this.options.stage, this.options.playerName, this.options.enemyName, this.options.maxHp), tick = snapshot.world.tick
    this.contexts = { PLAYER: context, ENEMY: enemyContext }
    this.options.audio?.playSequence(combatCues(events))
    const cues = announceCue(this.previousAnnounce, snapshot, round, this.options.twoPlayer, this.options.maxHp)
    this.options.audio?.playSequence(cues)
    if (cues.some(cue => cue.id === 'ann-ko' || cue.id === 'ann-times-up' || cue.id === 'ann-double-kill')) this.options.audio?.play({ id: 'amb-claps' })
    this.previousAnnounce = snapshot.announce
    events.forEach(event => {
      if (event.type !== 'HIT') return
      if (this.firstHit?.round !== vm.round) this.firstHit = { round: vm.round, tick, byPlayer: event.attacker === 'PLAYER' }
      const blocked = events.some(other => other.type === 'BLOCK' && other.attackId === event.attackId && other.attacker === event.attacker)
      // 打擊感：受擊閃白、頓幀抖動（renderAt）、重擊小震。
      if (!blocked) this.fighter(event.defender).flash()
      // 倒地那一擊只留畫面震動；受擊者本身不再左右抖，才會一路順著倒下。
      const falling = events.some(other => other.type === 'KNOCKDOWN' && other.fighter === event.defender)
      if (!reducedMotion) this.jitter = falling ? undefined : { id: event.defender, amplitude: blocked ? 4 : 8 }
      if (!blocked && event.attack.startsWith('HEAVY') && !reducedMotion) this.scene.cameras.main.shake(120, 0.003)
      const kind = blocked ? 'guard' : event.attack, facing = snapshot.world.fighters[blocked ? event.defender : event.attacker].facing
      playImpactFx(this.scene, this.world, kind, event.at.x, event.at.y, impactFlip(facing))
    })
    shakeOnKnockdown(this.scene, events)
    const outcome = (id: FighterId) => outcomeFor(id, snapshot.matchState, round?.winner)
    const animationTick = this.animationTick++
    this.player.update(vm.player, animationTick, { ...context, outcome: outcome('PLAYER') }); this.enemy.update(vm.enemy, animationTick, { ...enemyContext, outcome: outcome('ENEMY') })
    const combat = this.options.combat
    if (this.boxes && combat) {
      this.boxes.clear().lineStyle(3, uiTokens.colors.systemBlue)
      ;(['PLAYER', 'ENEMY'] as const).forEach((id) => { const box = combat.getHurtbox(id); this.boxes?.strokeRect(box.x, box.y, box.width, box.height) })
      this.boxes.lineStyle(3, uiTokens.colors.danger)
      ;(['PLAYER', 'ENEMY'] as const).forEach((id) => { const box = combat.getActiveHitbox(id); if (box) this.boxes?.strokeRect(box.x, box.y, box.width, box.height) })
    }
    if (this.inputDebug) {
      const last = this.options.input.lastCombatInput, presentation = this.player.presentation ?? resolvePresentation(vm.player, context), sprite = this.options.playerSprite
      const sheet = presentationSheetFor(sprite, presentation), file = sheetAnimations.find(animation => animation.key === sheet)?.filename ?? ''
      const animation = isSheetSprite(sprite) ? sheetUrl(sprite, sheet, file).split('/').at(-1)?.replace('.png', '') : `${sprite}-${spriteActionFor(vm.player)}`
      this.inputDebug.setText(['PLAYER 1', `Physical Key: ${last ? keyLabel(last.code) : '-'}`, `Semantic Action: ${last?.action ?? '-'}`, `Fighter Context: ${/AIR$|^JUMP$/.test(presentation) ? 'AIRBORNE' : presentation.includes('CROUCH') ? 'CROUCHING' : 'STANDING'}`, `Resolved Presentation: ${presentation}`, `Animation: ${animation}`].join('\n'))
    }
    this.hud.update(vm)
    ;(['PLAYER', 'ENEMY'] as const).forEach((id) => {
      const { [id]: self, [id === 'PLAYER' ? 'ENEMY' : 'PLAYER']: other } = snapshot.world.fighters
      this.combos[id].set(self.combo, self.x <= other.x ? 'left' : 'right')
    })
    this.danger.setText(vm.danger ? 'DANGER' : '')
    this.lastTen.setText(vm.lastTenSeconds ? '10 SECONDS!' : '')
    this.firstAttack.setVisible(Boolean(this.firstHit?.byPlayer && this.firstHit.round === vm.round && tick >= this.firstHit.tick && tick < this.firstHit.tick + 24))
    this.announcer.show(battleAnnouncement(snapshot, round))
  }
  renderAt(alpha: number): void {
    this.player.renderAt(alpha); this.enemy.renderAt(alpha)
    if (!this.jitter) return
    if (!this.options.combat?.isFrozen()) { this.jitter = undefined; return }
    // 只動畫面位置（下一幀 renderAt 會重設），不碰戰鬥座標；暫停選單開著時不抖。
    if (!this.scene.anims.paused) this.fighter(this.jitter.id).x += (Math.floor(this.scene.time.now / 30) % 2 ? 1 : -1) * this.jitter.amplitude
  }
  private fighter(id: FighterId): TemporarySpriteRenderer { return id === 'PLAYER' ? this.player : this.enemy }
  destroy(): void { this.options.combat?.setHitTest(undefined); this.options.combat?.setPushWidth(undefined) }
}
