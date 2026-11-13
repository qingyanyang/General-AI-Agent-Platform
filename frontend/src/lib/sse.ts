import { apiErrorFromResponse } from '@/lib/errors'
import type { ChatMessage, PendingApproval, StreamEvent, StreamTerminal } from '@/lib/types'

type FrameBoundary = {
  index: number
  length: number
}

function findBoundary(buffer: string): FrameBoundary | null {
  const crlf = buffer.indexOf('\r\n\r\n')
  const lf = buffer.indexOf('\n\n')
  if (crlf === -1 && lf === -1) {
    return null
  }
  if (crlf === -1) {
    return { index: lf, length: 2 }
  }
  if (lf === -1 || crlf <= lf) {
    return { index: crlf, length: 4 }
  }
  return { index: lf, length: 2 }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isChatMessage(value: unknown): value is ChatMessage {
  return (
    isRecord(value) &&
    typeof value.role === 'string' &&
    typeof value.content === 'string'
  )
}

function isArguments(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
}

function parseEvent(eventName: string, data: unknown): StreamEvent | null {
  if (!isRecord(data) || typeof data.type !== 'string') {
    return null
  }
  if (eventName !== '' && data.type !== eventName) {
    return null
  }
  const type = data.type
  switch (type) {
    case 'message.delta':
      if (typeof data.execution_id !== 'string' || typeof data.content !== 'string') {
        return null
      }
      return { type, execution_id: data.execution_id, content: data.content }
    case 'tool.start':
      if (
        typeof data.execution_id !== 'string' ||
        typeof data.tool_call_id !== 'string' ||
        typeof data.name !== 'string'
      ) {
        return null
      }
      return {
        type,
        execution_id: data.execution_id,
        tool_call_id: data.tool_call_id,
        name: data.name,
      }
    case 'tool.end':
      if (
        typeof data.execution_id !== 'string' ||
        typeof data.tool_call_id !== 'string' ||
        typeof data.name !== 'string' ||
        typeof data.content !== 'string'
      ) {
        return null
      }
      return {
        type,
        execution_id: data.execution_id,
        tool_call_id: data.tool_call_id,
        name: data.name,
        content: data.content,
      }
    case 'approval.required':
      if (
        typeof data.execution_id !== 'string' ||
        typeof data.interrupt_id !== 'string' ||
        typeof data.checkpoint_id !== 'string' ||
        typeof data.tool_call_id !== 'string' ||
        typeof data.tool_name !== 'string' ||
        !isArguments(data.arguments)
      ) {
        return null
      }
      return {
        type,
        execution_id: data.execution_id,
        interrupt_id: data.interrupt_id,
        checkpoint_id: data.checkpoint_id,
        tool_call_id: data.tool_call_id,
        tool_name: data.tool_name,
        arguments: data.arguments,
      }
    case 'done':
      if (typeof data.execution_id !== 'string' || !isChatMessage(data.message)) {
        return null
      }
      return { type, execution_id: data.execution_id, message: data.message }
    case 'error':
      if (typeof data.execution_id !== 'string' || typeof data.message !== 'string') {
        return null
      }
      return { type, execution_id: data.execution_id, message: data.message }
    default:
      return null
  }
}

function parseFrame(raw: string): StreamEvent | null {
  const lines = raw.split(/\r\n|\n|\r/)
  let eventName = ''
  const dataLines: string[] = []
  for (const line of lines) {
    if (line === '' || line.startsWith(':')) {
      continue
    }
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).replace(/^ /, ''))
    }
  }
  if (dataLines.length === 0) {
    return null
  }
  try {
    return parseEvent(eventName, JSON.parse(dataLines.join('\n')) as unknown)
  } catch {
    return null
  }
}

export type SseParser = {
  push(chunk: Uint8Array): StreamEvent[]
  finish(): StreamEvent[]
}

export function createSseParser(): SseParser {
  const decoder = new TextDecoder()
  let buffer = ''

  function pushText(text: string): StreamEvent[] {
    buffer += text
    const events: StreamEvent[] = []
    let boundary = findBoundary(buffer)
    while (boundary) {
      const raw = buffer.slice(0, boundary.index)
      buffer = buffer.slice(boundary.index + boundary.length)
      const event = parseFrame(raw)
      if (event) {
        events.push(event)
      }
      boundary = findBoundary(buffer)
    }
    return events
  }

  return {
    push(chunk: Uint8Array) {
      return pushText(decoder.decode(chunk, { stream: true }))
    },
    finish() {
      const events = pushText(decoder.decode())
      buffer = ''
      return events
    },
  }
}

function terminalFor(event: StreamEvent): StreamTerminal | null {
  switch (event.type) {
    case 'done':
      return { kind: 'done' }
    case 'approval.required':
      return { kind: 'approval' }
    case 'error':
      return { kind: 'error' }
    case 'message.delta':
    case 'tool.start':
    case 'tool.end':
      return null
    default: {
      const unreachable: never = event
      return unreachable
    }
  }
}

export async function consumeEventStream(
  response: Response,
  onEvent: (event: StreamEvent) => void,
): Promise<StreamTerminal> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!response.ok || !contentType.toLowerCase().includes('text/event-stream')) {
    throw await apiErrorFromResponse(response)
  }
  if (!response.body) {
    return { kind: 'interrupted' }
  }

  const reader = response.body.getReader()
  const parser = createSseParser()
  let terminal: StreamTerminal = { kind: 'interrupted' }
  const apply = (event: StreamEvent) => {
    onEvent(event)
    const next = terminalFor(event)
    if (next) {
      terminal = next
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    if (value) {
      for (const event of parser.push(value)) {
        apply(event)
      }
    }
  }
  for (const event of parser.finish()) {
    apply(event)
  }
  return terminal
}

export function approvalFromEvent(
  event: Extract<StreamEvent, { type: 'approval.required' }>,
): PendingApproval {
  return {
    execution_id: event.execution_id,
    interrupt_id: event.interrupt_id,
    checkpoint_id: event.checkpoint_id,
    tool_call_id: event.tool_call_id,
    tool_name: event.tool_name,
    arguments: event.arguments,
  }
}
