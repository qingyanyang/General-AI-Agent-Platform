import { apiErrorFromResponse, ApiError } from '@/lib/errors'
import { consumeEventStream } from '@/lib/sse'
import type {
  Agent,
  AgentList,
  ApprovalDecisionName,
  ApprovalDecisionResult,
  ChatClient,
  ChatMessage,
  ChatSession,
  ChatSessionList,
  PendingApproval,
  StreamEvent,
  StreamTerminal,
} from '@/lib/types'

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? ''

/** Public API origin from build-time env (Azure Static Web Apps / local `.env`). */
export const apiBaseUrl = configuredBaseUrl.replace(/\/$/, '')

export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return apiBaseUrl ? `${apiBaseUrl}${normalized}` : normalized
}

const PAGE_LIMIT = 100

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unexpectedResponse(): ApiError {
  return new ApiError(500, 'The server returned an unexpected response.')
}

function parseAgent(value: unknown): Agent | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.status !== 'string' ||
    !(typeof value.description === 'string' || value.description === null)
  ) {
    return null
  }
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    status: value.status,
  }
}

function parseAgentList(value: unknown): AgentList {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw unexpectedResponse()
  }
  const items: Agent[] = []
  for (const item of value.items) {
    const agent = parseAgent(item)
    if (!agent) {
      throw unexpectedResponse()
    }
    items.push(agent)
  }
  const nextCursor = value.next_cursor
  if (!(typeof nextCursor === 'string' || nextCursor === null)) {
    throw unexpectedResponse()
  }
  return { items, next_cursor: nextCursor }
}

function parseSession(value: unknown): ChatSession | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.agent_id !== 'string' ||
    typeof value.title !== 'string'
  ) {
    return null
  }
  return { id: value.id, agent_id: value.agent_id, title: value.title }
}

function parseSessionList(value: unknown): ChatSessionList {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw unexpectedResponse()
  }
  const items: ChatSession[] = []
  for (const item of value.items) {
    const session = parseSession(item)
    if (!session) {
      throw unexpectedResponse()
    }
    items.push(session)
  }
  const nextCursor = value.next_cursor
  if (!(typeof nextCursor === 'string' || nextCursor === null)) {
    throw unexpectedResponse()
  }
  return { items, next_cursor: nextCursor }
}

function parseMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value) || typeof value.role !== 'string' || typeof value.content !== 'string') {
    return null
  }
  return { role: value.role, content: value.content }
}

function parseMessages(value: unknown): ChatMessage[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw unexpectedResponse()
  }
  return value.items.map((item) => {
    const message = parseMessage(item)
    if (!message) {
      throw unexpectedResponse()
    }
    return message
  })
}

function parseApproval(value: unknown): PendingApproval | null {
  if (
    !isRecord(value) ||
    typeof value.execution_id !== 'string' ||
    typeof value.interrupt_id !== 'string' ||
    typeof value.checkpoint_id !== 'string' ||
    typeof value.tool_call_id !== 'string' ||
    typeof value.tool_name !== 'string' ||
    !isRecord(value.arguments)
  ) {
    return null
  }
  return {
    execution_id: value.execution_id,
    interrupt_id: value.interrupt_id,
    checkpoint_id: value.checkpoint_id,
    tool_call_id: value.tool_call_id,
    tool_name: value.tool_name,
    arguments: value.arguments,
  }
}

function parseApprovals(value: unknown): PendingApproval[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw unexpectedResponse()
  }
  return value.items.map((item) => {
    const approval = parseApproval(item)
    if (!approval) {
      throw unexpectedResponse()
    }
    return approval
  })
}

function parseDecision(status: number, value: unknown): ApprovalDecisionResult {
  if (status === 200) {
    if (!isRecord(value) || typeof value.execution_id !== 'string') {
      throw unexpectedResponse()
    }
    const message = parseMessage(value.message)
    if (!message) {
      throw unexpectedResponse()
    }
    return { status: 200, executionId: value.execution_id, message }
  }
  if (status === 202) {
    const approval = parseApproval(value)
    if (!approval) {
      throw unexpectedResponse()
    }
    return { status: 202, approval }
  }
  throw unexpectedResponse()
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw await apiErrorFromResponse(response)
  }
  return (await response.json()) as unknown
}

