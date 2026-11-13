import { createChatClient } from '@/lib/api'
import { ApiError } from '@/lib/errors'

const agent = {
  id: 'support',
  name: 'Support',
  description: null,
  status: 'active',
  created_by: 'user',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('createChatClient', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists sessions with limit and cursor and without an agent filter', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [{ id: 's1', user_id: 'u', agent_id: 'support', title: 'New chat', created_at: '', last_activity_at: '' }],
        next_cursor: null,
      }),
    )
    const client = createChatClient(async () => 'token')
    await client.listSessions('cursor-1')
    const [url, init] = fetchMock.mock.calls[0]
    const parsed = new URL(String(url), 'http://localhost')
    expect(parsed.pathname).toBe('/sessions')
    expect(parsed.searchParams.get('limit')).toBe('100')
    expect(parsed.searchParams.get('cursor')).toBe('cursor-1')
    expect(parsed.searchParams.has('agent_id')).toBe(false)
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token')
  })

  it('posts only the tool call id when approving', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        execution_id: 'exec-1',
        message: { role: 'assistant', content: 'Approved.' },
      }),
    )
    const client = createChatClient(async () => 'token')
    const result = await client.decideApproval('sess', 'int/1', 'approve', 'call-1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/sessions/sess/approvals/int%2F1/approve')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ tool_call_id: 'call-1' }))
    expect(result).toEqual({
      status: 200,
      executionId: 'exec-1',
      message: { role: 'assistant', content: 'Approved.' },
    })
  })

  it('returns the next pending approval on 202 and throws on 409', async () => {
    const client = createChatClient(async () => 'token')
    const pending = {
      execution_id: 'exec-2',
      interrupt_id: 'int-2',
      checkpoint_id: 'cp-2',
      tool_call_id: 'call-2',
      tool_name: 'send_mail',
      arguments: { to: 'a@example.com' },
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(pending, 202))
    await expect(client.decideApproval('sess', 'int-1', 'reject', 'call-1')).resolves.toEqual({
      status: 202,
      approval: pending,
    })
    expect(String(fetchMock.mock.calls[0][0])).toContain('/reject')

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: 'Approval does not match the pending call' }, 409),
    )
    const error: unknown = await client
      .decideApproval('sess', 'int-1', 'approve', 'call-1')
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409 })
  })

  it('does not list an agent that the payload omitted', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [agent], next_cursor: null }))
    const client = createChatClient(async () => 'token')
    const page = await client.listAgents()
    expect(page.items.map((item) => item.id)).toEqual(['support'])
  })
})
