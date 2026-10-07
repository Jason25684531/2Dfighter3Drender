import { describe, expect, it, vi } from 'vitest'
import { ApiClient } from './ApiClient'

describe('ApiClient', () => {
  it('parses successful JSON and backend errors', async () => {
    const ok = new ApiClient({ baseUrl: 'http://api', fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok', database: 'ok' }))) })
    await expect(ok.health()).resolves.toEqual({ status: 'ok', database: 'ok' })
    const fail = new ApiClient({ baseUrl: 'http://api', fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'NOPE', message: 'no' } }), { status: 404 })) })
    await expect(fail.health()).rejects.toMatchObject({ code: 'NOPE', status: 404 })
  })

  it('normalizes timeout and invalid JSON', async () => {
    const waitForAbort: typeof fetch = (_url, init) => new Promise<Response>((_, reject) => (init?.signal as AbortSignal).addEventListener('abort', () => reject(new DOMException('', 'AbortError'))))
    const timeout = new ApiClient({ timeoutMs: 0, fetchImpl: waitForAbort })
    await expect(timeout.health()).rejects.toMatchObject({ code: 'TIMEOUT' })
    const invalid = new ApiClient({ fetchImpl: vi.fn().mockResolvedValue(new Response('not json')) })
    await expect(invalid.health()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('retries transient failures but not conflicts', async () => {
    const transient = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok', database: 'ok' })))
    await expect(new ApiClient({ fetchImpl: transient, maxRetries: 2 }).health()).resolves.toEqual({ status: 'ok', database: 'ok' }); expect(transient).toHaveBeenCalledTimes(2)
    const conflict = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'IDEMPOTENCY_CONFLICT', message: 'conflict' } }), { status: 409 }))
    await expect(new ApiClient({ fetchImpl: conflict, maxRetries: 2 }).health()).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' }); expect(conflict).toHaveBeenCalledTimes(1)
  })
})
