import type { ChatSession, ChatSessionList } from '@/lib/types'

export const MAX_SESSION_PAGES = 20

export type SessionPage = {
  sessions: ChatSession[]
  nextCursor: string | null
}

/**
 * `GET /sessions` has no agent filter. Keep reading cursors until this page
 * contains a match, the catalog ends, or the page cap leaves a cursor to continue.
 */
export async function loadSessionsForAgent(
  fetchPage: (cursor: string | undefined) => Promise<ChatSessionList>,
  agentId: string,
  cursor: string | null,
): Promise<SessionPage> {
  const sessions: ChatSession[] = []
  let next: string | null = cursor
  for (let page = 0; page < MAX_SESSION_PAGES; page += 1) {
    const result = await fetchPage(next ?? undefined)
    const matched = result.items.filter((item) => item.agent_id === agentId)
    sessions.push(...matched)
    if (!result.next_cursor || matched.length > 0) {
      return { sessions, nextCursor: result.next_cursor }
    }
    next = result.next_cursor
  }
  return { sessions, nextCursor: next }
}
