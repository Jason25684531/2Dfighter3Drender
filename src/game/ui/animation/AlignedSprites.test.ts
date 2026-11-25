// @ts-expect-error Node-only asset verification; the browser project does not include Node types.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CombatWorld } from '../../combat/CombatWorld'
import { alignedAction, alignedSheetUrl, alignedSprites, registerGeneratedSprite, sheetAnimations, sheetUrl, type AlignedSprite } from './SheetSpriteManifest'
import { presentationSheetFor, spriteFrameFor, type Presentation } from './TemporarySpriteManifest'

describe('aligned character sheets', () => {
  it('matches all source manifests/PNG geometry and compact runtime sheets', () => {
    for (const [id, sprite] of Object.entries(alignedSprites)) {
      const root = `public/assest/characters/${sprite.folder}`
      const manifest = sprite.manifestFallback ? undefined : JSON.parse(readFileSync(`${root}/game_manifest.json`, 'utf8'))
      expect(sprite.manifestFallback).toBe(id === 'tony')
      expect(sprite.sourceCellSize).toBe(manifest?.cell_width ?? 1024)
      expect(sprite.fps).toBe(manifest?.gif_fps ?? 16)
      expect(Object.keys(sprite.actions)).toHaveLength(15)
      for (const [number, action] of Object.entries(sprite.actions)) {
        const source = readFileSync(`${root}/${action.filename}`), runtime = readFileSync(`${root}/compact/${action.filename}`)
        const entry = manifest?.actions.find((candidate: { id: string }) => candidate.id.startsWith(number + '_')) as { frame_count: number; sprite_sheet: string } | undefined
        expect(source.readUInt32BE(16)).toBe(sprite.sourceCellSize * 4)
        expect(action.frames).toBe(entry?.frame_count ?? source.readUInt32BE(20) / sprite.sourceCellSize * 4)
        if (entry) expect(entry.sprite_sheet.split(/[/\\]/).at(-1)).toBe(action.filename)
        expect(runtime.readUInt32BE(16)).toBe(sprite.size * 4)
        expect(runtime.readUInt32BE(20)).toBe(Math.ceil(action.frames / 4) * sprite.size)
      }
    }
  })

  it('plays a generated character at its manifest fps and frame counts', () => {
    const actions = { ...alignedSprites.s2am.actions, '05': { filename: '05_Crouch.png', frames: 4 } }
    registerGeneratedSprite('generated-probe', { ...alignedSprites.s2am, size: 1024, fps: 16, actions } as AlignedSprite)
    const idle = new CombatWorld().getFighter('PLAYER')
    expect([3, 12, 24].map((ticks) => spriteFrameFor(idle, 'idle', ticks, 'generated-probe'))).toEqual([2, 0, 0])
    expect(spriteFrameFor(idle, 'idle', 3, 'generated-probe', undefined, 'intro-victory')).toBe(2)
    expect(spriteFrameFor(idle, 'idle', 100, 'generated-probe', undefined, 'intro-victory')).toBe(7)
    expect(presentationSheetFor('generated-probe', 'BLOCK')).toBe('block')
  })
  it('loops the victory animation instead of freezing on the last frame', () => {
    const fighter = new CombatWorld().getFighter('PLAYER')
    expect([3, 9, 15, 21].map((t) => spriteFrameFor(fighter, 'victory', t, 'chris', undefined, 'intro-victory'))).toEqual([2, 6, 2, 6])
  })
  it('resolves every semantic action and bounds every combat phase to available frames', () => {
    const fighter = new CombatWorld().getFighter('PLAYER')
    const presentations: Presentation[] = ['IDLE', 'MOVE', 'JUMP', 'CROUCH', 'BLOCK', 'PUNCH_LIGHT', 'PUNCH_HEAVY', 'KICK_LIGHT', 'KICK_HEAVY', 'PUNCH_AIR', 'PUNCH_CROUCH', 'KICK_AIR', 'KICK_CROUCH', 'PRONE', 'VICTORY']
    for (const id of Object.keys(alignedSprites) as (keyof typeof alignedSprites)[]) {
      for (const presentation of presentations) {
        const key = presentationSheetFor(id, presentation), action = alignedAction(id, key)!
        expect(sheetUrl(id, key, '')).toBe(`/assest/characters/${alignedSprites[id].folder}/compact/${action.filename}`)
        expect(alignedSheetUrl(alignedSprites[id], action.filename, true)).toBe(`/assest/characters/${alignedSprites[id].folder}/${action.filename}`)
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
