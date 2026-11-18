import { describe, expect, it } from 'vitest'
import { headRect } from './headCrop'

const n = 64
const figure = (top: number, bottom: number, left: number, right: number) => (x: number, y: number): boolean => y >= top && y <= bottom && x >= left && x <= right

describe('head crop', () => {
  it('frames a square around the top quarter of the figure, centred on it', () => {
    const rect = headRect(figure(10, 60, 30, 50), n)
    expect(rect.size).toBe(Math.round(51 * 0.26))
    expect(rect.x + rect.size / 2).toBeCloseTo(40, 0)
    expect(rect.y).toBeCloseTo(10 - rect.size * 0.1, 5)
  })

  it('stays inside the frame for a figure at the edge', () => {
    const rect = headRect(figure(0, 63, 0, 6), n)
    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.y).toBeGreaterThanOrEqual(0)
    expect(rect.x + rect.size).toBeLessThanOrEqual(n)
  })

  it('falls back to the centre for an empty frame', () => {
    const rect = headRect(() => false, n)
    expect(rect.size).toBeGreaterThan(0)
    expect(rect.x + rect.size / 2).toBeCloseTo(n / 2, 0)
  })
})
