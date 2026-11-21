import { useCallback, useEffect, useRef, useState } from 'react'

import { isApiError } from '@/lib/errors'
import { approvalFromEvent } from '@/lib/sse'
import { pruneEmptyDraftSessions, titleFromMessage } from '@/lib/session-drafts'
import { dropTranscript, readTranscript, writeTranscript } from '@/lib/transcript-cache'
import { loadSessionsForAgent } from '@/lib/sessions'
import type {
  Agent,
  ApprovalDecisionName,
  ChatClient,
  ChatMessage,
  ChatSession,
  PendingApproval,
  StreamEvent,
} from '@/lib/types'

const MESSAGE_MAX_LENGTH = 32_000
const PERMISSION_MESSAGE = 'You can view this agent, but you cannot run it.'
const UNAVAILABLE_MESSAGE = 'This conversation is unavailable.'
const INTERRUPTED_MESSAGE = 'The response was interrupted. It was not sent again.'
const STOPPED_MESSAGE = 'Stopped.'

export type TranscriptEntry = {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'notice'
  content: string
  pending?: boolean
  toolName?: string
}

type Snapshot = {
  session: ChatSession | null
  entries: TranscriptEntry[]
  approval: PendingApproval | null
}

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

function historyToEntries(messages: ChatMessage[]): TranscriptEntry[] {
  return messages.map((message, index) => ({
    id: `history-${index}-${message.role}`,
    role: historyRole(message.role),
    content: message.content,
    toolName: message.role === 'tool' ? 'Tool' : undefined,
  }))
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map((item) => item.id))
  const next = [...current]
  for (const item of incoming) {
    if (seen.has(item.id)) {
      continue
    }
    seen.add(item.id)
    next.push(item)
  }
  return next
}

