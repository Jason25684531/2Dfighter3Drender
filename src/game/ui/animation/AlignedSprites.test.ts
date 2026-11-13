// @ts-expect-error Node-only asset verification; the browser project does not include Node types.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CombatWorld } from '../../combat/CombatWorld'
import { alignedAction, alignedSprites, sheetAnimations, sheetUrl } from './SheetSpriteManifest'
import { presentationSheetFor, spriteFrameFor, type Presentation } from './TemporarySpriteManifest'

describe('aligned character sheets', () => {
  it('matches all source manifests/PNG geometry and compact runtime sheets', () => {
    for (const [id, sprite] of Object.entries(alignedSprites)) {
      const root = `public/test-assets/1113_characters/${sprite.folder}`
      const manifest = sprite.manifestFallback ? undefined : JSON.parse(readFileSync(`${root}/reference_aligned_manifest.json`, 'utf8'))
      expect(sprite.manifestFallback).toBe(['tony', 'chris'].includes(id))
      expect(sprite.sourceCellSize).toBe(manifest?.cell_size ?? 1024)
      expect(sprite.fps).toBe(manifest?.gif_fps ?? 16)
      expect(Object.keys(sprite.actions)).toHaveLength(15)
      for (const [number, action] of Object.entries(sprite.actions)) {
        const source = readFileSync(`${root}/${action.filename}`), runtime = readFileSync(`public/test-assets/1113_characters/runtime/${sprite.folder}/${action.filename}`)
        const entry = manifest && Object.entries(manifest.actions).find(([key]) => key.startsWith(number + '_'))?.[1] as { frame_count: number; sprite_sheet: string } | undefined
        expect(source.readUInt32BE(16)).toBe(sprite.sourceCellSize * 4)
        expect(action.frames).toBe(entry?.frame_count ?? source.readUInt32BE(20) / sprite.sourceCellSize * 4)
        if (entry) expect(entry.sprite_sheet.split(/[/\\]/).at(-1)).toBe(action.filename)
        expect(runtime.readUInt32BE(16)).toBe(sprite.size * 4)
        expect(runtime.readUInt32BE(20)).toBe(Math.ceil(action.frames / 4) * sprite.size)
      }
    }
  })

  it('resolves every semantic action and bounds every combat phase to available frames', () => {
    const fighter = new CombatWorld().getFighter('PLAYER')
    const presentations: Presentation[] = ['IDLE', 'MOVE', 'JUMP', 'CROUCH', 'BLOCK', 'PUNCH_LIGHT', 'PUNCH_HEAVY', 'KICK_LIGHT', 'KICK_HEAVY', 'PUNCH_AIR', 'PUNCH_CROUCH', 'KICK_AIR', 'KICK_CROUCH', 'PRONE', 'VICTORY']
    for (const id of Object.keys(alignedSprites) as (keyof typeof alignedSprites)[]) {
      for (const presentation of presentations) {
        const key = presentationSheetFor(id, presentation), action = alignedAction(id, key)!
        expect(sheetUrl(id, key, '')).toContain(`/runtime/${alignedSprites[id].folder}/${action.filename}`)
        for (const attackPhase of ['NONE', 'STARTUP', 'ACTIVE', 'RECOVERY'] as const) {
          for (let tick = 0; tick < 70; tick++) {
            const frame = spriteFrameFor({ ...fighter, attackPhase, attackTicks: tick }, attackPhase === 'NONE' ? 'idle' : 'attack', tick, id, action.frames - 1, key)
            expect(frame).toBeGreaterThanOrEqual(0)
            expect(frame).toBeLessThan(action.frames)
          }
        }
      }
      expect([0, 1, 2, 3, 12].map(t => spriteFrameFor(fighter, 'idle', t, id))).toEqual([0, 0, 1, 2, 0])
      expect(alignedAction(id, 'crouch')?.frames).toBe(4)
      expect(alignedAction(id, 'block')?.filename).toBe('06_Block.png')
      expect(spriteFrameFor({ ...fighter, state: 'HIT_STUN' }, 'hurt', 100, id)).toBe(2)
      expect(spriteFrameFor({ ...fighter, state: 'KNOCKDOWN' }, 'hurt', 100, id)).toBe(7)
      for (const animation of sheetAnimations) expect(alignedAction(id, animation.key)).toBeDefined()
    }
    expect(presentationSheetFor('body01', 'BLOCK')).toBe('crouch')
  })
})
