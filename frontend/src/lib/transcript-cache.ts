import type { ChatMessage, PendingApproval } from '@/lib/types'

const LIMIT = 5

export type CachedTranscript = {
  messages: ChatMessage[]
  approval: PendingApproval | null
}

const entries = new Map<string, CachedTranscript>()
const recent: string[] = []

function touch(sessionId: string) {
  const index = recent.indexOf(sessionId)
  if (index !== -1) {
    recent.splice(index, 1)
  }
  recent.push(sessionId)
  while (recent.length > LIMIT) {
    const oldest = recent.shift()
    if (oldest) {
      entries.delete(oldest)
    }
  }
}

export function readTranscript(sessionId: string): CachedTranscript | null {
  const cached = entries.get(sessionId)
  if (!cached) {
    return null
  }
  touch(sessionId)
  return cached
}

export function writeTranscript(sessionId: string, value: CachedTranscript) {
  entries.set(sessionId, value)
  touch(sessionId)
}

export function dropTranscript(sessionId: string) {
  entries.delete(sessionId)
  const index = recent.indexOf(sessionId)
  if (index !== -1) {
    recent.splice(index, 1)
  }
}

export function clearTranscriptCache() {
  entries.clear()
  recent.length = 0
}
