import { describe, expect, it, vi } from 'vitest'
import { AppState } from '../state/AppState'
import { ExperienceFlow } from './ExperienceFlow'
import type { ExperiencePersistence } from './ExperiencePersistence'
import { ExperienceContext } from './ExperienceContext'

const toBattle = (flow: ExperienceFlow): void => { [AppState.READY, AppState.SETUP, AppState.LOADING, AppState.BATTLE].forEach((state) => flow.app.transitionTo(state)) }
const toPresentation = (flow: ExperienceFlow): void => { toBattle(flow); for (let tick = 0; tick < 10000 && flow.app.getCurrentState() === AppState.BATTLE; tick += 1) flow.tick() }
const toBattleFromSetup = (flow: ExperienceFlow): void => { [AppState.SETUP, AppState.LOADING, AppState.BATTLE].forEach((state) => flow.app.transitionTo(state)) }
const playToEnd = (flow: ExperienceFlow): void => {
  toPresentation(flow); expect(flow.app.getCurrentState()).toBe(AppState.PRESENTATION); expect(flow.result).toBeDefined()
  flow.app.transitionTo(AppState.RESULT); flow.app.transitionTo(AppState.END)
}
const fakePersistence = (fail = false) => {
  const call = () => fail ? vi.fn().mockRejectedValue(new Error('offline')) : vi.fn().mockResolvedValue(undefined)
  const fake = { context: new ExperienceContext(), ensureSession: call(), finishSession: call(), beginMatch: call(), recordRounds: call(), finishMatch: call(), updateSession: call(), resetMatch: vi.fn(), leaderboard: vi.fn().mockResolvedValue([]), nextQueuedPlayer: vi.fn().mockResolvedValue(undefined) }
  return { fake, flow: new ExperienceFlow(undefined, undefined, undefined, fake as unknown as ExperiencePersistence) }
}

