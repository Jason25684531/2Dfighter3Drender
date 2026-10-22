import { describe, expect, it } from 'vitest'
import { CombatWorld, DEFAULT_COMBAT_CONFIG, type FighterIntent } from '../combat/CombatWorld'
import { AI_PROFILES, DEFAULT_AI_PROFILE, resolveAiProfile, type AiProfile } from '../config/aiProfiles'
import { EnemyAI } from './EnemyAI'

const neutral: FighterIntent = { moveX: 0, jumpPressed: false, attackPressed: false, guardHeld: false }
const cfg = DEFAULT_COMBAT_CONFIG
const attackDistance = cfg.attack.hitboxOffset + cfg.attack.hitboxWidth / 2 + cfg.fighterWidth / 2 - cfg.walkSpeed

// 玩家靜止，敵人用 profile 跑 ticks；回傳攻擊起手 tick 與「在攻擊距離外」的 tick 數。
const simulate = (profile: AiProfile, ticks = 600): { attacks: number[]; far: number } => {
  const world = new CombatWorld(); const ai = new EnemyAI(cfg, profile); const attacks: number[] = []; let far = 0, t = 0
  world.subscribe((event) => { if (event.type === 'ATTACK_STARTED' && event.attacker === 'ENEMY') attacks.push(t) })
  for (t = 1; t <= ticks; t += 1) {
    const snap = world.getSnapshot(); if (Math.abs(snap.fighters.PLAYER.x - snap.fighters.ENEMY.x) > attackDistance) far += 1
    world.tick(neutral, ai.getIntent(snap))
  }
  return { attacks, far }
}

describe('EnemyAI profiles', () => {
  it('defaults to NORMAL and resolves ids', () => {
    expect(DEFAULT_AI_PROFILE.id).toBe('NORMAL'); expect(resolveAiProfile('HARD')).toBe(AI_PROFILES.HARD); expect(resolveAiProfile('nope')).toBe(DEFAULT_AI_PROFILE)
  })

  it('HARD attacks more often than EASY', () => {
    expect(simulate(AI_PROFILES.HARD).attacks.length).toBeGreaterThan(simulate(AI_PROFILES.EASY).attacks.length)
  })

  it('NORMAL keeps its distance a good part of the time yet still attacks', () => {
    const { attacks, far } = simulate(AI_PROFILES.NORMAL)
    expect(far).toBeGreaterThanOrEqual(600 * 0.3); expect(attacks.length).toBeGreaterThan(0)
  })

  it('retreats after an attack before attacking again', () => {
    const { attacks } = simulate(AI_PROFILES.NORMAL); const gaps = attacks.slice(1).map((tick, i) => tick - attacks[i])
    expect(gaps.length).toBeGreaterThan(0); expect(Math.min(...gaps)).toBeGreaterThanOrEqual(AI_PROFILES.NORMAL.retreatTicks + 8)
  })

  it('is reproducible and reset restores the seed', () => {
    const world = new CombatWorld(); const snaps = Array.from({ length: 80 }, () => world.getSnapshot())
    const run = (ai: EnemyAI): FighterIntent[] => snaps.map((snap) => ai.getIntent(snap))
    const a = new EnemyAI(); const first = run(a); expect(run(new EnemyAI())).toEqual(first); a.reset(); expect(run(a)).toEqual(first)
  })

  it('returns a neutral intent while stunned or attacking', () => {
    const snap = new CombatWorld().getSnapshot(); snap.fighters.ENEMY.state = 'HIT_STUN'; expect(new EnemyAI().getIntent(snap)).toEqual(neutral)
    const attacking = new CombatWorld().getSnapshot(); attacking.fighters.ENEMY.attackPhase = 'ACTIVE'; expect(new EnemyAI().getIntent(attacking)).toEqual(neutral)
  })
})
