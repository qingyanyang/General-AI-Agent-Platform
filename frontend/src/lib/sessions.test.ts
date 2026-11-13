import { loadSessionsForAgent, MAX_SESSION_PAGES } from '@/lib/sessions'
import type { ChatSessionList } from '@/lib/types'

describe('loadSessionsForAgent', () => {
  it('keeps reading when the first page has no sessions for the agent', async () => {
    const cursors: Array<string | undefined> = []
    const page = await loadSessionsForAgent(
      async (cursor) => {
        cursors.push(cursor)
        if (!cursor) {
          return {
            items: [{ id: 'other', agent_id: 'other-agent', title: 'Someone else' }],
            next_cursor: 'page-2',
          }
        }
        return {
          items: [{ id: 'mine', agent_id: 'support', title: 'Support conversation' }],
          next_cursor: null,
        }
      },
      'support',
      null,
    )
    expect(cursors).toEqual([undefined, 'page-2'])
    expect(page.sessions.map((session) => session.id)).toEqual(['mine'])
    expect(page.nextCursor).toBeNull()
  })

  it('returns the next cursor after the first matching page', async () => {
    const page = await loadSessionsForAgent(
      async () => ({
        items: [{ id: 'mine', agent_id: 'support', title: 'Support conversation' }],
        next_cursor: 'later',
      }),
      'support',
      null,
    )
    expect(page.sessions).toHaveLength(1)
    expect(page.nextCursor).toBe('later')
  })

  it('stops at the page cap and preserves the cursor', async () => {
    let calls = 0
    const page = await loadSessionsForAgent(async (): Promise<ChatSessionList> => {
      calls += 1
      return {
        items: [{ id: `other-${calls}`, agent_id: 'other-agent', title: 'Other' }],
        next_cursor: `cursor-${calls}`,
      }
    }, 'support', null)
    expect(calls).toBe(MAX_SESSION_PAGES)
    expect(page.sessions).toEqual([])
    expect(page.nextCursor).toBe(`cursor-${MAX_SESSION_PAGES}`)
  })
})