describe('ExperienceFlow', () => {
  it('completes a match and replays to P1 with clean match state, keeping the opponent', () => {
    const flow = new ExperienceFlow(); flow.opponent = { characterId: 'preset-c', difficulty: 'HARD' }; playToEnd(flow)
    flow.setPlayers({ P1: { characterId: 'generated-one', nickname: 'MOMO' } })
    expect(flow.ui.navigation.dispatch('REPLAY')).toBe(true); expect(flow.app.getCurrentState()).toBe(AppState.READY)
    expect(flow.match.getSnapshot().matchState).toBe('READY'); expect(flow.result).toBeUndefined(); expect(flow.opponent?.difficulty).toBe('HARD'); expect(flow.players.P1).toEqual({ characterId: 'generated-one', nickname: 'MOMO' })
  })

  it('finishes to clean P0 and ends the session', () => {
    const { fake, flow } = fakePersistence()
    flow.setPlayers({ P1: { characterId: 'preset-a' } }); playToEnd(flow)
    expect(flow.ui.navigation.dispatch('FINISH')).toBe(true); expect(flow.app.getCurrentState()).toBe(AppState.IDLE)
    expect(flow.match.getSnapshot().playerRoundWins).toBe(0); expect(flow.result).toBeUndefined(); expect(flow.players).toEqual({})
    expect(fake.beginMatch).toHaveBeenCalledTimes(1); expect(fake.finishMatch).toHaveBeenCalledTimes(1); expect(fake.finishSession).toHaveBeenCalled()
  })

  it('restarts the active match at Round 1 without changing players or storing the abandoned result', () => {
    const { fake, flow } = fakePersistence()
    flow.setPlayers({ P1: { characterId: 'generated-one', nickname: 'MOMO' } }); flow.opponent = { characterId: 'preset-c', difficulty: 'HARD' }
    fake.context.set({ faceGenUsed: { P1: true }, selectedStageId: 'company-building' })
    toBattle(flow); fake.resetMatch.mockClear(); for (let i = 0; i < 20; i += 1) flow.match.tick()
    expect(flow.match.getSnapshot().remainingTicks).toBeLessThan(1440)
    expect(flow.restartMatch()).toBe(true)
    expect(flow.match.getSnapshot()).toMatchObject({ matchState: 'FIGHTING', roundNumber: 1, playerRoundWins: 0, enemyRoundWins: 0, remainingTicks: 1440, maxPlayerCombo: 0, world: { fighters: { PLAYER: { currentHP: 100 }, ENEMY: { currentHP: 100 } } } })
    expect(flow.players.P1).toEqual({ characterId: 'generated-one', nickname: 'MOMO' }); expect(fake.context.snapshot).toMatchObject({ faceGenUsed: { P1: true }, selectedStageId: 'company-building' })
    expect(fake.resetMatch).toHaveBeenCalledTimes(1); expect(fake.beginMatch).toHaveBeenCalledTimes(2); expect(fake.finishMatch).not.toHaveBeenCalled()
  })

  it('returns home from P3, P5 and P6 with BACK and ends the session each time', () => {
    const { fake, flow } = fakePersistence()
    for (const stop of [AppState.LOADING, AppState.PRESENTATION, AppState.RESULT]) {
      if (stop === AppState.LOADING) [AppState.READY, AppState.SETUP, AppState.LOADING].forEach((state) => flow.app.transitionTo(state))
      else { toPresentation(flow); if (stop === AppState.RESULT) flow.app.transitionTo(AppState.RESULT) }
      expect(flow.app.getCurrentState()).toBe(stop)
      expect(flow.ui.navigation.dispatch('BACK')).toBe(true); expect(flow.app.getCurrentState()).toBe(AppState.IDLE); expect(flow.result).toBeUndefined()
    }
    expect(fake.finishSession).toHaveBeenCalledTimes(3)
  })

  it('completes the same flow when every API request fails', () => {
    const { flow } = fakePersistence(true)
    playToEnd(flow); expect(flow.ui.navigation.dispatch('FINISH')).toBe(true); expect(flow.app.getCurrentState()).toBe(AppState.IDLE)
  })

  it('lets 2P drive the enemy without AI, keeps it on Replay, and still records the result for the leaderboard', () => {
    const { flow } = fakePersistence()
    flow.setPlayers({ P1: { characterId: 'preset-a' }, P2: { characterId: 'preset-b' } }); toBattle(flow)
    for (let tick = 0; tick < 240; tick += 1) flow.tick()
    expect(flow.match.getSnapshot().world.fighters.PLAYER.currentHP).toBe(flow.match.world.getConfig().maxHp)
    const before = flow.match.getSnapshot().world.fighters.ENEMY.x
    for (let tick = 0; tick < 10; tick += 1) flow.tick(undefined, { moveX: -1, jumpPressed: false, attackPressed: false })
    expect(flow.match.getSnapshot().world.fighters.ENEMY.x).toBeLessThan(before)
    const duo = fakePersistence(); duo.flow.setPlayers({ P1: { characterId: 'preset-a' }, P2: { characterId: 'preset-b' } })
    toBattle(duo.flow)
    for (let tick = 0; tick < 10000 && duo.flow.app.getCurrentState() === AppState.BATTLE; tick += 1) duo.flow.tick(undefined, { moveX: 0, jumpPressed: false, attackPressed: tick % 6 === 0, attack: 'LIGHT_PUNCH' })
    expect(duo.flow.app.getCurrentState()).toBe(AppState.PRESENTATION); expect(duo.fake.finishMatch).toHaveBeenCalledTimes(1)
    duo.flow.app.transitionTo(AppState.RESULT); duo.flow.app.transitionTo(AppState.END); duo.flow.ui.navigation.dispatch('REPLAY'); toBattleFromSetup(duo.flow)
    for (let tick = 0; tick < 240; tick += 1) duo.flow.tick()
    expect(duo.flow.match.getSnapshot().world.fighters.PLAYER.currentHP).toBe(duo.flow.match.world.getConfig().maxHp)
  })
})
