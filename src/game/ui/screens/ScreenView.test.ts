import { describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => ({ default: {} }))

import { AppStateMachine } from '../../state/AppStateMachine'
import { UIFramework } from '../UIFramework'
import { ScreenView, type Focusable, type ScreenContext } from './ScreenView'

class ProbeScreen extends ScreenView {
  constructor(ctx: ScreenContext, root: never) {
    super(ctx, root)
    this.focusable('probe', 'probe-a', {} as Focusable, () => undefined)
    this.focusable('probe-confirm', 'probe-b', {} as Focusable, () => undefined)
    this.tween({ targets: root, alpha: 0.5, repeat: -1 })
  }
}

const setup = () => {
  const ui = new UIFramework(new AppStateMachine())
  const tweens: Array<{ stop: ReturnType<typeof vi.fn> }> = []
  const scene = { tweens: { add: () => { const tween = { stop: vi.fn(), once: vi.fn() }; tweens.push(tween); return tween } } }
  const ctx: ScreenContext = { scene: scene as never, ui, go: vi.fn(), register: (group, id, _object, activate, enabled) => { ui.focus.register(group, id, enabled, activate) } }
  const root = { alpha: 0, destroy: vi.fn() }
  return { ui, tweens, ctx, root }
}

describe('ScreenView lifecycle', () => {
  it('fades the root in and owns its tweens and focus registrations', () => {
    const { ui, tweens, ctx, root } = setup()
    new ProbeScreen(ctx, root as never)
    expect(tweens).toHaveLength(2)
    ui.focus.activate('probe')
    expect(ui.focus.current()).toBe('probe-a')
  })

  it('releases tweens, focus groups and the root on destroy', () => {
    const { ui, tweens, ctx, root } = setup()
    const screen = new ProbeScreen(ctx, root as never)
    screen.destroy()
    expect(tweens.every((tween) => tween.stop.mock.calls.length === 1)).toBe(true)
    expect(root.destroy).toHaveBeenCalledWith(true)
    ui.focus.activate('probe'); expect(ui.focus.current()).toBeUndefined()
    ui.focus.activate('probe-confirm'); expect(ui.focus.current()).toBeUndefined()
  })

  it('leaves actions to default navigation unless a screen claims them', () => {
    const { ctx, root } = setup()
    expect(new ProbeScreen(ctx, root as never).handleAction('CONFIRM')).toBe(false)
  })
})
