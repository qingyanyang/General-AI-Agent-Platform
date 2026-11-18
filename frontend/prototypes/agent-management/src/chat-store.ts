/**
 * PROTOTYPE chat state (#53). Adapted from the production `useChatWorkspace`
 * hook: the same generation guards, stop handling, and 200/202/409 approval
 * outcomes, with selection driven by the URL and held above the routes so a
 * conversation survives a trip to Agent settings.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { isApiError } from '@/lib/errors'
import type { AgentRecord } from '@/lib/management'
import { approvalFromEvent } from '@/lib/sse'
import { loadSessionsForAgent } from '@/lib/sessions'
import type { ApprovalDecisionName, ChatMessage, ChatSession, PendingApproval, StreamEvent } from '@/lib/types'

import type { AssistantMedia, MediaAttachment } from './chat/media'
import { buildMediaReply, fixtureAttachment, mediaPlan, nextMediaId, usesScriptedTool } from './chat/media'
import { mockChatClient } from './mock/chat-client'
import { mockClient } from './mock/client'

const MESSAGE_MAX_LENGTH = 32_000
const TITLE_MAX_LENGTH = 60
const PERMISSION_MESSAGE = 'You can view this agent, but you cannot run it.'
const STOPPED_MESSAGE = 'Stopped.'
const INTERRUPTED_MESSAGE = 'The response was interrupted. It was not sent again.'

export type TranscriptEntry = {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'notice' | 'decision'
  content: string
  pending?: boolean
  toolName?: string
  args?: Record<string, unknown>
  attachments?: MediaAttachment[]
  media?: AssistantMedia
}

export type AgentState =
  | { kind: 'none' }
  | { kind: 'loading'; id: string }
  | { kind: 'ready'; agent: AgentRecord }
  | { kind: 'missing'; id: string }

export type SessionState =
  | { kind: 'none' }
  | { kind: 'loading'; id: string; session: ChatSession | null }
  | { kind: 'ready'; session: ChatSession }
  | { kind: 'unavailable'; id: string }
  | { kind: 'error'; id: string; message: string }

function historyRole(role: string): TranscriptEntry['role'] {
  switch (role) {
    case 'user':
    case 'assistant':
    case 'tool':
      return role
    default:
      return 'notice'
  }
}

function historyToEntries(messages: ChatMessage[], fixtures: MediaAttachment[][]): TranscriptEntry[] {
  return messages.map((message, index) => ({
    id: `history-${index}-${message.role}`,
    role: historyRole(message.role),
    content: message.content,
    toolName: message.role === 'tool' ? 'Tool' : undefined,
    attachments: message.role === 'user' && fixtures[index] && fixtures[index].length > 0 ? fixtures[index] : undefined,
  }))
}

async function entriesFromHistory(sessionId: string, messages: ChatMessage[]): Promise<TranscriptEntry[]> {
  const rows = mockChatClient.messageFixtures(sessionId)
  const fixtures = await Promise.all(
    messages.map(async (_message, index) => {
      const ids = rows[index] ?? []
      return Promise.all(ids.map((id) => fixtureAttachment(id)))
    }),
  )
  return historyToEntries(messages, fixtures)
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map((item) => item.id))
  const next = [...current]
  for (const item of incoming) {
    if (!seen.has(item.id)) {
      seen.add(item.id)
      next.push(item)
    }
  }
  return next
}

function titleFrom(content: string): string {
  const line = content.trim().split('\n')[0]
  return line.length > TITLE_MAX_LENGTH ? `${line.slice(0, TITLE_MAX_LENGTH - 1)}…` : line
}

function failureMessage(error: unknown): string {
  if (isApiError(error) && error.status === 409 && error.message === 'Agent is inactive') {
    return 'This agent is inactive, so it cannot run.'
  }
  return isApiError(error) ? error.message : 'Something went wrong.'
}

export function useChatState() {
  const [agentState, setAgentState] = useState<AgentState>({ kind: 'none' })
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [sessionCursor, setSessionCursor] = useState<string | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [sessionState, setSessionState] = useState<SessionState>({ kind: 'none' })
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [approval, setApproval] = useState<PendingApproval | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [deciding, setDeciding] = useState(false)
  const [creating, setCreating] = useState(false)
  const [permissionError, setPermissionError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [lastChatPath, setLastChatPath] = useState('/chat')

  const agentIdRef = useRef<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  /** Last conversation ID seen in the URL; the store can run ahead of it right after creating a chat. */
  const routeSessionRef = useRef<string | null>(null)
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const approvalRef = useRef(approval)
  approvalRef.current = approval
  const streamingRef = useRef(false)
  const decidingRef = useRef(false)
  const creatingRef = useRef(false)
  const activeRef = useRef(true)
  const agentGeneration = useRef(0)
  const openGeneration = useRef(0)
  const sessionLoadGeneration = useRef(0)
  const streamGeneration = useRef(0)
  const stoppedGeneration = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const draftIdRef = useRef<string | null>(null)
  const entrySeq = useRef(0)

  const nextId = (prefix: string) => {
    entrySeq.current += 1
    return `${prefix}-${entrySeq.current}`
  }

  const isStreamCurrent = (generation: number, sessionId: string) =>
    activeRef.current &&
    streamGeneration.current === generation &&
    stoppedGeneration.current !== generation &&
    sessionIdRef.current === sessionId

  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
      streamGeneration.current += 1
      abortRef.current?.abort()
    }
  }, [])

  const reportFailure = useCallback((error: unknown) => {
    if (!activeRef.current) {
      return
    }
    if (isApiError(error) && error.status === 403) {
      setPermissionError(PERMISSION_MESSAGE)
      return
    }
    setActionError(failureMessage(error))
  }, [])

  const detachStream = useCallback(() => {
    streamGeneration.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    streamingRef.current = false
    setStreaming(false)
  }, [])

  const clearConversation = useCallback(() => {
    detachStream()
    openGeneration.current += 1
    sessionIdRef.current = null
    setSessionState({ kind: 'none' })
    setEntries([])
    setApproval(null)
    setPermissionError(null)
    setActionError(null)
  }, [detachStream])

  const loadSessions = useCallback(
    async (agentId: string, cursor: string | null) => {
      const generation = ++sessionLoadGeneration.current
      setLoadingSessions(true)
      setSessionsError(null)
      try {
        const result = await loadSessionsForAgent(
          (next) => mockChatClient.listSessions(next),
          agentId,
          cursor,
        )
        if (!activeRef.current || sessionLoadGeneration.current !== generation || agentIdRef.current !== agentId) {
          return
        }
        setSessions((current) => (cursor ? mergeById(current, result.sessions) : result.sessions))
        setSessionCursor(result.nextCursor)
      } catch (error) {
        if (activeRef.current && sessionLoadGeneration.current === generation) {
          setSessionsError(isApiError(error) ? error.message : 'Conversations could not be loaded.')
        }
      } finally {
        if (activeRef.current && sessionLoadGeneration.current === generation) {
          setLoadingSessions(false)
        }
      }
    },
    [],
  )

  /** Called from the chat route whenever the agent in the URL changes. */
  const syncAgent = useCallback(
    async (agentId: string | null, known?: AgentRecord) => {
      if (agentId === agentIdRef.current) {
        if (known) {
          setAgentState((current) =>
            current.kind === 'ready' && current.agent.id === known.id ? { kind: 'ready', agent: known } : current,
          )
        }
        return
      }
      agentIdRef.current = agentId
      const generation = ++agentGeneration.current
      sessionLoadGeneration.current += 1
      setSessions([])
      setSessionCursor(null)
      setSessionsError(null)
      setLoadingSessions(false)
      clearConversation()
      if (!agentId) {
        setAgentState({ kind: 'none' })
        return
      }
      void loadSessions(agentId, null)
      if (known) {
        setAgentState({ kind: 'ready', agent: known })
        return
      }
      setAgentState({ kind: 'loading', id: agentId })
      try {
        const agent = await mockClient.getAgent(agentId)
        if (activeRef.current && agentGeneration.current === generation) {
          setAgentState({ kind: 'ready', agent })
        }
      } catch {
        if (activeRef.current && agentGeneration.current === generation) {
          setAgentState({ kind: 'missing', id: agentId })
        }
      }
    },
    [clearConversation, loadSessions],
  )

  const openSession = useCallback(
    async (sessionId: string) => {
      detachStream()
      const generation = ++openGeneration.current
      sessionIdRef.current = sessionId
      const listed = sessionsRef.current.find((item) => item.id === sessionId) ?? null
      setSessionState({ kind: 'loading', id: sessionId, session: listed })
      setEntries([])
      setApproval(null)
      setPermissionError(null)
      setActionError(null)
      try {
        const [session, messages, approvals] = await Promise.all([
          listed ?? mockChatClient.getSession(sessionId),
          mockChatClient.listMessages(sessionId),
          mockChatClient.listApprovals(sessionId),
        ])
        if (!activeRef.current || openGeneration.current !== generation) {
          return
        }
        if (session.agent_id !== agentIdRef.current) {
          setSessionState({ kind: 'unavailable', id: sessionId })
          return
        }
        setSessionState({ kind: 'ready', session })
        setEntries(await entriesFromHistory(session.id, messages))
        setApproval(approvals[0] ?? null)
      } catch (error) {
        if (!activeRef.current || openGeneration.current !== generation) {
          return
        }
        if (isApiError(error) && error.status === 404) {
          setSessionState({ kind: 'unavailable', id: sessionId })
          return
        }
        setSessionState({ kind: 'error', id: sessionId, message: failureMessage(error) })
      }
    },
    [detachStream],
  )

  /** Called from the chat route whenever the conversation in the URL changes. */
  const syncSession = useCallback(
    (sessionId: string | null) => {
      if (sessionId === routeSessionRef.current) {
        return
      }
      routeSessionRef.current = sessionId
      if (sessionId === sessionIdRef.current) {
        return
      }
      if (!sessionId) {
        clearConversation()
        return
      }
      void openSession(sessionId)
    },
    [clearConversation, openSession],
  )

  const refreshOpenSession = useCallback(async (sessionId: string) => {
    const generation = openGeneration.current
    const [messages, approvals] = await Promise.all([
      mockChatClient.listMessages(sessionId),
      mockChatClient.listApprovals(sessionId),
    ])
    if (!activeRef.current || sessionIdRef.current !== sessionId || openGeneration.current !== generation) {
      return
    }
    setEntries(await entriesFromHistory(sessionId, messages))
    setApproval(approvals[0] ?? null)
  }, [])

  const applyEvent = useCallback((event: StreamEvent, draftId: string) => {
    switch (event.type) {
      case 'message.delta':
        setEntries((current) =>
          current.map((entry) =>
            entry.id === draftId ? { ...entry, content: entry.content + event.content } : entry,
          ),
        )
        return
      case 'tool.start':
        setEntries((current) => {
          const draft = current.find((entry) => entry.id === draftId)
          const rest = current.filter((entry) => entry.id !== draftId)
          const tool: TranscriptEntry = {
            id: `tool-${event.tool_call_id}`,
            role: 'tool',
            content: '',
            pending: true,
            toolName: event.name,
          }
          return draft ? [...rest, tool, draft] : [...rest, tool]
        })
        return
      case 'tool.end':
        setEntries((current) =>
          current.map((entry) =>
            entry.id === `tool-${event.tool_call_id}`
              ? { ...entry, content: event.content, pending: false, toolName: event.name }
              : entry,
          ),
        )
        return
      case 'done':
        setEntries((current) =>
          current.map((entry) =>
            entry.id === draftId ? { ...entry, content: event.message.content, pending: false } : entry,
          ),
        )
        setApproval(null)
        return
      case 'approval.required':
        setEntries((current) =>
          current.map((entry) => (entry.id === draftId ? { ...entry, pending: false } : entry)),
        )
        setApproval(approvalFromEvent(event))
        return
      case 'error':
        setEntries((current) => [
          ...current.map((entry) => (entry.id === draftId ? { ...entry, pending: false } : entry)),
          { id: nextId('notice'), role: 'notice', content: event.message },
        ])
        return
      default: {
        const unreachable: never = event
        return unreachable
      }
    }
  }, [])

  const finishDraft = useCallback((draftId: string, notice: string) => {
    setEntries((current) => [
      ...current
        .filter((entry) => entry.id !== draftId || entry.content.trim() !== '')
        .map((entry) => (entry.id === draftId ? { ...entry, pending: false } : entry)),
      { id: nextId('notice'), role: 'notice', content: notice },
    ])
  }, [])

  const stream = useCallback(
    async (sessionId: string, content: string, attachments: MediaAttachment[] = []) => {
      const generation = ++streamGeneration.current
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      streamingRef.current = true
      const userId = nextId('user')
      const draftId = nextId('assistant')
      draftIdRef.current = draftId
      setStreaming(true)
      setPermissionError(null)
      setActionError(null)
      setEntries((current) => [
        ...current,
        { id: userId, role: 'user', content, attachments: attachments.length > 0 ? attachments : undefined },
        { id: draftId, role: 'assistant', content: '', pending: true },
      ])
      let received = false
      try {
        const terminal = await mockChatClient.streamMessage(sessionId, content, controller.signal, (event) => {
          if (!isStreamCurrent(generation, sessionId)) {
            return
          }
          received = true
          applyEvent(event, draftId)
        })
        if (!isStreamCurrent(generation, sessionId)) {
          return
        }
        if (terminal.kind === 'aborted') {
          finishDraft(draftId, STOPPED_MESSAGE)
          return
        }
        if (terminal.kind === 'interrupted') {
          finishDraft(draftId, INTERRUPTED_MESSAGE)
        }
      } catch (error) {
        if (!isStreamCurrent(generation, sessionId)) {
          return
        }
        if (!received) {
          setEntries((current) => current.filter((entry) => entry.id !== userId && entry.id !== draftId))
        } else {
          setEntries((current) =>
            current.map((entry) => (entry.id === draftId ? { ...entry, pending: false } : entry)),
          )
        }
        reportFailure(error)
        throw error
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
        }
        if (isStreamCurrent(generation, sessionId)) {
          streamingRef.current = false
          setStreaming(false)
        }
      }
    },
    [applyEvent, finishDraft, reportFailure],
  )

  const playMedia = useCallback(
    async (sessionId: string, content: string, attachments: MediaAttachment[]) => {
      const generation = ++streamGeneration.current
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      streamingRef.current = true
      const userId = nextId('user')
      const draftId = nextId('assistant')
      draftIdRef.current = draftId
      setStreaming(true)
      setPermissionError(null)
      setActionError(null)
      setEntries((current) => [
        ...current,
        { id: userId, role: 'user', content, attachments },
        { id: draftId, role: 'assistant', content: '', pending: true },
      ])
      const plan = mediaPlan(content, attachments)
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(resolve, 700)
          controller.signal.addEventListener(
            'abort',
            () => {
              window.clearTimeout(timer)
              reject(new DOMException('The operation was aborted.', 'AbortError'))
            },
            { once: true },
          )
        })
        if (!isStreamCurrent(generation, sessionId)) {
          return
        }
        if (plan.kind === 'text') {
          throw new Error('Expected a multimodal message.')
        }
        const reply = await buildMediaReply(plan)
        if (!isStreamCurrent(generation, sessionId)) {
          return
        }
        const files = reply.generated.map((draft) => ({
          id: nextMediaId('output'),
          name: draft.name,
          typeLabel: draft.typeLabel,
          size: draft.blob.size,
          kind: draft.kind,
          blob: draft.blob,
        }))
        const media: AssistantMedia = {
          ...reply.media,
          ...(files.length > 0 ? { files } : {}),
        }
        setEntries((current) =>
          current.map((entry) =>
            entry.id === draftId ? { ...entry, content: reply.content, pending: false, media } : entry,
          ),
        )
      } catch (error) {
        if (!isStreamCurrent(generation, sessionId)) {
          return
        }
        setEntries((current) => current.filter((entry) => entry.id !== userId && entry.id !== draftId))
        reportFailure(error)
        throw error
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
        }
        if (isStreamCurrent(generation, sessionId)) {
          streamingRef.current = false
          setStreaming(false)
        }
      }
    },
    [reportFailure],
  )

  /**
   * Sends into the open conversation, or creates one first when the user is on
   * the agent's start screen (`onCreated` lets the route follow the new session).
   * Resolves `false` when the message was not accepted, so the composer keeps the text.
   */
  const send = useCallback(
    async (
      content: string,
      onCreated: (session: ChatSession) => void,
      attachments: MediaAttachment[] = [],
    ): Promise<boolean> => {
      const trimmed = content.trim()
      const ready = attachments.filter((item) => item.status === 'ready')
      if ((!trimmed && ready.length === 0) || streamingRef.current || approvalRef.current || creatingRef.current) {
        return false
      }
      if (trimmed.length > MESSAGE_MAX_LENGTH) {
        setActionError(`A message can be at most ${MESSAGE_MAX_LENGTH.toLocaleString()} characters.`)
        return false
      }
      let sessionId = sessionIdRef.current
      if (!sessionId) {
        const agentId = agentIdRef.current
        if (!agentId) {
          return false
        }
        creatingRef.current = true
        setCreating(true)
        setPermissionError(null)
        setActionError(null)
        try {
          const session = await mockChatClient.createSession(agentId, titleFrom(trimmed || ready[0]?.name || 'New chat'))
          if (!activeRef.current || agentIdRef.current !== agentId) {
            return false
          }
          openGeneration.current += 1
          sessionIdRef.current = session.id
          sessionId = session.id
          setSessions((current) => mergeById([session], current))
          setSessionState({ kind: 'ready', session })
          setEntries([])
          setApproval(null)
          onCreated(session)
        } catch (error) {
          reportFailure(error)
          return false
        } finally {
          creatingRef.current = false
          if (activeRef.current) {
            setCreating(false)
          }
        }
      }
      try {
        const plan = mediaPlan(trimmed, ready)
        if (plan.kind === 'text' || usesScriptedTool(trimmed)) {
          await stream(sessionId, trimmed, ready)
        } else {
          await playMedia(sessionId, trimmed, ready)
        }
        return true
      } catch {
        return false
      }
    },
    [playMedia, reportFailure, stream],
  )

  const stop = useCallback(() => {
    const draftId = draftIdRef.current
    if (!sessionIdRef.current || !streamingRef.current || !draftId) {
      return
    }
    stoppedGeneration.current = streamGeneration.current
    abortRef.current?.abort()
    streamingRef.current = false
    setStreaming(false)
    finishDraft(draftId, STOPPED_MESSAGE)
  }, [finishDraft])

  const decide = useCallback(
    async (decision: ApprovalDecisionName) => {
      const sessionId = sessionIdRef.current
      const pending = approvalRef.current
      if (!sessionId || !pending || decidingRef.current) {
        return
      }
      decidingRef.current = true
      setDeciding(true)
      setPermissionError(null)
      setActionError(null)
      const record: TranscriptEntry = {
        id: nextId('decision'),
        role: 'decision',
        content: decision === 'approve' ? 'Approved' : 'Rejected',
        toolName: pending.tool_name,
        args: pending.arguments,
      }
      try {
        const result = await mockChatClient.decideApproval(
          sessionId,
          pending.interrupt_id,
          decision,
          pending.tool_call_id,
        )
        if (!activeRef.current || sessionIdRef.current !== sessionId) {
          return
        }
        if (result.status === 200) {
          setApproval(null)
          setEntries((current) => [
            ...current,
            record,
            { id: nextId('assistant'), role: 'assistant', content: result.message.content },
          ])
          return
        }
        if (result.status === 202) {
          setEntries((current) => [...current, record])
          setApproval(result.approval)
          return
        }
        const unreachable: never = result
        return unreachable
      } catch (error) {
        if (!activeRef.current || sessionIdRef.current !== sessionId) {
          return
        }
        if (isApiError(error) && error.status === 409) {
          setActionError('This approval was already decided elsewhere. The conversation was refreshed.')
          try {
            await refreshOpenSession(sessionId)
          } catch (refreshError) {
            reportFailure(refreshError)
          }
          return
        }
        reportFailure(error)
      } finally {
        decidingRef.current = false
        if (activeRef.current) {
          setDeciding(false)
        }
      }
    },
    [refreshOpenSession, reportFailure],
  )

  const loadMoreSessions = useCallback(() => {
    const agentId = agentIdRef.current
    if (agentId && sessionCursor) {
      void loadSessions(agentId, sessionCursor)
    }
  }, [loadSessions, sessionCursor])

  const retrySessions = useCallback(() => {
    const agentId = agentIdRef.current
    if (agentId) {
      void loadSessions(agentId, null)
    }
  }, [loadSessions])

  const retryOpen = useCallback(() => {
    const sessionId = sessionIdRef.current
    if (sessionId) {
      void openSession(sessionId)
    }
  }, [openSession])

  /** Keeps the header in sync after Details or deactivation saves elsewhere. */
  const agentChanged = useCallback((agent: AgentRecord) => {
    setAgentState((current) =>
      current.kind === 'ready' && current.agent.id === agent.id ? { kind: 'ready', agent } : current,
    )
  }, [])

  const dismissErrors = useCallback(() => {
    setPermissionError(null)
    setActionError(null)
  }, [])

  return {
    agentState,
    sessions,
    sessionCursor,
    loadingSessions,
    sessionsError,
    sessionState,
    entries,
    approval,
    streaming,
    deciding,
    creating,
    permissionError,
    actionError,
    lastChatPath,
    setLastChatPath,
    syncAgent,
    syncSession,
    send,
    stop,
    decide,
    loadMoreSessions,
    retrySessions,
    retryOpen,
    agentChanged,
    dismissErrors,
  }
}

export type ChatStore = ReturnType<typeof useChatState>