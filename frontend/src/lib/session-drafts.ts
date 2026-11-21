import type { ChatMessage, ChatSession } from '@/lib/types'

export const DEFAULT_SESSION_TITLE = 'New chat'
export const SESSION_TITLE_MAX_LENGTH = 255

/** First-line title for a new session, matching the agent-management prototype. */
export function titleFromMessage(content: string): string {
  const line = content.trim().split('\n')[0] ?? ''
  if (!line) {
    return DEFAULT_SESSION_TITLE
  }
  if (line.length > SESSION_TITLE_MAX_LENGTH) {
    return `${line.slice(0, SESSION_TITLE_MAX_LENGTH - 1)}…`
  }
  return line
}

type DraftOps = {
  listMessages: (sessionId: string) => Promise<ChatMessage[]>
  deleteSession: (sessionId: string) => Promise<void>
}

/**
 * Archive leftover empty "New chat" drafts (created by older create-on-click behavior)
 * so selecting an agent does not show a stack of identical empty rows.
 */
export async function pruneEmptyDraftSessions(
  sessions: ChatSession[],
  ops: DraftOps,
): Promise<ChatSession[]> {
  const draftIds = sessions
    .filter((session) => session.title === DEFAULT_SESSION_TITLE)
    .map((session) => session.id)
  if (draftIds.length === 0) {
    return sessions
  }

  const emptyIds = new Set<string>()
  await Promise.all(
    draftIds.map(async (sessionId) => {
      try {
        const messages = await ops.listMessages(sessionId)
        if (messages.length === 0) {
          await ops.deleteSession(sessionId)
          emptyIds.add(sessionId)
        }
      } catch {
        // Keep the row if probe/archive fails; the user can still open it.
      }
    }),
  )

  if (emptyIds.size === 0) {
    return sessions
  }
  return sessions.filter((session) => !emptyIds.has(session.id))
}
