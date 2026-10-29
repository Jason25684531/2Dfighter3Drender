import { describe, expect, it, vi } from 'vitest'
import { AppState } from '../state/AppState'
import { ExperienceFlow } from './ExperienceFlow'
import type { ExperiencePersistence } from './ExperiencePersistence'
import { ExperienceContext } from './ExperienceContext'

const toBattle = (flow: ExperienceFlow): void => { [AppState.READY, AppState.SETUP, AppState.LOADING, AppState.BATTLE].forEach((state) => flow.app.transitionTo(state)) }
const toPresentation = (flow: ExperienceFlow): void => { toBattle(flow); for (let tick = 0; tick < 10000 && flow.app.getCurrentState() === AppState.BATTLE; tick += 1) flow.tick() }
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
  it('completes a match and replays to P2 with clean match state, keeping the opponent', () => {
    const flow = new ExperienceFlow(); flow.opponent = { characterId: 'preset-c', difficulty: 'HARD' }; playToEnd(flow)
    expect(flow.ui.navigation.dispatch('REPLAY')).toBe(true); expect(flow.app.getCurrentState()).toBe(AppState.SETUP)
    expect(flow.match.getSnapshot().matchState).toBe('READY'); expect(flow.result).toBeUndefined(); expect(flow.opponent?.difficulty).toBe('HARD')
  })

  it('finishes to clean P0 and ends the session', () => {
    const { fake, flow } = fakePersistence()
    flow.setPlayers({ P1: { characterId: 'preset-a' } }); playToEnd(flow)
    expect(flow.ui.navigation.dispatch('FINISH')).toBe(true); expect(flow.app.getCurrentState()).toBe(AppState.IDLE)
    expect(flow.match.getSnapshot().playerRoundWins).toBe(0); expect(flow.result).toBeUndefined(); expect(flow.players).toEqual({})
    expect(fake.beginMatch).toHaveBeenCalledTimes(1); expect(fake.finishMatch).toHaveBeenCalledTimes(1); expect(fake.finishSession).toHaveBeenCalled()
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
})
