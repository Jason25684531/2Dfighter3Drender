import Phaser from 'phaser'
import type { CombatEvent, CombatWorld, FighterId } from '../../combat/CombatWorld'
import type { MatchSnapshot, RoundSummary, Announce } from '../../match/MatchController'
import type { GameAudio } from '../../audio/GameAudio'
import { announceCue, combatCues } from '../../audio/AudioCues'
import type { InputManager } from '../../input/InputManager'
import { keyLabel } from '../../input/ControlProfile'
import { faceKey, TemporarySpriteRenderer } from '../animation/TemporarySpriteRenderer'
import { createSpriteHitTest, stancePushWidth } from '../animation/SpriteHitTest'
import { outcomeFor, presentationSheet, resolvePresentation, spriteActionFor, spriteTextureFrame, spriteTextureKey, type PresentationContext, type SpriteId } from '../animation/TemporarySpriteManifest'
import { isSheetSprite, sheetAnimations, sheetUrl } from '../animation/SheetSpriteManifest'
import { impactFlip, impactScale, playImpactFx } from '../vfx/ImpactFx'
import { AngularPanel, Announcer, HealthBar, HexTimer, RoundDiamonds } from '../VisualComponents'
import { battleAnnouncement, battleViewModel } from '../ViewModels'
import { ComboTag } from './ComboTag'
import type { StageId } from '../assets/TestAssetManifest'
import { colorHex, reducedMotion, uiTokens } from '../tokens/uiTokens'
import { typography } from '../tokens/typography'

export type BattleViewOptions = { stage: StageId; playerSprite?: SpriteId; enemySprite: SpriteId; playerName: string; enemyName: string; twoPlayer: boolean; floorY: number; maxHp: number; input: InputManager; audio?: GameAudio; combat?: CombatWorld }

export class BattleView {
  readonly player: TemporarySpriteRenderer
  readonly enemy: TemporarySpriteRenderer
  private readonly playerBar: HealthBar
  private readonly enemyBar: HealthBar
  private readonly playerRounds: RoundDiamonds
  private readonly enemyRounds: RoundDiamonds
  private readonly timer: HexTimer
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

