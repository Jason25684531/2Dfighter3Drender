import { describe, expect, it } from 'vitest'
import { CombatWorld, type CombatConfig, type FighterIntent } from '../combat/CombatWorld'
import { EnemyAI } from './EnemyAI'
import { MatchController, p4SubStateFor, ROUND_TICKS } from './MatchController'
import { FIXED_STEP_MS, GameClock } from '../time/GameClock'
import { resolveMatchResult } from './ResultResolver'

const neutral: FighterIntent = { moveX: 0, jumpPressed: false, attackPressed: false, guardHeld: false }
const closeConfig = (damage = 10): CombatConfig => ({ arenaWidth: 1920, floorY: 820, fighterWidth: 120, fighterHeight: 220, walkSpeed: 18, jumpVelocity: -34, gravity: 3, maxHp: 100, attack: { startupTicks: 3, activeTicks: 2, recoveryTicks: 5, damage, hitStunTicks: 6, hitboxOffset: 90, hitboxWidth: 90, hitboxHeight: 80 }, initialPositions: { PLAYER: 560, ENEMY: 640 } })

describe('EnemyAI and MatchController', () => {
  it('approaches, attacks, guards deterministically, and respects restricted state', () => {
    const distant = new CombatWorld(); const ai = new EnemyAI(); expect(ai.getIntent(distant.getSnapshot()).moveX).toBe(-1)
    const close = new CombatWorld(closeConfig()); ai.reset(); expect(ai.getIntent(close.getSnapshot()).attackPressed).toBe(true)
    for (let i = 0; i < 70; i += 1) ai.getIntent(close.getSnapshot()); expect(ai.getIntent(close.getSnapshot()).guardHeld).toBe(true)
    const restricted = close.getSnapshot(); restricted.fighters.ENEMY.state = 'HIT_STUN'; expect(ai.getIntent(restricted)).toEqual(neutral)
    const ai2 = new EnemyAI(); const a = Array.from({ length: 10 }, () => ai2.getIntent(close.getSnapshot())); const ai3 = new EnemyAI(); const b = Array.from({ length: 10 }, () => ai3.getIntent(close.getSnapshot())); expect(a).toEqual(b)
  })

  it('starts with 1440 ticks and decrements only on fighting ticks', () => {
    const match = new MatchController(closeConfig()); expect(match.getSnapshot().remainingTicks).toBe(ROUND_TICKS); match.start(); expect(match.getSnapshot().matchState).toBe('FIGHTING'); match.tick(); expect(match.getSnapshot().remainingTicks).toBe(ROUND_TICKS - 1); expect(match.getSnapshot().world.tick).toBe(1)
  })

  it('resolves KO, first-to-two, round three, and no fourth round', () => {
    const match = new MatchController(closeConfig(100)); match.ai.getIntent = () => neutral
    const winRound = (): void => { match.tick({ ...neutral, attackPressed: true }); match.tick(); match.tick(); match.tick() }
    match.start(); winRound(); expect(match.getSnapshot().matchState).toBe('ROUND_END'); expect(match.getSnapshot().playerRoundWins).toBe(1); match.tick(); expect(match.getSnapshot().roundNumber).toBe(2); winRound(); expect(match.getSnapshot().matchState).toBe('MATCH_END'); expect(match.getSnapshot().roundNumber).toBe(2)
  })

  it('starts a deciding third round after a one-one score', () => {
    const match = new MatchController(closeConfig(100)); let side: 'PLAYER' | 'ENEMY' = 'ENEMY'
    match.ai.getIntent = () => side === 'ENEMY' ? { ...neutral, attackPressed: true } : neutral; match.start()
    for (let i = 0; i < 4; i += 1) match.tick(); expect(match.getSnapshot().enemyRoundWins).toBe(1); match.tick(); side = 'PLAYER'
    for (let i = 0; i < 4; i += 1) match.tick({ ...neutral, attackPressed: true }); expect(match.getSnapshot().playerRoundWins).toBe(1); match.tick(); expect(match.getSnapshot().roundNumber).toBe(3); expect(match.getSnapshot().matchState).toBe('FIGHTING')
  })

  it('replays two draws and ends the third draw as a finite match draw', () => {
    const match = new MatchController(); match.ai.getIntent = () => neutral; match.start()
    for (let draw = 0; draw < 3; draw += 1) { for (let tick = 0; tick < ROUND_TICKS; tick += 1) match.tick(); if (draw < 2) { expect(match.getSnapshot().matchState).toBe('ROUND_END'); match.tick() } }
    expect(match.getSnapshot().matchState).toBe('MATCH_END'); expect(match.getCompletedMatch()?.finishReason).toBe('DRAW')
  })

  it('resets round and match state and resolves deterministic results', () => {
    const match = new MatchController(closeConfig(100)); match.ai.getIntent = () => neutral; match.start(); match.tick({ ...neutral, attackPressed: true }); match.tick(); match.tick(); match.tick(); expect(match.getSnapshot().matchState).toBe('ROUND_END'); match.tick(); expect(match.getSnapshot().roundNumber).toBe(2); match.resetMatch(); expect(match.getSnapshot().matchState).toBe('READY'); expect(match.getSnapshot().playerRoundWins).toBe(0); expect(match.getSnapshot().remainingTicks).toBe(ROUND_TICKS)
    const result = resolveMatchResult({ winner: 'PLAYER', finishReason: 'KO', playerRoundWins: 2, enemyRoundWins: 0, remainingPlayerHP: 80, maxPlayerCombo: 3 }); expect(result.outcome).toBe('WIN'); expect(result.score).toBe(1880); expect(result.title).toBe('UNTOUCHABLE'); expect(result.ranking).toBe('NOT_RANKED')
  })

  it('exposes one summary per resolved round and preserves draw round number', () => {
    const match = new MatchController(closeConfig(100)); match.ai.getIntent = () => neutral; match.start()
    for (let i = 0; i < 4; i += 1) match.tick({ ...neutral, attackPressed: i === 0 })
    expect(match.getRoundSummaries()).toHaveLength(1)
    expect(match.getRoundSummaries()[0]).toMatchObject({ roundIndex: 1, roundNumber: 1, finishReason: 'KO', durationTicks: 4 })
    match.tick(); expect(match.getRoundSummaries()).toHaveLength(1)
    match.resetMatch(); expect(match.getRoundSummaries()).toHaveLength(0)
  })

  it('maps backend rank boundaries without sorting', async () => {
    const { p6SubStateForRank } = await import('./ResultResolver')
    expect(p6SubStateForRank(1)).toBe('RANK_1_TO_6'); expect(p6SubStateForRank(6)).toBe('RANK_1_TO_6'); expect(p6SubStateForRank(7)).toBe('RANK_7_TO_19'); expect(p6SubStateForRank(19)).toBe('RANK_7_TO_19'); expect(p6SubStateForRank(20)).toBe('RANK_20'); expect(p6SubStateForRank(0)).toBe('NOT_RANKED'); expect(p6SubStateForRank(21)).toBe('NOT_RANKED'); expect(p6SubStateForRank(null)).toBe('NOT_RANKED')
  })

  it('uses the documented P4 priority and freezes match timing while paused', () => {
    expect(p4SubStateFor(240, 1, 100, 5)).toBe('LAST_10_SECONDS'); expect(p4SubStateFor(241, 25, 100, 5)).toBe('DANGER'); expect(p4SubStateFor(241, 100, 100, 2)).toBe('COMBO'); expect(p4SubStateFor(241, 100, 100, 0)).toBe('NORMAL')
    const match = new MatchController(); match.ai.getIntent = () => neutral; match.start(); const clock = new GameClock(); clock.subscribe(() => match.tick()); clock.start(); clock.advance(FIXED_STEP_MS); const before = match.getSnapshot(); clock.pause(); clock.advance(1000); expect(match.getSnapshot()).toEqual(before); clock.resume(); clock.advance(FIXED_STEP_MS); expect(match.getSnapshot().remainingTicks).toBe(before.remainingTicks - 1)
  })
})
