import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchRemoteModelIds } from './pi-models-json'

vi.mock('./config-store', () => ({ configStore: { get: vi.fn(() => undefined) } }))

function respond(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchRemoteModelIds', () => {
  it('reports a rejected key instead of a later candidate URL that 404s', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/v1/models') ? respond(401, 'invalid api key') : respond(404, 'not found'),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await fetchRemoteModelIds({ baseUrl: 'https://relay.example', apiKey: 'sk-wrong' })

    expect(res).toEqual({ ok: false, error: 'HTTP 401: invalid api key' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('still falls through to the next candidate after a 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/v1/models') ? respond(404, 'not found') : respond(200, { data: [{ id: 'model-b' }, { id: 'model-a' }] }),
      ),
    )

    const res = await fetchRemoteModelIds({ baseUrl: 'https://relay.example', apiKey: 'sk-ok' })

    expect(res).toEqual({ ok: true, ids: ['model-a', 'model-b'] })
  })
})
