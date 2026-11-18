/**
 * PROTOTYPE mock chat API (#53). In-memory stand-in for the session endpoints.
 * Streams are real `text/event-stream` Responses parsed by the production
 * `consumeEventStream`, so stop, interruption, and stale-event handling run the
 * same code paths as the live app. Replies are scripted from the agent's saved
 * configuration; no model or network is involved.
 */
import type { AgentConfiguration, AgentRecord } from '@/lib/management'
import { AGENTS_EXECUTE, AGENTS_READ } from '@/lib/permissions'
import { consumeEventStream } from '@/lib/sse'
import type {
  ApprovalDecisionName,
  ApprovalDecisionResult,
  ChatMessage,
  ChatSession,
  ChatSessionList,
  PendingApproval,
  StreamEvent,
  StreamTerminal,
} from '@/lib/types'

import { seedSessions, type MockSession, type PendingRun, type ToolStep } from './chat-data'
import {
  addExecution,
  caller,
  callerCanExecuteAgent,
  callerCanView,
  deny,
  emptyScenario,
  findAgent,
  findConfiguration,
  has,
  onMockReset,
  page,
  patchExecution,
  respond,
  scenarioError,
  wait,
  type Outcome,
} from './client'
import { mockUuid } from './data'
import { appendLog, getOptions, setOptions } from './options'

const SESSION_PAGE = 6

let sessions: MockSession[] = seedSessions()
let seq = 0

onMockReset(() => {
  sessions = seedSessions()
})

function nextUuid(): string {
  seq += 1
  return mockUuid(90_000 + seq)
}

function toChatSession(session: MockSession): ChatSession {
  return { id: session.id, agent_id: session.agent_id, title: session.title }
}

function ownSession(id: string): MockSession | undefined {
  return sessions.find((session) => session.id === id && session.owner === caller().userId)
}

function updateSession(id: string, change: (session: MockSession) => MockSession) {
  sessions = sessions.map((session) => (session.id === id ? change(session) : session))
}

function appendMessages(id: string, ...messages: ChatMessage[]) {
  updateSession(id, (session) => ({ ...session, messages: [...session.messages, ...messages] }))
}

function readableSession(id: string): Outcome<MockSession> {
  if (!has(AGENTS_READ)) {
    return deny()
  }
  const session = ownSession(id)
  if (!session || session.unavailable) {
    return { status: 404, error: 'Session not found' }
  }
  if (!callerCanView(session.agent_id)) {
    return { status: 403, error: 'Agent access denied' }
  }
  return { status: 200, body: session }
}

/** Backend order: 404 missing → 403 no execute grant → 409 inactive. */
function executableAgent(agentId: string): Outcome<AgentRecord> {
  if (!has(AGENTS_EXECUTE)) {
    return deny()
  }
  const agent = findAgent(agentId)
  if (!agent) {
    return { status: 404, error: 'Agent not found' }
  }
  if (!callerCanExecuteAgent(agentId)) {
    return { status: 403, error: 'Agent access denied' }
  }
  if (agent.status !== 'active') {
    return { status: 409, error: 'Agent is inactive' }
  }
  return { status: 200, body: agent }
}

function round(value: number): string {
  return String(Math.round(value * 100) / 100)
}

function needsApproval(agentId: string, tool: string): boolean {
  return findConfiguration(agentId)?.approval_tool_names.includes(tool) ?? false
}

function approvalFor(executionId: string, step: ToolStep): PendingApproval {
  return {
    execution_id: executionId,
    interrupt_id: nextUuid(),
    checkpoint_id: nextUuid(),
    tool_call_id: `call_mock_${step.tool}_${seq}`,
    tool_name: step.tool,
    arguments: step.args,
  }
}

type Reply = { steps: ToolStep[]; text: string }

function requestedTool(lower: string): string | null {
  if (/\b(multiply|times|product)\b|×/.test(lower)) {
    return 'multiply'
  }
  if (/\b(add|plus|sum)\b|\+/.test(lower)) {
    return 'add'
  }
  if (/\becho\b/.test(lower)) {
    return 'echo'
  }
  return null
}

function configTable(agent: AgentRecord, config: AgentConfiguration): string {
  const tools = config.tool_names.length ? config.tool_names.map((name) => `\`${name}\``).join(', ') : 'None'
  const approvals = config.approval_tool_names.length
    ? config.approval_tool_names.map((name) => `\`${name}\``).join(', ')
    : 'None'
  return `| Setting | Value |
| --- | --- |
| Agent | ${agent.name} |
| Model | ${config.llm_provider}/${config.llm_model} |
| Temperature | ${config.temperature ?? 'Not supported'} |
| Tools | ${tools} |
| Needs approval | ${approvals} |`
}

