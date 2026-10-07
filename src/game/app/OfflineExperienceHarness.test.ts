import { describe, expect, it } from 'vitest'
import { AppState } from '../state/AppState'
import { OfflineExperienceHarness } from './OfflineExperienceHarness'

const playToEnd = (harness: OfflineExperienceHarness): void => { harness.start(); for (let tick = 0; tick < 10000 && harness.app.getCurrentState() !== AppState.END; tick += 1) harness.tick(); expect(harness.app.getCurrentState()).toBe(AppState.END); expect(harness.result).toBeDefined() }

describe('offline P0-P7 flow', () => {
  it('completes a match and replays to P2 with clean match state', () => {
    const harness = new OfflineExperienceHarness(); playToEnd(harness); expect(harness.replay()).toBe(true); expect(harness.app.getCurrentState()).toBe(AppState.SETUP); expect(harness.match.getSnapshot().matchState).toBe('READY'); expect(harness.result).toBeUndefined()
  })

  it('completes a separate match and finishes to clean P0', () => {
    const harness = new OfflineExperienceHarness(); playToEnd(harness); expect(harness.finish()).toBe(true); expect(harness.app.getCurrentState()).toBe(AppState.IDLE); expect(harness.match.getSnapshot().playerRoundWins).toBe(0); expect(harness.result).toBeUndefined()
  })
})