export function createChatClient(
  getAccessToken: (cacheMode?: 'off') => Promise<string>,
): ChatClient {
  async function authorizedFetch(
    path: string,
    init: RequestInit = {},
    cacheMode?: 'off',
  ): Promise<Response> {
    const token = await getAccessToken(cacheMode)
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    if (init.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    return fetch(apiUrl(path), { ...init, headers })
  }

  function pageQuery(cursor?: string): string {
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT) })
    if (cursor) {
      params.set('cursor', cursor)
    }
    return params.toString()
  }

  return {
    async listAgents(cursor?: string) {
      const path = `/agents?${pageQuery(cursor)}`
      const response = await authorizedFetch(path)
      if (response.status === 401) {
        const retried = await authorizedFetch(path, {}, 'off')
        return parseAgentList(await readJson(retried))
      }
      return parseAgentList(await readJson(response))
    },
    async listSessions(cursor?: string) {
      const response = await authorizedFetch(`/sessions?${pageQuery(cursor)}`)
      return parseSessionList(await readJson(response))
    },
    async createSession(agentId: string, title?: string) {
      const body: { agent_id: string; title?: string } = { agent_id: agentId }
      if (title !== undefined) {
        body.title = title
      }
      const response = await authorizedFetch('/sessions', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const session = parseSession(await readJson(response))
      if (!session) {
        throw unexpectedResponse()
      }
      return session
    },
    async deleteSession(sessionId: string) {
      const response = await authorizedFetch(`/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        throw await apiErrorFromResponse(response)
      }
    },
    async listMessages(sessionId: string) {
      const response = await authorizedFetch(`/sessions/${encodeURIComponent(sessionId)}/messages`)
      return parseMessages(await readJson(response))
    },
    async listApprovals(sessionId: string) {
      const response = await authorizedFetch(`/sessions/${encodeURIComponent(sessionId)}/approvals`)
      return parseApprovals(await readJson(response))
    },
    async streamMessage(
      sessionId: string,
      content: string,
      signal: AbortSignal,
      onEvent: (event: StreamEvent) => void,
    ): Promise<StreamTerminal> {
      let response: Response
      try {
        response = await authorizedFetch(
          `/sessions/${encodeURIComponent(sessionId)}/messages/stream`,
          {
            method: 'POST',
            body: JSON.stringify({ content }),
            signal,
          },
        )
      } catch (error) {
        if (signal.aborted) {
          return { kind: 'aborted' }
        }
        throw error
      }
      const cancelBody = () => {
        void response.body?.cancel()
      }
      if (signal.aborted) {
        cancelBody()
        return { kind: 'aborted' }
      }
      signal.addEventListener('abort', cancelBody, { once: true })
      try {
        const terminal = await consumeEventStream(response, onEvent)
        if (signal.aborted) {
          return { kind: 'aborted' }
        }
        return terminal
      } catch (error) {
        if (signal.aborted) {
          return { kind: 'aborted' }
        }
        throw error
      } finally {
        signal.removeEventListener('abort', cancelBody)
      }
    },
    async decideApproval(
      sessionId: string,
      interruptId: string,
      decision: ApprovalDecisionName,
      toolCallId: string,
    ): Promise<ApprovalDecisionResult> {
      const response = await authorizedFetch(
        `/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(interruptId)}/${decision}`,
        {
          method: 'POST',
          body: JSON.stringify({ tool_call_id: toolCallId }),
        },
      )
      if (response.status !== 200 && response.status !== 202) {
        throw await apiErrorFromResponse(response)
      }
      return parseDecision(response.status, (await response.json()) as unknown)
    },
  }
}