function scriptReply(agent: AgentRecord, config: AgentConfiguration, content: string): Reply {
  const lower = content.toLowerCase()
  const numbers = (content.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  const tool = requestedTool(lower)

  if (tool && !config.tool_names.includes(tool)) {
    return {
      steps: [],
      text: `**${agent.name}** doesn't have the \`${tool}\` tool turned on, so I can't run it.\n\nSomeone who can configure this agent can add it in **Agent settings → Configuration**.`,
    }
  }
  if (tool === 'multiply') {
    const a = numbers[0] ?? 12
    const b = numbers[1] ?? 3
    const first = round(a * b)
    const steps: ToolStep[] = [{ tool, args: { a, b }, result: first }]
    if (/\b(twice|double|again)\b/.test(lower)) {
      steps.push({ tool, args: { a: Number(first), b: 2 }, result: round(Number(first) * 2) })
    }
    const rows = steps
      .map((step) => `| ${step.args.a} × ${step.args.b} | ${step.result} |`)
      .join('\n')
    return {
      steps,
      text: `The result is **${steps[steps.length - 1].result}**.\n\n| Calculation | Result |\n| --- | ---: |\n${rows}`,
    }
  }
  if (tool === 'add') {
    const a = numbers[0] ?? 2
    const b = numbers[1] ?? 3
    const sum = round(a + b)
    return { steps: [{ tool, args: { a, b }, result: sum }], text: `${a} + ${b} = **${sum}**.` }
  }
  if (tool === 'echo') {
    const text = content.replace(/^.*?\becho\b[:\s]*/i, '').trim() || content
    return {
      steps: [{ tool, args: { text }, result: text }],
      text: 'The echo tool returned your text unchanged, so the tool wiring works.',
    }
  }
  if (/\btable\b/.test(lower)) {
    return { steps: [], text: `Here is how this agent is set up right now:\n\n${configTable(agent, config)}` }
  }
  if (/\b(code|sql|script)\b/.test(lower)) {
    return {
      steps: [],
      text: "Here's a starting point:\n\n```sql\nselect category, sum(amount) as total\nfrom invoice_lines\ngroup by category\norder by total desc;\n```\n\nCheck the table name before you run it.",
    }
  }
  return {
    steps: [],
    text: `This is a **mock reply** from ${agent.name}.\n\n- I read your message (${content.length} characters).\n- My model is \`${config.llm_provider}/${config.llm_model}\`.\n- Ask for a *table*, some *code*, or to *multiply* two numbers to see other responses.`,
  }
}

function chunk(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [text]
}

function jsonError(status: number, detail: string): Response {
  return new Response(JSON.stringify({ detail }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type StreamScript = (io: {
  emit: (event: StreamEvent) => void
  sleep: (ms: number) => Promise<void>
  cancelled: () => boolean
}) => Promise<void>

/** Like a fetch body: aborting the request signal errors the stream with `AbortError`. */
function eventStream(script: StreamScript, signal: AbortSignal, onCancel: () => void): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let cancelled = false
  const stop = () => {
    if (!cancelled) {
      cancelled = true
      onCancel()
    }
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      signal.addEventListener(
        'abort',
        () => {
          stop()
          controller.error(new DOMException('The operation was aborted.', 'AbortError'))
        },
        { once: true },
      )
      const emit = (event: StreamEvent) => {
        if (!cancelled) {
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
        }
      }
      const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))
      void script({ emit, sleep, cancelled: () => cancelled }).finally(() => {
        if (!cancelled) {
          controller.close()
        }
      })
    },
    cancel: stop,
  })
}

function startExecution(sessionId: string, agentId: string): string {
  const id = nextUuid()
  addExecution({
    id,
    user_id: caller().userId,
    agent_id: agentId,
    session_id: sessionId,
    status: 'running',
    started_at: new Date().toISOString(),
    completed_at: null,
    duration_ms: null,
    error_summary: null,
    langsmith_run_id: id,
  })
  return id
}

function finishExecution(id: string, startedAt: number, status: string, error: string | null = null) {
  patchExecution(id, {
    status,
    completed_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    error_summary: error,
  })
}