export function useChatWorkspace(client: ChatClient, onUnauthorized: () => void) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [agentCursor, setAgentCursor] = useState<string | null>(null)
  const [loadingAgents, setLoadingAgents] = useState(true)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [sessionCursor, setSessionCursor] = useState<string | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [selectedSession, setSelectedSession] = useState<ChatSession | null>(null)
  /** When true, show the agent intro and ignore a stale session id in the URL. */
  const [preferNewChat, setPreferNewChat] = useState(false)
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [approval, setApproval] = useState<PendingApproval | null>(null)
  const [loadingSession, setLoadingSession] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [deciding, setDeciding] = useState(false)
  const [creating, setCreating] = useState(false)
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)
  const [permissionError, setPermissionError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [sessionNotice, setSessionNotice] = useState<string | null>(null)

  const onUnauthorizedRef = useRef(onUnauthorized)
  onUnauthorizedRef.current = onUnauthorized
  const selectedAgentRef = useRef(selectedAgent)
  selectedAgentRef.current = selectedAgent
  const selectedSessionRef = useRef(selectedSession)
  selectedSessionRef.current = selectedSession
  const preferNewChatRef = useRef(preferNewChat)
  preferNewChatRef.current = preferNewChat
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const approvalRef = useRef(approval)
  approvalRef.current = approval
  const streamingRef = useRef(streaming)
  streamingRef.current = streaming

  const activeRef = useRef(true)
  const decidingRef = useRef(false)
  const creatingRef = useRef(false)
  const streamGeneration = useRef(0)
  const openGeneration = useRef(0)
  const sessionLoadGeneration = useRef(0)
  const prunedAgents = useRef(new Set<string>())
  const abortRef = useRef<AbortController | null>(null)
  const entrySeq = useRef(0)
  const draftIdRef = useRef<string | null>(null)
  const stoppedGeneration = useRef(0)

  const nextId = (prefix: string) => {
    entrySeq.current += 1
    return `${prefix}-${entrySeq.current}`
  }

  const isStreamCurrent = (generation: number, sessionId: string) =>
    activeRef.current &&
    streamGeneration.current === generation &&
    selectedSessionRef.current?.id === sessionId

  const reportFailure = useCallback((error: unknown) => {
    if (!activeRef.current) {
      return
    }
    if (isApiError(error) && error.status === 401) {
      onUnauthorizedRef.current()
      return
    }
    if (isApiError(error) && error.status === 403) {
      setPermissionError(PERMISSION_MESSAGE)
      return
    }
    setActionError(isApiError(error) ? error.message : 'Something went wrong.')
  }, [])

  const detachStream = useCallback(() => {
    streamGeneration.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    streamingRef.current = false
    setStreaming(false)
  }, [])

  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
      streamGeneration.current += 1
      abortRef.current?.abort()
    }
  }, [])

  const loadAgents = useCallback(
    async (cursor: string | null) => {
      setLoadingAgents(true)
      setActionError(null)
      try {
        const page = await client.listAgents(cursor ?? undefined)
        if (!activeRef.current) {
          return
        }
        setAgents((current) => (cursor ? mergeById(current, page.items) : page.items))
        setAgentCursor(page.next_cursor)
      } catch (error) {
        reportFailure(error)
      } finally {
        if (activeRef.current) {
          setLoadingAgents(false)
        }
      }
    },
    [client, reportFailure],
  )

  useEffect(() => {
    void loadAgents(null)
  }, [loadAgents])

  const loadSessions = useCallback(
    async (agentId: string, cursor: string | null) => {
      const generation = ++sessionLoadGeneration.current
      setLoadingSessions(true)
      try {
        const page = await loadSessionsForAgent(
          (nextCursor) => client.listSessions(nextCursor),
          agentId,
          cursor,
        )
        if (!activeRef.current || sessionLoadGeneration.current !== generation) {
          return
        }
        if (selectedAgentRef.current?.id !== agentId) {
          return
        }
        // Fresh loads: drop empty "New chat" drafts once per agent, not on every reload.
        let sessions = page.sessions
        if (cursor === null && !prunedAgents.current.has(agentId)) {
          sessions = await pruneEmptyDraftSessions(page.sessions, {
            listMessages: (sessionId) => client.listMessages(sessionId),
            deleteSession: (sessionId) => client.deleteSession(sessionId),
          })
          prunedAgents.current.add(agentId)
        }
        if (!activeRef.current || sessionLoadGeneration.current !== generation) {
          return
        }
        if (selectedAgentRef.current?.id !== agentId) {
          return
        }
        setSessions((current) => (cursor ? mergeById(current, sessions) : sessions))
        setSessionCursor(page.nextCursor)
      } catch (error) {
        if (activeRef.current && sessionLoadGeneration.current === generation) {
          reportFailure(error)
        }
      } finally {
        if (activeRef.current && sessionLoadGeneration.current === generation) {
          setLoadingSessions(false)
        }
      }
    },
    [client, reportFailure],
  )

  const selectAgent = useCallback(
    (agent: Agent, options?: { preferNewChat?: boolean }) => {
      const switching = selectedAgentRef.current?.id !== agent.id
      const landOnIntro = options?.preferNewChat ?? true
      if (!switching) {
        if (!landOnIntro) {
          return
        }
        if (!preferNewChatRef.current || selectedSessionRef.current) {
          preferNewChatRef.current = true
          setPreferNewChat(true)
          if (selectedSessionRef.current) {
            detachStream()
            selectedSessionRef.current = null
            setSelectedSession(null)
            setEntries([])
            setApproval(null)
          }
        }
        return
      }
      selectedAgentRef.current = agent
      setSelectedAgent(agent)
      setPermissionError(null)
      setActionError(null)
      setSessionNotice(null)
      // Match prototype: picking an agent lands on the empty intro (unless hydrating a
      // deep-linked session). Session rows are created on first send, not on select.
      if (switching || selectedSessionRef.current) {
        detachStream()
        selectedSessionRef.current = null
        setSelectedSession(null)
        setEntries([])
        setApproval(null)
      }
      setPreferNewChat(landOnIntro)
      void loadSessions(agent.id, null)
    },
    [detachStream, loadSessions],
  )

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
        setEntries((current) => [
          ...current,
          {
            id: `tool-${event.tool_call_id}`,
            role: 'tool',
            content: '',
            pending: true,
            toolName: event.name,
          },
        ])
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
            entry.id === draftId
              ? { ...entry, content: event.message.content, pending: false, role: 'assistant' }
              : entry,
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

  const openSession = useCallback(
    async (session: ChatSession) => {
      const snapshot: Snapshot = {
        session: selectedSessionRef.current,
        entries: entriesRef.current,
        approval: approvalRef.current,
      }
      detachStream()
      const generation = ++openGeneration.current
      const cached = readTranscript(session.id)
      setPreferNewChat(false)
      selectedSessionRef.current = session
      setSelectedSession(session)
      setEntries(cached ? historyToEntries(cached.messages) : [])
      setApproval(cached?.approval ?? null)
      setPermissionError(null)
      setActionError(null)
      setSessionNotice(null)
      setLoadingSession(!cached)
      try {
        const [messages, approvals] = await Promise.all([
          client.listMessages(session.id),
          client.listApprovals(session.id),
        ])
        const approval = approvals[0] ?? null
        writeTranscript(session.id, { messages, approval })
        if (!activeRef.current || openGeneration.current !== generation) {
          return
        }
        setEntries(historyToEntries(messages))
        setApproval(approval)
      } catch (error) {
        if (!activeRef.current || openGeneration.current !== generation) {
          return
        }
        if (isApiError(error) && error.status === 404) {
          dropTranscript(session.id)
          setSelectedSession(snapshot.session)
          setEntries(snapshot.entries)
          setApproval(snapshot.approval)
          setSessionNotice(UNAVAILABLE_MESSAGE)
          return
        }
        if (cached) {
          return
        }
        setSelectedSession(snapshot.session)
        setEntries(snapshot.entries)
        setApproval(snapshot.approval)
        reportFailure(error)
      } finally {
        if (activeRef.current && openGeneration.current === generation) {
          setLoadingSession(false)
        }
      }
    },
    [client, detachStream, reportFailure],
  )

  const refreshOpenSession = useCallback(
    async (sessionId: string) => {
      const generation = openGeneration.current
      const [messages, approvals] = await Promise.all([
        client.listMessages(sessionId),
        client.listApprovals(sessionId),
      ])
      const approval = approvals[0] ?? null
      writeTranscript(sessionId, { messages, approval })
      if (
        !activeRef.current ||
        selectedSessionRef.current?.id !== sessionId ||
        openGeneration.current !== generation
      ) {
        return
      }
      setEntries(historyToEntries(messages))
      setApproval(approval)
    },
    [client],
  )

  const send = useCallback(
    async (content: string) => {
      const agent = selectedAgentRef.current
      const trimmed = content.trim()
      if (!agent || streamingRef.current || approvalRef.current || !trimmed) {
        return
      }
      if (trimmed.length > MESSAGE_MAX_LENGTH) {
        setActionError(`A message can be at most ${MESSAGE_MAX_LENGTH} characters.`)
        return
      }

      let session = selectedSessionRef.current
      if (session) {
        dropTranscript(session.id)
      }
      if (!session) {
        if (creatingRef.current) {
          return
        }
        creatingRef.current = true
        setCreating(true)
        setPermissionError(null)
        setActionError(null)
        try {
          session = await client.createSession(agent.id, titleFromMessage(trimmed))
          if (!activeRef.current || selectedAgentRef.current?.id !== agent.id) {
            return
          }
          setPreferNewChat(false)
          setSessions((current) => mergeById([session!], current))
          setSelectedSession(session)
          setEntries([])
          setApproval(null)
        } catch (error) {
          reportFailure(error)
          return
        } finally {
          creatingRef.current = false
          if (activeRef.current) {
            setCreating(false)
          }
        }
      }

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
        { id: userId, role: 'user', content: trimmed },
        { id: draftId, role: 'assistant', content: '', pending: true },
      ])
      let received = false
      try {
        const terminal = await client.streamMessage(
          session.id,
          trimmed,
          controller.signal,
          (event) => {
            if (
              !isStreamCurrent(generation, session!.id) ||
              stoppedGeneration.current === generation
            ) {
              return
            }
            received = true
            applyEvent(event, draftId)
          },
        )
        if (
          !isStreamCurrent(generation, session.id) ||
          stoppedGeneration.current === generation
        ) {
          return
        }
        if (terminal.kind === 'aborted') {
          setEntries((current) => [
            ...current
              .filter((entry) => entry.id !== draftId || entry.content.trim() !== '')
              .map((entry) => (entry.id === draftId ? { ...entry, pending: false } : entry)),
            { id: nextId('notice'), role: 'notice', content: STOPPED_MESSAGE },
          ])
          return
        }
        if (terminal.kind === 'interrupted') {
          setEntries((current) => [
            ...current.map((entry) =>
              entry.id === draftId ? { ...entry, pending: false } : entry,
            ),
            { id: nextId('notice'), role: 'notice', content: INTERRUPTED_MESSAGE },
          ])
        }
      } catch (error) {
        if (
          !isStreamCurrent(generation, session.id) ||
          stoppedGeneration.current === generation
        ) {
          return
        }
        if (!received) {
          setEntries((current) =>
            current.filter((entry) => entry.id !== userId && entry.id !== draftId),
          )
        } else {
          setEntries((current) =>
            current.map((entry) => (entry.id === draftId ? { ...entry, pending: false } : entry)),
          )
        }
        reportFailure(error)
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
        }
        if (
          isStreamCurrent(generation, session.id) &&
          stoppedGeneration.current !== generation
        ) {
          streamingRef.current = false
          setStreaming(false)
        }
      }
    },
    [applyEvent, client, reportFailure],
  )

  const stop = useCallback(() => {
    const session = selectedSessionRef.current
    const draftId = draftIdRef.current
    if (!session || !streamingRef.current || !draftId) {
      return
    }
    const generation = streamGeneration.current
    stoppedGeneration.current = generation
    abortRef.current?.abort()
    streamingRef.current = false
    setStreaming(false)
    setEntries((current) => [
      ...current
        .filter((entry) => entry.id !== draftId || entry.content.trim() !== '')
        .map((entry) => (entry.id === draftId ? { ...entry, pending: false } : entry)),
      { id: nextId('notice'), role: 'notice', content: STOPPED_MESSAGE },
    ])
  }, [])

  const decide = useCallback(
    async (decision: ApprovalDecisionName) => {
      const session = selectedSessionRef.current
      const pending = approvalRef.current
      if (!session || !pending || decidingRef.current) {
        return
      }
      decidingRef.current = true
      dropTranscript(session.id)
      setDeciding(true)
      setPermissionError(null)
      setActionError(null)
      try {
        const result = await client.decideApproval(
          session.id,
          pending.interrupt_id,
          decision,
          pending.tool_call_id,
        )
        if (!activeRef.current || selectedSessionRef.current?.id !== session.id) {
          return
        }
        if (result.status === 200) {
          setApproval(null)
          setEntries((current) => [
            ...current,
            {
              id: nextId('assistant'),
              role: 'assistant',
              content: result.message.content,
            },
          ])
          return
        }
        if (result.status === 202) {
          setApproval(result.approval)
          return
        }
        const unreachable: never = result
        return unreachable
      } catch (error) {
        if (!activeRef.current || selectedSessionRef.current?.id !== session.id) {
          return
        }
        if (isApiError(error) && error.status === 409) {
          try {
            await refreshOpenSession(session.id)
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
    [client, refreshOpenSession, reportFailure],
  )

  const deleteSession = useCallback(
    async (sessionId: string) => {
      if (deletingSessionId) {
        return
      }
      setDeletingSessionId(sessionId)
      setActionError(null)
      try {
        await client.deleteSession(sessionId)
        dropTranscript(sessionId)
        if (!activeRef.current) {
          return
        }
        setSessions((current) => current.filter((session) => session.id !== sessionId))
        if (selectedSessionRef.current?.id === sessionId) {
          detachStream()
          setPreferNewChat(true)
          setSelectedSession(null)
          setEntries([])
          setApproval(null)
        }
      } catch (error) {
        reportFailure(error)
      } finally {
        if (activeRef.current) {
          setDeletingSessionId(null)
        }
      }
    },
    [client, deletingSessionId, detachStream, reportFailure],
  )

  /** Prototype-aligned: New chat clears the open conversation; session is created on first send. */
  const createChat = useCallback(() => {
    const agent = selectedAgentRef.current
    if (!agent) {
      return
    }
    detachStream()
    setPreferNewChat(true)
    setSelectedSession(null)
    setEntries([])
    setApproval(null)
    setPermissionError(null)
    setActionError(null)
    setSessionNotice(null)
  }, [detachStream])

  return {
    agents,
    agentCursor,
    loadingAgents,
    selectedAgent,
    sessions,
    sessionCursor,
    loadingSessions,
    selectedSession,
    preferNewChat,
    entries,
    approval,
    loadingSession,
    streaming,
    deciding,
    creating,
    deletingSessionId,
    permissionError,
    actionError,
    sessionNotice,
    loadMoreAgents: () => {
      if (agentCursor) {
        void loadAgents(agentCursor)
      }
    },
    loadMoreSessions: () => {
      const agent = selectedAgentRef.current
      if (agent && sessionCursor) {
        void loadSessions(agent.id, sessionCursor)
      }
    },
    selectAgent,
    openSession,
    createChat,
    deleteSession,
    send,
    stop,
    decide,
    abandon: detachStream,
  }
}
