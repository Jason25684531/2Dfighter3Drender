import Phaser from 'phaser'
import type { CombatEvent, CombatWorld, FighterId } from '../../combat/CombatWorld'
import type { MatchSnapshot, RoundSummary, Announce } from '../../match/MatchController'
import type { GameAudio } from '../../audio/GameAudio'
import { announceCue, combatCues } from '../../audio/AudioCues'
import type { InputManager } from '../../input/InputManager'
import { keyLabel } from '../../input/ControlProfile'
import { TemporarySpriteRenderer } from '../animation/TemporarySpriteRenderer'
import { createSpriteHitTest, drawContactRange, stancePushWidth } from '../animation/SpriteHitTest'
import { outcomeFor, presentationSheetFor, resolvePresentation, spriteActionFor, type PresentationContext, type SpriteId } from '../animation/TemporarySpriteManifest'
import { isSheetSprite, sheetAnimations, sheetUrl } from '../animation/SheetSpriteManifest'
import { impactFlip, playImpactFx } from '../vfx/ImpactFx'
import { FX_BODY, loadSignatureFx, playFx, signatureFx, type SignatureFx } from '../vfx/OverdriveFx'
import { ATTACK_ACTIONS } from '../../input/ControlProfile'
import { Announcer } from '../VisualComponents'
import { BattleHud } from './BattleHud'
import { HIT_TUNING, lungeFor, powerFor, reachFor } from '../../config/hitTuning'
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
  private stanceKeys?: string
  private worldTick = 0
  /** 正在播的招式特效（Jeansen 的踢＝ROG OVERDRIVE、重拳＝爆炸，見 OverdriveFx 的 JEANSEN_FX）。 */
  private signature: Partial<Record<FighterId, { attackId: number; fx: SignatureFx; charge?: Phaser.GameObjects.Sprite; burst?: true }>> = {}

  constructor(private readonly scene: Phaser.Scene, root: Phaser.GameObjects.Container, private readonly world: Phaser.GameObjects.Container, private readonly options: BattleViewOptions) {
    const { playerSprite, enemySprite, floorY } = options
    this.player = new TemporarySpriteRenderer(scene, playerSprite, floorY)
    this.enemy = new TemporarySpriteRenderer(scene, enemySprite, floorY)
    world.add([this.enemy, this.player])
    // 命中依出招輪廓及招式外推距離，推擠依站姿輪廓；destroy() 解除。
    options.combat?.setHitTest(createSpriteHitTest(scene, { PLAYER: this.player, ENEMY: this.enemy }, (id) => this.contexts[id], () => options.combat?.contactWidth))
    this.syncLunges()
    this.syncStance(0)
    if ([playerSprite, enemySprite].some((sprite) => ATTACK_ACTIONS.some((attack) => signatureFx(sprite, attack)))) loadSignatureFx(scene)
    this.hud = new BattleHud(scene, { sprite: playerSprite, name: options.playerName }, { sprite: enemySprite, name: options.enemyName })
    root.add(this.hud)
    // 連擊標語顯示在連擊者所在的那一側（站在對手左邊 → 左側），色塊用陣營色。
    this.combos = { PLAYER: new ComboTag(scene, uiTokens.colors.playerPrimary), ENEMY: new ComboTag(scene, uiTokens.colors.enemyPrimary) }
    this.danger = scene.add.text(1550, 240, '', typography.danger).setOrigin(1, 0.5)
    this.lastTen = scene.add.text(1130, 240, '', { ...typography.note, color: colorHex('danger') }).setOrigin(0, 0.5)
    this.firstAttack = scene.add.text(710, 240, 'FIRST ATTACK!', { ...typography.note, color: colorHex('statusLime') }).setOrigin(0.5).setVisible(false)
    this.announcer = new Announcer(scene)
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('inputDebug') === '1') { this.inputDebug = scene.add.text(40, 820, '', { ...typography.note, color: colorHex('statusLime'), backgroundColor: colorHex('shadow') + 'cc', padding: { x: 12, y: 8 } }); root.add(this.inputDebug) }
    // DEV ?hitbox：攻擊輪廓（紅）、防守輪廓與外推範圍（藍）、實際接觸點（黃）。
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
      const started = event.type === 'ATTACK_STARTED' ? signatureFx(this.fighter(event.attacker).spriteId, event.attack) : undefined
      if (event.type === 'ATTACK_STARTED' && started) {
        const fighter = snapshot.world.fighters[event.attacker], left = fighter.facing === 'LEFT', at = this.strikePoint(event.attacker, started, fighter.x, fighter.y, left)
        this.signature[event.attacker] = { attackId: event.attackId, fx: started, charge: started.size.energy_charge ? playFx(this.scene, this.world, started.pack, 'energy_charge', at.x, at.y, left, started.size.energy_charge) : undefined }
      }
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
      const signature = blocked ? undefined : signatureFx(this.fighter(event.attacker).spriteId, event.attack)
      if (signature?.size.hit_impact) playFx(this.scene, this.world, signature.pack, 'hit_impact', event.at.x, event.at.y, facing === 'LEFT', signature.size.hit_impact)
    })
    this.syncSignature(snapshot)
    shakeOnKnockdown(this.scene, events)
    const outcome = (id: FighterId) => outcomeFor(id, snapshot.matchState, round?.winner)
    const animationTick = this.animationTick++
    this.player.update(vm.player, animationTick, { ...context, outcome: outcome('PLAYER') }); this.enemy.update(vm.enemy, animationTick, { ...enemyContext, outcome: outcome('ENEMY') })
    this.syncStance(tick)
    if (this.boxes) {
      this.boxes.clear()
      for (const id of ['PLAYER', 'ENEMY'] as const) {
        const { [id]: fighter, [id === 'PLAYER' ? 'ENEMY' : 'PLAYER']: opponent } = snapshot.world.fighters
        const active = fighter.attackPhase === 'ACTIVE'
        const edge = opponent.attackPhase === 'ACTIVE' ? HIT_TUNING.edge[opponent.attack] + reachFor(this.fighter(opponent.id).spriteId, opponent.attack) : 0
        drawContactRange(this.boxes, this.fighter(id), fighter, active ? uiTokens.colors.danger : uiTokens.colors.systemBlue, this.contexts[id], edge)
      }
      for (const event of events) if (event.type === 'HIT') this.boxes.fillStyle(uiTokens.colors.resultGold).fillCircle(event.at.x, event.at.y, 14)
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
  /** 出招點（world，腳底為 y）：身前 200，高度照該招特效表的 height，蹲下減半。 */
  private strikePoint(id: FighterId, fx: SignatureFx, x: number, y: number, left: boolean): { x: number; y: number } { return { x: x + (left ? -200 : 200), y: y - fx.height / (this.contexts[id]?.crouch ? 2 : 1) } }
  /** 起手蓄能跟著出招點走；招式進入 ACTIVE 時噴發（有設定就加衝擊波），噴發播完在光束前端消散。 */
  private syncSignature(snapshot: MatchSnapshot): void {
    for (const id of ['PLAYER', 'ENEMY'] as const) {
      const active = this.signature[id], fighter = snapshot.world.fighters[id]
      if (!active) continue
      if (fighter.attackId !== active.attackId || fighter.attackPhase === 'NONE') { delete this.signature[id]; continue }
      const { fx } = active, { pack, size } = fx, left = fighter.facing === 'LEFT', at = this.strikePoint(id, fx, fighter.x, fighter.y, left)
      if (active.charge?.active) active.charge.setPosition(at.x, at.y)
      if (active.burst || fighter.attackPhase !== 'ACTIVE') continue
      active.burst = true
      const burst = size.energy_burst ? playFx(this.scene, this.world, pack, 'energy_burst', at.x, at.y, left, size.energy_burst) : undefined
      if (size.shockwave) playFx(this.scene, this.world, pack, 'shockwave', at.x, at.y, left, size.shockwave)
      const tip = at.x + (left ? -1 : 1) * 0.8 * (size.energy_burst ?? 0) * FX_BODY
      if (size.energy_dissipation) burst?.once('animationcomplete', () => playFx(this.scene, this.world, pack, 'energy_dissipation', tip, at.y, left, size.energy_dissipation as number))
    }
  }
  setSprite(id: FighterId, sprite: SpriteId): void {
    this.fighter(id).spriteId = sprite
    this.hud.usePortrait(id === 'PLAYER' ? 'p1' : 'p2', sprite)
    this.syncLunges()
  }

  private syncLunges(): void {
    const distances = (id?: SpriteId) => Object.fromEntries(Object.entries(lungeFor(id) ?? {}).map(([attack, lunge]) => [attack, lunge.advance]))
    this.options.combat?.setLunge({ PLAYER: distances(this.player.spriteId), ENEMY: distances(this.enemy.spriteId) })
    this.options.combat?.setPower({ PLAYER: powerFor(this.player.spriteId), ENEMY: powerFor(this.enemy.spriteId) })
  }

  private syncStance(tick: number): void {
    const combat = this.options.combat
    if (!combat) return
    const player = this.player.idlePose(), enemy = this.enemy.idlePose()
    const keys = `${player?.key}:${enemy?.key}`
    if (keys !== this.stanceKeys || tick < this.worldTick) {
      this.stanceKeys = keys
      combat.setPushWidth(stancePushWidth(this.scene, player, enemy))
    }
    this.worldTick = tick
  }

  destroy(): void { this.options.combat?.setHitTest(undefined); this.options.combat?.setPushWidth(undefined); this.options.combat?.setLunge(undefined); this.options.combat?.setPower(undefined) }
}
