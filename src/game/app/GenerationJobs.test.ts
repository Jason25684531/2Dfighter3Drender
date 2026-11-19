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
  it('stays open until a ComfyUI job is submitted, then closes through completion, and reopens on failure or clear', async () => {
    const queue = jobs(); expect(queue.locked).toBe(false)
    queue.start('P1', 'ONE', 1, 'photo'); expect(queue.locked).toBe(true)
    generate.resolve('asset-1'); await Promise.resolve(); await Promise.resolve(); expect(queue.generating).toBe(false); expect(queue.locked).toBe(true)
    queue.clear(); expect(queue.locked).toBe(false)
    queue.start('P2', 'TWO', 2, 'photo'); generate.reject(); await Promise.resolve(); await Promise.resolve()
    expect(queue.failed).toBe(true); expect(queue.locked).toBe(false)
  })
})
