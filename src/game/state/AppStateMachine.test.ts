import { describe, expect, it, vi } from 'vitest'
import { AppState } from './AppState'
import { AppStateMachine } from './AppStateMachine'

const reachEnd = (machine: AppStateMachine): void => {
  [AppState.READY, AppState.SETUP, AppState.LOADING, AppState.BATTLE, AppState.PRESENTATION, AppState.RESULT, AppState.END]
    .forEach((state) => expect(machine.transitionTo(state)).toBe(true))
}

describe('AppStateMachine', () => {
  it('starts in P0_IDLE', () => {
    expect(new AppStateMachine().getCurrentState()).toBe(AppState.IDLE)
  })

  it('allows P0 to P1', () => {
    const machine = new AppStateMachine()
    expect(machine.transitionTo(AppState.READY)).toBe(true)
    expect(machine.getCurrentState()).toBe(AppState.READY)
  })

  it('rejects P0 to P4 without changing state', () => {
    const machine = new AppStateMachine()
    expect(machine.transitionTo(AppState.BATTLE)).toBe(false)
    expect(machine.getCurrentState()).toBe(AppState.IDLE)
  })

  it('completes the full P0 to P7 flow', () => {
    const machine = new AppStateMachine()
    reachEnd(machine)
    expect(machine.getCurrentState()).toBe(AppState.END)
  })

  it('allows replay from P7 to P2', () => {
    const machine = new AppStateMachine()
    reachEnd(machine)
    expect(machine.transitionTo(AppState.SETUP)).toBe(true)
  })

  it('allows finish from P7 to P0', () => {
    const machine = new AppStateMachine()
    reachEnd(machine)
    expect(machine.transitionTo(AppState.IDLE)).toBe(true)
  })

  it('notifies subscribers with previous and next state', () => {
    const listener = vi.fn()
    const machine = new AppStateMachine()
    machine.subscribe(listener)
    machine.transitionTo(AppState.READY)
    expect(listener).toHaveBeenCalledWith({ previousState: AppState.IDLE, nextState: AppState.READY })
  })

  it('does not emit a transition for the same state', () => {
    const listener = vi.fn()
    const machine = new AppStateMachine()
    machine.subscribe(listener)
    expect(machine.transitionTo(AppState.IDLE)).toBe(false)
    expect(listener).not.toHaveBeenCalled()
  })

  it('stops notifying an unsubscribed listener', () => {
    const listener = vi.fn()
    const machine = new AppStateMachine()
    machine.subscribe(listener)()
    machine.transitionTo(AppState.READY)
    expect(listener).not.toHaveBeenCalled()
  })
})