  constructor(private readonly scene: Phaser.Scene, root: Phaser.GameObjects.Container, private readonly world: Phaser.GameObjects.Container, private readonly options: BattleViewOptions) {
    const { playerSprite, enemySprite, floorY } = options
    this.player = new TemporarySpriteRenderer(scene, playerSprite, floorY, faceKey('P1'))
    this.enemy = new TemporarySpriteRenderer(scene, enemySprite, floorY, faceKey('P2'))
    world.add([this.enemy, this.player])
    // 命中改以畫面角色輪廓（外推 HIT_EDGE，貼身必中）判定，推擠改用站姿輪廓（間隙 PUSH_EDGE）；destroy() 解除。
    options.combat?.setHitTest(createSpriteHitTest(scene, { PLAYER: this.player, ENEMY: this.enemy }, (id) => this.contexts[id], () => options.combat?.contactWidth))
    options.combat?.setPushWidth(stancePushWidth(scene, { PLAYER: this.player, ENEMY: this.enemy }, options.combat.getSnapshot().fighters))
    this.playerBar = new HealthBar(scene, 560, uiTokens.colors.playerPrimary).setPosition(230, 112)
    this.enemyBar = new HealthBar(scene, 560, uiTokens.colors.enemyPrimary, true).setPosition(1130, 112)
    this.playerRounds = new RoundDiamonds(scene).setPosition(250, 156)
    this.enemyRounds = new RoundDiamonds(scene, true).setPosition(1670, 156)
    root.add([this.playerBar, this.enemyBar, this.playerRounds, this.enemyRounds])
    ;[[150, playerSprite, uiTokens.colors.playerPrimary], [1770, enemySprite, uiTokens.colors.enemyPrimary]].forEach(([x, sprite, color]) => {
      const portrait = new AngularPanel(scene, 100, 100, Number(color)).setPosition(Number(x), 108)
      const key = sprite && spriteTextureKey(sprite as SpriteId, 'idle')
      if (key && scene.textures.exists(key)) portrait.add(scene.add.image(0, 0, key, spriteTextureFrame(sprite as SpriteId | undefined)).setDisplaySize(96, 96))
      root.add(portrait)
    })
    root.add(scene.add.text(230, 62, options.playerName, typography.secondaryAction))
    root.add(scene.add.text(1690, 62, options.enemyName, typography.secondaryAction).setOrigin(1, 0))
    root.add(scene.add.text(1690, 36, options.twoPlayer ? '2P' : 'CPU', { ...typography.note, color: colorHex('enemyGlow') }).setOrigin(1, 0))
    this.timer = new HexTimer(scene).setPosition(960, 110)
    // 連擊標語顯示在連擊者所在的那一側（站在對手左邊 → 左側），色塊用陣營色。
    this.combos = { PLAYER: new ComboTag(scene, uiTokens.colors.playerPrimary), ENEMY: new ComboTag(scene, uiTokens.colors.enemyPrimary) }
    this.danger = scene.add.text(1550, 166, '', typography.danger).setOrigin(1, 0.5)
    this.lastTen = scene.add.text(1130, 166, '', { ...typography.note, color: colorHex('danger') }).setOrigin(0, 0.5)
    this.firstAttack = scene.add.text(710, 166, 'FIRST ATTACK!', { ...typography.note, color: colorHex('statusLime') }).setOrigin(0.5).setVisible(false)
    this.announcer = new Announcer(scene)
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('inputDebug') === '1') { this.inputDebug = scene.add.text(40, 820, '', { ...typography.note, color: colorHex('statusLime'), backgroundColor: '#000000cc', padding: { x: 12, y: 8 } }); root.add(this.inputDebug) }
    // DEV ?hitbox：畫 hurtbox（藍）與 active hitbox（紅），對照動畫調招式表。
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('hitbox')) { this.boxes = scene.add.graphics(); world.add(this.boxes) }
    root.add([this.timer, this.combos.PLAYER, this.combos.ENEMY, this.danger, this.lastTen, this.firstAttack, this.announcer])
  }

  update(snapshot: MatchSnapshot, events: CombatEvent[], context: PresentationContext, round?: RoundSummary, enemyContext: PresentationContext = {}): void {
    const vm = battleViewModel(snapshot, this.options.stage, this.options.playerName, this.options.enemyName), tick = snapshot.world.tick
    this.contexts = { PLAYER: context, ENEMY: enemyContext }
    this.options.audio?.playSequence(combatCues(events))
    const cues = announceCue(this.previousAnnounce, snapshot, round, this.options.twoPlayer, this.options.maxHp)
    this.options.audio?.playSequence(cues)
    if (cues.some(cue => cue.id === 'ann-ko' || cue.id === 'ann-times-up' || cue.id === 'ann-double-kill')) this.options.audio?.play({ id: 'amb-claps' })
    this.previousAnnounce = snapshot.announce
    events.forEach(event => {
      // 同 tick 先有 HIT 的重擊震動，倒地震動用 force 蓋過。
      if (event.type === 'KNOCKDOWN' && !reducedMotion) this.scene.cameras.main.shake(220, 0.005, true)
      if (event.type !== 'HIT') return
      if (this.firstHit?.round !== vm.round) this.firstHit = { round: vm.round, tick, byPlayer: event.attacker === 'PLAYER' }
      const blocked = events.some(other => other.type === 'BLOCK' && other.attackId === event.attackId && other.attacker === event.attacker)
      // 打擊感：受擊閃白、頓幀抖動（renderAt）、重擊小震。
      if (!blocked) this.fighter(event.defender).flash()
      if (!reducedMotion) this.jitter = { id: event.defender, amplitude: blocked ? 4 : 8 }
      if (!blocked && event.attack.startsWith('HEAVY') && !reducedMotion) this.scene.cameras.main.shake(120, 0.003)
      const kind = blocked ? 'guard' : 'hit', facing = snapshot.world.fighters[blocked ? event.defender : event.attacker].facing
      playImpactFx(this.scene, this.world, kind, event.at.x, event.at.y, impactFlip(facing), impactScale(kind, event.attack))
    })
    const outcome = (id: FighterId) => outcomeFor(id, snapshot.matchState, round?.winner)
    this.player.update(vm.player, tick, { ...context, outcome: outcome('PLAYER') }); this.enemy.update(vm.enemy, tick, { ...enemyContext, outcome: outcome('ENEMY') })
    const combat = this.options.combat
    if (this.boxes && combat) {
      this.boxes.clear().lineStyle(3, uiTokens.colors.systemBlue)
      ;(['PLAYER', 'ENEMY'] as const).forEach((id) => { const box = combat.getHurtbox(id); this.boxes?.strokeRect(box.x, box.y, box.width, box.height) })
      this.boxes.lineStyle(3, uiTokens.colors.danger)
      ;(['PLAYER', 'ENEMY'] as const).forEach((id) => { const box = combat.getActiveHitbox(id); if (box) this.boxes?.strokeRect(box.x, box.y, box.width, box.height) })
    }
    if (this.inputDebug) {
      const last = this.options.input.lastCombatInput, presentation = this.player.presentation ?? resolvePresentation(vm.player, context), sprite = this.options.playerSprite
      const sheet = presentationSheet[presentation], file = sheetAnimations.find(animation => animation.key === sheet)?.filename ?? ''
      const animation = isSheetSprite(sprite) ? sheetUrl(sprite, sheet, file).split('/').at(-1)?.replace('.png', '') : `${sprite}-${spriteActionFor(vm.player)}`
      this.inputDebug.setText(['PLAYER 1', `Physical Key: ${last ? keyLabel(last.code) : '-'}`, `Semantic Action: ${last?.action ?? '-'}`, `Fighter Context: ${/AIR$|^JUMP$/.test(presentation) ? 'AIRBORNE' : presentation.includes('CROUCH') ? 'CROUCHING' : 'STANDING'}`, `Resolved Presentation: ${presentation}`, `Animation: ${animation}`].join('\n'))
    }
    this.playerBar.setRatio(vm.playerHp / vm.maxHp, vm.playerHp); this.enemyBar.setRatio(vm.enemyHp / vm.maxHp, vm.enemyHp)
    this.playerRounds.setWins(vm.playerWins); this.enemyRounds.setWins(vm.enemyWins); this.timer.updateTime(vm.timerSeconds, vm.round)
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
