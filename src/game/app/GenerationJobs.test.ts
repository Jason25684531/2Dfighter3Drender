import { describe, expect, it, vi } from 'vitest'
import type Phaser from 'phaser'
import { GenerationJobs } from './GenerationJobs'

const generate = vi.hoisted(() => ({ resolve: (_id: string) => {}, reject: () => {} }))
vi.mock('../api/CharacterGeneration', () => ({
  generateCharacter: () => new Promise<string>((resolve, reject) => { generate.resolve = resolve; generate.reject = reject }),
  dropGeneratedTextures: () => {}, dropHdActions: () => {}, listGeneratedCharacters: async () => [], loadGeneratedCharacter: async () => {}, loadHdSprite: async () => {},
}))

const jobs = () => new GenerationJobs({} as Phaser.Scene, () => {})
describe('GenerationJobs.locked', () => {
  it('only skips failed generation once the fallback and any second player are ready', async () => {
    const queue = jobs()
    queue.start('P1', 'ONE', 1, 'photo')
    generate.reject(); await Promise.resolve()
    expect(queue.skipFailed()).toBe(false)
    await queue.loadSelected([])
    queue.start('P2', 'TWO', 2, 'photo')
    expect(queue.skipFailed()).toBe(false)
    generate.resolve('two'); await Promise.resolve()
    expect(queue.skipFailed()).toBe(true)
    expect(queue.has('P1')).toBe(false)
    expect(queue.assetId('P2')).toBe('two')
  })

  it('stays open until a ComfyUI job is submitted, then closes through completion, and reopens on failure or clear', async () => {
    const queue = jobs(); expect(queue.locked).toBe(false)
    queue.start('P1', 'ONE', 1, 'photo'); expect(queue.locked).toBe(true)
    generate.resolve('asset-1'); await Promise.resolve(); await Promise.resolve(); expect(queue.generating).toBe(false); expect(queue.locked).toBe(true)
    queue.clear(); expect(queue.locked).toBe(false)
    queue.start('P2', 'TWO', 2, 'photo'); generate.reject(); await Promise.resolve(); await Promise.resolve()
    expect(queue.failed).toBe(true); expect(queue.locked).toBe(false)
  })
})