async function openStream(sessionId: string, content: string, signal: AbortSignal): Promise<Response> {
  const path = `/sessions/${sessionId}/messages/stream`
  const options = getOptions()
  try {
    await wait(options.scenario === 'slow' ? 1200 : 250, signal)
  } catch (error) {
    appendLog({ method: 'POST', path, status: 'aborted' })
    throw error
  }
  const fail = (status: number, detail: string) => {
    appendLog({ method: 'POST', path, status })
    return jsonError(status, detail)
  }
  const session = ownSession(sessionId)
  if (!session || session.unavailable) {
    return fail(404, 'Session not found')
  }
  const gate = executableAgent(session.agent_id)
  if ('error' in gate) {
    return fail(gate.status, gate.error)
  }
  if (options.nextStreamFailure === 'forbidden') {
    setOptions({ nextStreamFailure: 'none' })
    return fail(403, 'Agent access denied')
  }
  if (session.pending) {
    return fail(409, 'Resolve the pending approval first')
  }
  const failure = options.nextStreamFailure
  if (failure !== 'none') {
    setOptions({ nextStreamFailure: 'none' })
  }

  const agent = gate.body
  const config = findConfiguration(agent.id)
  if (!config) {
    return fail(404, 'Agent not found')
  }
  appendLog({ method: 'POST', path, status: 200 })
  appendMessages(sessionId, { role: 'user', content })
  const reply = scriptReply(agent, config, content)
  const executionId = startExecution(sessionId, agent.id)
  const startedAt = Date.now()
  const tick = options.scenario === 'slow' ? 140 : 35
  let settled = false

  const script: StreamScript = async ({ emit, sleep, cancelled }) => {
    const remaining = [...reply.steps]
    while (remaining.length > 0) {
      const step = remaining.shift() as ToolStep
      if (needsApproval(agent.id, step.tool)) {
        const preface = `I need to run \`${step.tool}\`. It needs your approval first.`
        emit({ type: 'message.delta', execution_id: executionId, content: preface })
        await sleep(tick * 4)
        if (cancelled()) {
          return
        }
        const approval = approvalFor(executionId, step)
        const run: PendingRun = { executionId, approval, current: step, remaining, finalText: reply.text }
        appendMessages(sessionId, { role: 'assistant', content: preface })
        updateSession(sessionId, (current) => ({ ...current, pending: run }))
        patchExecution(executionId, { status: 'awaiting_approval' })
        settled = true
        emit({ type: 'approval.required', ...approval })
        return
      }
      const callId = `call_mock_${step.tool}_${nextUuid().slice(0, 6)}`
      emit({ type: 'tool.start', execution_id: executionId, tool_call_id: callId, name: step.tool })
      await sleep(tick * 20)
      if (cancelled()) {
        return
      }
      emit({ type: 'tool.end', execution_id: executionId, tool_call_id: callId, name: step.tool, content: step.result })
      appendMessages(sessionId, { role: 'tool', content: step.result })
    }

    const pieces = chunk(reply.text)
    const cutoff = failure === 'none' ? pieces.length : Math.max(3, Math.floor(pieces.length / 3))
    for (const piece of pieces.slice(0, cutoff)) {
      emit({ type: 'message.delta', execution_id: executionId, content: piece })
      await sleep(tick)
      if (cancelled()) {
        return
      }
    }
    settled = true
    switch (failure) {
      case 'none': {
        const message = { role: 'assistant', content: reply.text }
        appendMessages(sessionId, message)
        finishExecution(executionId, startedAt, 'succeeded')
        emit({ type: 'done', execution_id: executionId, message })
        return
      }
      case 'error':
        finishExecution(executionId, startedAt, 'failed', 'Agent execution failed: upstream model timeout')
        emit({ type: 'error', execution_id: executionId, message: 'Agent execution failed: upstream model timeout' })
        return
      case 'interrupt':
        finishExecution(executionId, startedAt, 'failed', 'Stream closed before a terminal event')
        return
      default: {
        const unreachable: never = failure
        return unreachable
      }
    }
  }

  const body = eventStream(script, signal, () => {
    if (!settled) {
      finishExecution(executionId, startedAt, 'cancelled')
      appendLog({ method: 'POST', path, status: 'aborted' })
    }
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function settleRun(sessionId: string, run: PendingRun): ApprovalDecisionResult {
  const messages: ChatMessage[] = [{ role: 'tool', content: run.current.result }]
  const remaining = [...run.remaining]
  while (remaining.length > 0) {
    const step = remaining.shift() as ToolStep
    if (needsApproval(findSession(sessionId)?.agent_id ?? '', step.tool)) {
      const approval = approvalFor(run.executionId, step)
      appendMessages(sessionId, ...messages)
      updateSession(sessionId, (session) => ({
        ...session,
        pending: { ...run, approval, current: step, remaining },
      }))
      return { status: 202, approval }
    }
    messages.push({ role: 'tool', content: step.result })
  }
  const message = { role: 'assistant', content: run.finalText }
  appendMessages(sessionId, ...messages, message)
  updateSession(sessionId, (session) => ({ ...session, pending: null }))
  patchExecution(run.executionId, { status: 'succeeded', completed_at: new Date().toISOString() })
  return { status: 200, executionId: run.executionId, message }
}

function findSession(id: string): MockSession | undefined {
  return sessions.find((session) => session.id === id)
}

export const mockChatClient = {
  listSessions(cursor?: string): Promise<ChatSessionList> {
    return respond('GET', `/sessions${cursor ? `?cursor=${cursor}` : ''}`, () => {
      if (!has(AGENTS_READ)) {
        return deny()
      }
      const failure = scenarioError('sessions')
      if (failure) {
        return failure
      }
      const me = caller().userId
      const visible = emptyScenario()
        ? []
        : sessions.filter((session) => session.owner === me && callerCanView(session.agent_id))
      return { status: 200, body: page(visible.map(toChatSession), cursor, SESSION_PAGE) }
    })
  },

  getSession(id: string, signal?: AbortSignal): Promise<ChatSession> {
    return respond(
      'GET',
      `/sessions/${id}`,
      () => {
        const outcome = readableSession(id)
        return 'error' in outcome ? outcome : { status: 200, body: toChatSession(outcome.body) }
      },
      signal,
    )
  },

  createSession(agentId: string, title?: string): Promise<ChatSession> {
    return respond('POST', '/sessions', () => {
      const gate = executableAgent(agentId)
      if ('error' in gate) {
        return gate
      }
      const session: MockSession = {
        id: nextUuid(),
        agent_id: agentId,
        owner: caller().userId,
        title: title?.trim() || 'New chat',
        messages: [],
        pending: null,
      }
      sessions = [session, ...sessions]
      return { status: 201, body: toChatSession(session) }
    })
  },

  listMessages(sessionId: string): Promise<ChatMessage[]> {
    return respond('GET', `/sessions/${sessionId}/messages`, () => {
      const outcome = readableSession(sessionId)
      return 'error' in outcome ? outcome : { status: 200, body: outcome.body.messages }
    })
  },

  messageFixtures(sessionId: string) {
    return sessions.find((session) => session.id === sessionId)?.messageFixtures ?? []
  },

  listApprovals(sessionId: string): Promise<PendingApproval[]> {
    return respond('GET', `/sessions/${sessionId}/approvals`, () => {
      const outcome = readableSession(sessionId)
      if ('error' in outcome) {
        return outcome
      }
      return { status: 200, body: outcome.body.pending ? [outcome.body.pending.approval] : [] }
    })
  },

  async streamMessage(
    sessionId: string,
    content: string,
    signal: AbortSignal,
    onEvent: (event: StreamEvent) => void,
  ): Promise<StreamTerminal> {
    let response: Response
    try {
      response = await openStream(sessionId, content, signal)
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

  decideApproval(
    sessionId: string,
    interruptId: string,
    decision: ApprovalDecisionName,
    toolCallId: string,
  ): Promise<ApprovalDecisionResult> {
    return respond('POST', `/sessions/${sessionId}/approvals/${interruptId}/${decision}`, () => {
      const session = ownSession(sessionId)
      if (!session || session.unavailable) {
        return { status: 404, error: 'Session not found' }
      }
      const gate = executableAgent(session.agent_id)
      if ('error' in gate) {
        return gate
      }
      const run = session.pending
      if (!run || run.approval.interrupt_id !== interruptId || run.approval.tool_call_id !== toolCallId) {
        return { status: 409, error: 'Approval does not match the pending call' }
      }
      if (getOptions().nextApprovalConflict) {
        setOptions({ nextApprovalConflict: false })
        appendMessages(sessionId, {
          role: 'assistant',
          content: `This call was already rejected in another tab, so \`${run.current.tool}\` did not run. (Mock 409.)`,
        })
        updateSession(sessionId, (current) => ({ ...current, pending: null }))
        patchExecution(run.executionId, { status: 'cancelled', completed_at: new Date().toISOString() })
        return { status: 409, error: 'Approval does not match the pending call' }
      }
      if (decision === 'reject') {
        const message = {
          role: 'assistant',
          content: `Okay, I didn't run \`${run.current.tool}\`. Nothing was changed.`,
        }
        appendMessages(sessionId, message)
        updateSession(sessionId, (current) => ({ ...current, pending: null }))
        patchExecution(run.executionId, { status: 'cancelled', completed_at: new Date().toISOString() })
        return { status: 200, body: { status: 200, executionId: run.executionId, message } }
      }
      const result = settleRun(sessionId, run)
      return { status: result.status, body: result }
    })
  },
}

export type MockChatClient = typeof mockChatClient
