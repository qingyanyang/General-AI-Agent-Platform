import { consumeEventStream, createSseParser } from '@/lib/sse'
import type { StreamEvent } from '@/lib/types'

const encoder = new TextEncoder()

function frame(event: StreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

function delta(content: string): StreamEvent {
  return { type: 'message.delta', execution_id: 'exec-1', content }
}

describe('SSE parser', () => {
  it('reassembles a frame split across chunks', () => {
    const bytes = encoder.encode(frame(delta('hello')))
    const parser = createSseParser()
    const splitAt = bytes.indexOf(encoder.encode('hello')[0])
    expect(parser.push(bytes.slice(0, splitAt))).toEqual([])
    expect(parser.push(bytes.slice(splitAt))).toEqual([delta('hello')])
  })

  it('reads multiple frames from one chunk', () => {
    const parser = createSseParser()
    const events = parser.push(encoder.encode(frame(delta('one')) + frame(delta('two'))))
    expect(events).toEqual([delta('one'), delta('two')])
  })

  it('decodes a UTF-8 character split across chunks', () => {
    const bytes = encoder.encode(frame(delta('你')))
    const splitAt = bytes.indexOf(0xe4) + 1
    const parser = createSseParser()
    expect(parser.push(bytes.slice(0, splitAt))).toEqual([])
    expect(parser.push(bytes.slice(splitAt))).toEqual([delta('你')])
  })

  it('accepts CRLF frames and skips comment lines', () => {
    const payload = JSON.stringify(delta('crlf'))
    const raw = `: keep-alive\r\n\r\nevent: message.delta\r\n: inside\r\ndata: ${payload}\r\n\r\n`
    const parser = createSseParser()
    expect(parser.push(encoder.encode(raw))).toEqual([delta('crlf')])
  })
})

describe('consumeEventStream', () => {
  it('rejects a JSON error before parsing the body as events', async () => {
    const onEvent = vi.fn()
    const response = new Response(
      JSON.stringify({ detail: 'Missing permission' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )
    await expect(consumeEventStream(response, onEvent)).rejects.toMatchObject({
      status: 403,
      message: 'Missing permission',
    })
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('rejects a 200 response that is not an event stream', async () => {
    const onEvent = vi.fn()
    const response = new Response(frame(delta('nope')), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    await expect(consumeEventStream(response, onEvent)).rejects.toMatchObject({ status: 200 })
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('treats approval.required as a pause and EOF without a terminal event as interrupted', async () => {
    const approval: StreamEvent = {
      type: 'approval.required',
      execution_id: 'exec-1',
      interrupt_id: 'int-1',
      checkpoint_id: 'cp-1',
      tool_call_id: 'call-1',
      tool_name: 'read_file',
      arguments: { path: '/tmp/a' },
    }
    const paused = await consumeEventStream(
      streamResponse(frame(approval)),
      () => undefined,
    )
    expect(paused).toEqual({ kind: 'approval' })

    const open = await consumeEventStream(streamResponse(frame(delta('partial'))), () => undefined)
    expect(open).toEqual({ kind: 'interrupted' })
  })
})

function streamResponse(raw: string): Response {
  return new Response(encoder.encode(raw), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}
