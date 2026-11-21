import {
  DEFAULT_SESSION_TITLE,
  pruneEmptyDraftSessions,
  titleFromMessage,
} from '@/lib/session-drafts'

describe('session drafts', () => {
  it('builds a first-line title from the opening message', () => {
    expect(titleFromMessage('  Hello world\nmore')).toBe('Hello world')
    expect(titleFromMessage('')).toBe(DEFAULT_SESSION_TITLE)
  })

  it('archives empty default-titled drafts and keeps sessions with history', async () => {
    const listMessages = vi.fn(async (id: string) =>
      id === 'keep' ? [{ role: 'user', content: 'hi' }] : [],
    )
    const deleteSession = vi.fn(async () => undefined)
    const next = await pruneEmptyDraftSessions(
      [
        { id: 'empty-1', agent_id: 'a', title: DEFAULT_SESSION_TITLE },
        { id: 'keep', agent_id: 'a', title: DEFAULT_SESSION_TITLE },
        { id: 'named', agent_id: 'a', title: 'Named thread' },
      ],
      { listMessages, deleteSession },
    )
    expect(deleteSession).toHaveBeenCalledTimes(1)
    expect(deleteSession).toHaveBeenCalledWith('empty-1')
    expect(next.map((session) => session.id)).toEqual(['keep', 'named'])
  })
})
