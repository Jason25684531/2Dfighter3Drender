import { describe, expect, it } from 'vitest'
import { NameKeyboard } from './NameKeyboard'

describe('NameKeyboard', () => {
  it('types letters, digits and space, deletes, and caps the length', () => {
    const k = new NameKeyboard()
    expect(k.type('', 16)).toBe('A')
    k.move('NAV_RIGHT'); k.move('NAV_DOWN')
    expect(k.type('A', 16)).toBe('AL')
    k.move('NAV_DOWN'); k.move('NAV_DOWN'); k.move('NAV_DOWN')
    expect([k.key, k.type('AL', 16)]).toEqual(['DEL', 'A'])
    k.move('NAV_LEFT')
    expect(k.type('A', 16)).toBe('A ')
    expect(k.type('ABCDEFGHIJKLMNOP', 16)).toBe('ABCDEFGHIJKLMNOP')
  })

  it('hands OK back to the normal confirm and wraps the cursor', () => {
    const k = new NameKeyboard()
    k.move('NAV_UP')
    expect(k.key).toBe('SPACE')
    k.move('NAV_LEFT')
    expect([k.key, k.type('KEVIN', 16)]).toEqual(['OK', undefined])
    k.move('NAV_UP')
    expect(k.key).toBe('6')
    expect(k.move('CONFIRM')).toBe(false)
  })
})
