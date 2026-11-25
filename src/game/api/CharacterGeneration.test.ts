import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateCharacter } from './CharacterGeneration'

vi.mock('phaser', () => ({ default: {} }))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('generateCharacter', () => {
  it('fails on the first poll when ComfyUI finished without readable assets', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ job: 'demo' })).mockResolvedValueOnce(new Response(null, { status: 422 })).mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    const completed = vi.fn()
    const pending = generateCharacter({} as never, 'Test', 1, 'photo', controller.signal).then(completed, completed)
    await vi.advanceTimersByTimeAsync(3000)
    const result = completed.mock.calls[0]?.[0]
    controller.abort()
    await pending
    expect(result).toMatchObject({ status: 422 })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('cancels the queued job when the POST completes after the player leaves', async () => {
    const controller = new AbortController()
    let accept: (response: Response) => void = () => undefined
    const fetch = vi.fn().mockImplementationOnce((_url, options) => new Promise<Response>((resolve, reject) => {
      accept = resolve
      options.signal?.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
    })).mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    const rejected = generateCharacter({} as never, 'Test', 1, 'photo', controller.signal).catch(error => error)
    controller.abort()
    accept(Response.json({ job: 'queued' }))
    expect(await rejected).toMatchObject({ name: 'AbortError' })
    expect(fetch).toHaveBeenLastCalledWith(expect.stringMatching(/\/generation\/queued$/), expect.objectContaining({ method: 'DELETE' }))
  })
})
