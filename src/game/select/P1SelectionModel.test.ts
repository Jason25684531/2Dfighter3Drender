import { describe, expect, it } from 'vitest'
import { moveSlot, P1SelectionModel } from './P1SelectionModel'
import type { OwnedUiAction, PlayerSlotId } from '../input/InputManager'

const press = (model: P1SelectionModel, id: PlayerSlotId, ...actions: OwnedUiAction[]) => actions.map((action) => model.input(id, action))
const capture = (model: P1SelectionModel, id: PlayerSlotId, name: string) => { model.setNickname(id, name); press(model, id, 'CONFIRM', 'CONFIRM'); expect(model.phase).toBe('PROCESSING'); model.completeProcessing() }
const toSlot = (model: P1SelectionModel, id: PlayerSlotId, index: number) => { model.focus(id, index); expect(model.player(id).cursor).toBe(index) }

describe('P1 selection model', () => {
  it('waits for decoded runtime assets, and supports failure/retry without readying early', () => {
    const model = new P1SelectionModel(); model.focus('P1', 1); model.input('P1', 'CONFIRM'); model.setNickname('P1', 'Kevin')
    press(model, 'P1', 'CONFIRM', 'CONFIRM')
    for (const state of ['REQUESTING', 'PROCESSING', 'API_READY', 'DOWNLOADING', 'DECODED'] as const) {
      model.setGenerationState(state); expect(model.isReady('P1')).toBe(false); expect(model.phase).toBe('PROCESSING')
    }
    model.setGenerationState('FAILED'); expect(model.phase).toBe('FAILED')
    model.input('P2', 'CONFIRM'); expect(model.phase).toBe('FAILED')
    model.input('P1', 'CONFIRM'); expect(model.phase).toBe('PROCESSING')
    model.completeProcessing(); expect(model.phase).toBe('ALL_READY'); expect(model.player('P1').generation).toBe('RUNTIME_READY')
  })
  it('rejects unavailable slots and invalid pointer indices', () => {
    const model = new P1SelectionModel()
    for (const index of [0, 41, NaN, 1.5]) expect(model.focus('P1', index)).toBe(false)
    for (const status of ['PROCESSING', 'FAILED'] as const) {
      model.slot(5).status = status; expect(model.input('P1', 'CONFIRM')).toBe('REJECTED'); expect(model.player('P1').locked).toBeUndefined()
    }
  })
  it('lays out 40 honest slots: 4 body templates, 3 featured, the rest empty', () => {
    const { slots } = new P1SelectionModel()
    expect(slots).toHaveLength(40)
    expect(slots.slice(0, 4).map((slot) => slot.entry?.displayName)).toEqual(['BODY 01', 'BODY 02', 'BODY 03', 'BODY 04'])
    expect(slots.slice(4, 7).map((slot) => slot.entry?.displayName)).toEqual(['ARIA', 'KAEL', 'RIVEN'])
    expect(slots.slice(7).every((slot) => slot.type === 'EMPTY' && !slot.entry)).toBe(true)
    expect(new P1SelectionModel([]).slots.slice(0, 4).map(slot => slot.entry?.id)).toEqual(['body-01', 'body-02', 'body-03', 'body-04'])
  })
  it('wraps row-major horizontally and column-wise vertically', () => {
    expect(moveSlot(5, 'NAV_DOWN')).toBe(15); expect(moveSlot(17, 'NAV_UP')).toBe(7); expect(moveSlot(7, 'NAV_UP')).toBe(37)
    expect(moveSlot(35, 'NAV_DOWN')).toBe(5); expect(moveSlot(3, 'NAV_UP')).toBe(33)
    expect(moveSlot(10, 'NAV_RIGHT')).toBe(11); expect(moveSlot(40, 'NAV_RIGHT')).toBe(1); expect(moveSlot(1, 'NAV_LEFT')).toBe(40)
  })
  it('keeps cursors independent, rejects empty slots, and requires an explicit 2P join', () => {
    const model = new P1SelectionModel()
    expect(model.input('P2', 'NAV_LEFT')).toBe('JOIN_HINT'); expect(model.player('P2').joined).toBe(false)
    model.input('P2', 'CONFIRM'); expect(model.player('P2')).toMatchObject({ joined: true, cursor: 6 })
    press(model, 'P1', 'NAV_RIGHT'); press(model, 'P2', 'NAV_DOWN')
    expect([model.player('P1').cursor, model.player('P2').cursor]).toEqual([6, 16])
    expect(model.input('P2', 'CONFIRM')).toBe('REJECTED'); expect(model.player('P2').locked).toBeUndefined()
    model.input('P2', 'BACK'); expect(model.player('P2').joined).toBe(false)
  })
  it('heroes follow focus while browsing and stay on the lock until back', () => {
    const model = new P1SelectionModel(); model.input('P2', 'CONFIRM')
    model.input('P1', 'CONFIRM'); press(model, 'P1', 'NAV_RIGHT')
    expect(model.heroSlot('P1')?.index).toBe(5); expect(model.player('P1').cursor).toBe(5)
    model.input('P1', 'BACK'); press(model, 'P1', 'NAV_RIGHT'); expect(model.heroSlot('P1')?.index).toBe(6)
    expect(model.heroSlot('P2')?.index).toBe(6)
  })
  it('CASE A: solo normal pick goes straight to ALL_READY', () => {
    const model = new P1SelectionModel(); model.input('P1', 'CONFIRM')
    expect(model.phase).toBe('ALL_READY'); expect(model.result()).toEqual({ P1: { characterId: 'preset-a' } })
    model.input('P1', 'BACK'); expect(model.phase).toBe('GRID')
  })
  it('CASE B: solo custom needs a name, supports retake, and readies after mock processing', () => {
    const model = new P1SelectionModel(); toSlot(model, 'P1', 3); model.input('P1', 'CONFIRM')
    expect([model.phase, model.owner]).toEqual(['CUSTOMIZE', 'P1'])
    expect(model.input('P1', 'CONFIRM')).toBe('NAME_REQUIRED')
    model.setNickname('P1', '  Kazu  '); model.input('P1', 'CONFIRM'); expect(model.phase).toBe('REVIEW')
    model.input('P1', 'BACK'); expect(model.phase).toBe('CUSTOMIZE')
    press(model, 'P1', 'CONFIRM', 'CONFIRM'); model.completeProcessing()
    expect(model.phase).toBe('ALL_READY'); expect(model.result()).toEqual({ P1: { characterId: 'body-03', nickname: 'Kazu' } })
  })
  it('CASE C and D: only the custom player captures while the other selection is kept', () => {
    for (const custom of ['P1', 'P2'] as const) {
      const model = new P1SelectionModel(); model.input('P2', 'CONFIRM')
      toSlot(model, custom, 1); model.input('P1', 'CONFIRM'); model.input('P2', 'CONFIRM')
      const other = custom === 'P1' ? 'P2' : 'P1'
      expect(model.owner).toBe(custom); expect(model.status(other)).toBe('WAITING')
      expect(model.input(other, 'BACK')).toBeUndefined(); expect(model.isReady(other)).toBe(true)
      capture(model, custom, 'Lee'); expect(model.phase).toBe('ALL_READY')
    }
  })
  it('CASE E: both custom capture P1 first, then P2', () => {
    const model = new P1SelectionModel(); model.input('P2', 'CONFIRM')
    toSlot(model, 'P1', 2); toSlot(model, 'P2', 4); model.input('P2', 'CONFIRM'); model.input('P1', 'CONFIRM')
    expect(model.owner).toBe('P1'); capture(model, 'P1', 'One')
    expect(model.owner).toBe('P2'); capture(model, 'P2', 'Two')
    expect(model.result()).toEqual({ P1: { characterId: 'body-02', nickname: 'One' }, P2: { characterId: 'body-04', nickname: 'Two' } })
  })
  it('backing out of customize unlocks only the owner and keeps the other READY', () => {
    const model = new P1SelectionModel(); model.input('P2', 'CONFIRM')
    toSlot(model, 'P1', 1); toSlot(model, 'P2', 2); model.input('P1', 'CONFIRM'); model.input('P2', 'CONFIRM')
    capture(model, 'P1', 'Ready')
    model.input('P2', 'BACK')
    expect(model.phase).toBe('GRID'); expect(model.player('P2').locked).toBeUndefined(); expect(model.isReady('P1')).toBe(true)
    model.input('P2', 'CONFIRM'); expect(model.owner).toBe('P2')
  })
  it('allows both players to lock the same character', () => {
    const model = new P1SelectionModel(); model.input('P2', 'CONFIRM'); toSlot(model, 'P2', 5)
    model.input('P1', 'CONFIRM'); model.input('P2', 'CONFIRM')
    expect(model.result()).toEqual({ P1: { characterId: 'preset-a' }, P2: { characterId: 'preset-a' } })
  })
  it('re-opens the grid when 2P joins during ALL_READY and advances when 2P leaves', () => {
    const model = new P1SelectionModel(); model.input('P1', 'CONFIRM'); expect(model.phase).toBe('ALL_READY')
    model.input('P2', 'CONFIRM'); expect(model.phase).toBe('GRID')
    model.input('P2', 'BACK'); expect(model.phase).toBe('ALL_READY')
  })
})
