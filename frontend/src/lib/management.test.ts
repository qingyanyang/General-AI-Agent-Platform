import { createManagementClient } from '@/lib/management'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('createManagementClient', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists every agent status with a page limit', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], next_cursor: null }))
    const client = createManagementClient(async () => 'token')
    await client.listAgents('cursor-1')
    const [url, init] = fetchMock.mock.calls[0]
    const parsed = new URL(String(url), 'http://localhost')
    expect(parsed.pathname).toBe('/agents')
    expect(parsed.searchParams.get('status')).toBe('all')
    expect(parsed.searchParams.get('limit')).toBe('100')
    expect(parsed.searchParams.get('cursor')).toBe('cursor-1')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token')
  })

  it('treats a grant upsert with no content as removal', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    const client = createManagementClient(async () => 'token')
    const saved = await client.upsertGrant({
      user_id: 'auth0|ada',
      agent_id: 'support',
      can_view: false,
      can_configure: false,
      can_execute: false,
    })
    expect(saved).toBeNull()
    const [, init] = fetchMock.mock.calls[0]
    expect(init?.method).toBe('PUT')
  })
})
