// @ts-expect-error Node-only asset check; the browser project does not include Node types.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MAX_SCROLL, STAGE_TUNING } from './stageTuning'
import { testStageManifest } from '../ui/assets/TestAssetManifest'

const pngSize = (url: string): { width: number; height: number } => {
  const header = readFileSync(`public${url}`).subarray(16, 24)
  return { width: header.readUInt32BE(0), height: header.readUInt32BE(4) }
}

describe('stage background lift', () => {
  it('keeps every lifted background covering the bottom edge of the screen', () => {
    const cover = 1920 + 2 * STAGE_TUNING.parallax.background * MAX_SCROLL + 8
    for (const [id, lift] of Object.entries(STAGE_TUNING.backgroundLift)) {
      const { width, height } = pngSize(testStageManifest[id as keyof typeof testStageManifest].url)
      const displayHeight = height * Math.max(cover / width, 1080 / height)
      expect({ id, fits: (displayHeight - 1080) / 2 >= lift }).toEqual({ id, fits: true })
    }
  })

  it('puts the company-building floor edge above the fighters feet (screen y 820)', () => {
    const cover = 1920 + 2 * STAGE_TUNING.parallax.background * MAX_SCROLL + 8
    const { width, height } = pngSize(testStageManifest['company-building'].url), scale = Math.max(cover / width, 1080 / height)
    // 原圖地板上緣（建築立面底邊）約在 y=1130；量法見 backgroundLift 註解。
    const floorEdge = 540 - STAGE_TUNING.backgroundLift['company-building'] - height * scale / 2 + 1130 * scale
    expect(floorEdge).toBeLessThan(820 - 60)
  })
})
