import type Phaser from 'phaser'
import type { ExperienceFlow } from '../../app/ExperienceFlow'
import type { InputManager } from '../../input/InputManager'
import { FIXED_STEP_MS, type GameClock } from '../../time/GameClock'
import type { CombatEvent } from '../../combat/CombatWorld'
import type { PresentationContext } from '../animation/TemporarySpriteManifest'
import { BattleView } from '../battle/BattleView'
import { reducedMotion, uiTokens } from '../tokens/uiTokens'
import { ArenaScreen, type Matchup, type ScreenContext } from './ScreenView'

export type BattleOptions = { input: InputManager; clock: GameClock; takeEvents: () => CombatEvent[]; playerContext: PresentationContext; enemyContext: PresentationContext }

/** P4：HUD、角色與舞台鏡頭。tick 投影權威的對戰狀態；update 只做影格間插值與鏡頭跟隨。 */
export class BattleScreen extends ArenaScreen {
  readonly view: BattleView

  constructor(ctx: ScreenContext, root: Phaser.GameObjects.Container, matchup: Matchup, private readonly flow: ExperienceFlow, private readonly options: BattleOptions) {
    super(ctx, root, matchup.stageId, uiTokens.backdrop.battle)
    const config = flow.match.world.getConfig()
    this.view = new BattleView(this.scene, this.arena, this.stage.world, { stage: matchup.stageId, playerSprite: matchup.playerSprite, enemySprite: matchup.enemySprite, playerName: matchup.playerName, enemyName: matchup.enemyName, twoPlayer: matchup.twoPlayer, floorY: config.floorY, maxHp: config.maxHp, input: options.input, audio: ctx.audio, combat: flow.match.world })
    this.tick()
  }

  tick(): void {
    const { match } = this.flow
    this.view.update(match.getSnapshot(), this.options.takeEvents(), this.options.playerContext, match.getRoundSummaries().at(-1), this.options.enemyContext)
  }

  update(deltaMs: number): void {
    const alpha = Math.min(1, Math.max(0, this.options.clock.getRemainderMs() / FIXED_STEP_MS))
    this.view.renderAt(alpha)
    // 鏡頭只改呈現：在插值後依兩名角色位置更新，不回寫 Combat。
    this.stage.follow(this.view.player.x, this.view.enemy.x, reducedMotion ? Infinity : deltaMs / 1000)
  }

  destroy(): void { this.view.destroy(); super.destroy() }
}
