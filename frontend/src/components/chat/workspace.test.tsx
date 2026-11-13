import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Workspace } from '@/components/chat/workspace'
import { ApiError } from '@/lib/errors'
import type {
  Agent,
  ApprovalDecisionResult,
  ChatClient,
  ChatMessage,
  ChatSession,
  PendingApproval,
  StreamEvent,
  StreamTerminal,
} from '@/lib/types'

const support: Agent = {
  id: 'support',
  name: 'Support',
  description: null,
  status: 'active',
}
const billing: Agent = {
  id: 'billing',
  name: 'Billing',
  description: null,
  status: 'active',
}

const pending: PendingApproval = {
  execution_id: 'exec-1',
  interrupt_id: 'int-1',
  checkpoint_id: 'cp-1',
  tool_call_id: 'call-1',
  tool_name: 'read_file',
  arguments: { path: '/tmp/report.txt' },
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function createClient(overrides: Partial<ChatClient>): ChatClient {
  const unused = async () => {
    throw new Error('unexpected client call')
  }
  return {
    listAgents: unused,
    listSessions: unused,
    createSession: unused,
    listMessages: unused,
    listApprovals: unused,
    streamMessage: unused,
    decideApproval: unused,
    ...overrides,
  }
}

function renderWorkspace(client: ChatClient, onUnauthorized = vi.fn()) {
  const view = render(
    <Workspace
      client={client}
      accountLabel="Ada"
      onUnauthorized={onUnauthorized}
      onSignOut={vi.fn()}
    />,
  )
  return { ...view, onUnauthorized }
}

async function chooseAgent(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name }))
}

async function openSupportSession(
  user: ReturnType<typeof userEvent.setup>,
  sessionName = 'Quarterly review',
) {
  await chooseAgent(user, 'Support')
  await user.click(await screen.findByRole('button', { name: sessionName }))
}

describe('chat workspace', () => {
  it('shows only agents from the API and loads the next page', async () => {
    const user = userEvent.setup()
    const client = createClient({
      listAgents: vi.fn(async (cursor?: string) => {
        if (cursor === 'page-2') {
          return { items: [billing], next_cursor: null }
        }
        return { items: [support], next_cursor: 'page-2' }
      }),
    })
    renderWorkspace(client)
    expect(await screen.findByRole('button', { name: 'Support' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Billing' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Load more agents' }))
    expect(await screen.findByRole('button', { name: 'Billing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Support' })).toBeInTheDocument()
  })

  it('does not treat a filtered first session page as an empty history', async () => {
    const user = userEvent.setup()
    const listSessions = vi.fn(async (cursor?: string) => {
      if (!cursor) {
        return {
          items: [{ id: 'other', agent_id: 'other-agent', title: 'Other conversation' }],
          next_cursor: 'page-2',
        }
      }
      return {
        items: [{ id: 'mine', agent_id: 'support', title: 'Support conversation' }],
        next_cursor: null,
      }
    })
    renderWorkspace(
      createClient({
        listAgents: async () => ({ items: [support], next_cursor: null }),
        listSessions,
        listMessages: async () => [],
        listApprovals: async () => [],
      }),
    )
    await chooseAgent(user, 'Support')
    expect(await screen.findByRole('button', { name: 'Support conversation' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Other conversation' })).not.toBeInTheDocument()
    expect(screen.queryByText('No conversations for this agent.')).not.toBeInTheDocument()
    expect(listSessions).toHaveBeenCalledTimes(2)
  })

  it('restores a pending approval with the tool name and arguments', async () => {
    const user = userEvent.setup()
    renderWorkspace(sessionClient())
    await openSupportSession(user)
    expect(await screen.findByText('read_file')).toBeInTheDocument()
    expect(screen.getByText(/\/tmp\/report.txt/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled()
  })

  it('appends the assistant message on 200 and disables the buttons while submitting', async () => {
    const user = userEvent.setup()
    const decision = deferred<ApprovalDecisionResult>()
    const decideApproval = vi.fn(
      async (
        sessionId: string,
        interruptId: string,
        decisionName: 'approve' | 'reject',
        toolCallId: string,
      ) => {
        expect(sessionId).toBe('sess-1')
        expect(interruptId).toBe('int-1')
        expect(decisionName).toBe('approve')
        expect(toolCallId).toBe('call-1')
        return decision.promise
      },
    )
    renderWorkspace(sessionClient({ decideApproval }))
    await openSupportSession(user)
    const approve = await screen.findByRole('button', { name: 'Approve' })
    const submitting = user.click(approve)
    await waitFor(() => expect(approve).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled()
    decision.resolve({
      status: 200,
      executionId: 'exec-1',
      message: { role: 'assistant', content: 'Approved and sent.' },
    })
    await submitting
    expect(await screen.findByText('Approved and sent.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.getByText('Please send the file')).toBeInTheDocument()
  })

  it('replaces the panel when approval returns 202', async () => {
    const user = userEvent.setup()
    const next: PendingApproval = { ...pending, interrupt_id: 'int-2', tool_call_id: 'call-2', tool_name: 'send_mail' }
    renderWorkspace(
      sessionClient({
        decideApproval: async () => ({ status: 202, approval: next }),
      }),
    )
    await openSupportSession(user)
    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByText('send_mail')).toBeInTheDocument()
    expect(screen.queryByText('read_file')).not.toBeInTheDocument()
  })

  it('refreshes approvals and message history after 409', async () => {
    const user = userEvent.setup()
    let messages = 0
    let approvals = 0
    const listMessages = vi.fn(async (): Promise<ChatMessage[]> => {
      messages += 1
      if (messages === 1) {
        return [{ role: 'user', content: 'Please send the file' }]
      }
      return [
        { role: 'user', content: 'Please send the file' },
        { role: 'assistant', content: 'Finished by another request' },
      ]
    })
    const listApprovals = vi.fn(async () => {
      approvals += 1
      return approvals === 1 ? [pending] : []
    })
    renderWorkspace(
      sessionClient({
        listMessages,
        listApprovals,
        decideApproval: async () => {
          throw new ApiError(409, 'Approval does not match the pending call')
        },
      }),
    )
    await openSupportSession(user)
    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByText('Finished by another request')).toBeInTheDocument()
    expect(screen.queryByText('read_file')).not.toBeInTheDocument()
    expect(listMessages).toHaveBeenCalledTimes(2)
    expect(listApprovals).toHaveBeenCalledTimes(2)
  })

  it('stops the active stream and does not send it again', async () => {
    const user = userEvent.setup()
    let calls = 0
    let signal: AbortSignal | undefined
    const client = textSessionClient({
      streamMessage: (_sessionId, _content, abortSignal) => {
        calls += 1
        signal = abortSignal
        return new Promise<StreamTerminal>((resolve) => {
          abortSignal.addEventListener('abort', () => resolve({ kind: 'aborted' }))
        })
      },
    })
    renderWorkspace(client)
    await openSupportSession(user, 'Notes')
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'please-stop')
    const sending = user.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByRole('button', { name: 'Stop' })
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await sending
    expect(signal?.aborted).toBe(true)
    expect(calls).toBe(1)
    expect(await screen.findByText('Stopped.')).toBeInTheDocument()
    expect(screen.getByText('please-stop')).toBeInTheDocument()
  })

  it('drops late stream events after switching sessions', async () => {
    const user = userEvent.setup()
    let emit: (event: StreamEvent) => void = () => undefined
    let signal: AbortSignal | undefined
    const sessions: ChatSession[] = [
      { id: 'alpha', agent_id: 'support', title: 'Alpha' },
      { id: 'beta', agent_id: 'support', title: 'Beta' },
    ]
    const client = createClient({
      listAgents: async () => ({ items: [support], next_cursor: null }),
      listSessions: async () => ({ items: sessions, next_cursor: null }),
      listApprovals: async () => [],
      listMessages: async (sessionId: string) => [
        {
          role: 'assistant',
          content: sessionId === 'alpha' ? 'Alpha history' : 'Beta history',
        },
      ],
      streamMessage: (_sessionId, _content, abortSignal, onEvent) => {
        signal = abortSignal
        emit = onEvent
        return new Promise<StreamTerminal>((resolve) => {
          abortSignal.addEventListener('abort', () => resolve({ kind: 'aborted' }))
        })
      },
    })
    renderWorkspace(client)
    await chooseAgent(user, 'Support')
    await user.click(await screen.findByRole('button', { name: 'Alpha' }))
    expect(await screen.findByText('Alpha history')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'outbound-alpha')
    const sending = user.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByRole('button', { name: 'Stop' })
    await user.click(screen.getByRole('button', { name: 'Beta' }))
    expect(await screen.findByText('Beta history')).toBeInTheDocument()
    emit({ type: 'message.delta', execution_id: 'exec-1', content: 'LATE' })
    expect(screen.queryByText('LATE')).not.toBeInTheDocument()
    expect(screen.queryByText('outbound-alpha')).not.toBeInTheDocument()
    expect(signal?.aborted).toBe(true)
    await sending
    expect(screen.queryByText('Stopped.')).not.toBeInTheDocument()
  })

  it('keeps readable history when send is forbidden and treats 401 as signed out', async () => {
    const user = userEvent.setup()
    const onUnauthorized = vi.fn()
    const forbidden = textSessionClient({
      streamMessage: async () => {
        throw new ApiError(403, 'Forbidden')
      },
    })
    const { unmount } = renderWorkspace(forbidden, onUnauthorized)
    await openSupportSession(user, 'Notes')
    expect(await screen.findByText('Existing history')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'try again')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You can view this agent, but you cannot run it.',
    )
    expect(screen.getByText('Existing history')).toBeInTheDocument()
    expect(onUnauthorized).not.toHaveBeenCalled()
    unmount()

    const unauthorized = vi.fn()
    renderWorkspace(
      textSessionClient({
        streamMessage: async () => {
          throw new ApiError(401, 'Unauthorized')
        },
      }),
      unauthorized,
    )
    await openSupportSession(user, 'Notes')
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'try again')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(unauthorized).toHaveBeenCalledOnce())
    expect(
      screen.queryByText('You can view this agent, but you cannot run it.'),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Existing history')).toBeInTheDocument()
  })

  it('keeps history when a new chat or an approval is forbidden', async () => {
    const user = userEvent.setup()
    renderWorkspace(
      sessionClient({
        createSession: async () => {
          throw new ApiError(403, 'Forbidden')
        },
        decideApproval: async () => {
          throw new ApiError(403, 'Forbidden')
        },
      }),
    )
    await openSupportSession(user)
    expect(await screen.findByText('Please send the file')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'New chat' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You can view this agent, but you cannot run it.',
    )
    expect(screen.getByText('Please send the file')).toBeInTheDocument()
    expect(screen.getByText('read_file')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reject' }))
    expect(await screen.findByText('read_file')).toBeInTheDocument()
    expect(screen.getByText('Please send the file')).toBeInTheDocument()
  })

  it('renders assistant markdown without injecting an HTML script', async () => {
    const user = userEvent.setup()
    renderWorkspace(
      textSessionClient({
        listMessages: async () => [
          { role: 'assistant', content: 'Hello <script>alert(1)</script> **there**' },
        ],
      }),
    )
    await openSupportSession(user, 'Notes')
    expect(await screen.findByText('there')).toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
  })
})

function sessionClient(overrides: Partial<ChatClient> = {}): ChatClient {
  return createClient({
    listAgents: async () => ({ items: [support], next_cursor: null }),
    listSessions: async () => ({
      items: [{ id: 'sess-1', agent_id: 'support', title: 'Quarterly review' }],
      next_cursor: null,
    }),
    listMessages: async () => [{ role: 'user', content: 'Please send the file' }],
    listApprovals: async () => [pending],
    ...overrides,
  })
}

function textSessionClient(overrides: Partial<ChatClient> = {}): ChatClient {
  return createClient({
    listAgents: async () => ({ items: [support], next_cursor: null }),
    listSessions: async () => ({
      items: [{ id: 'sess-1', agent_id: 'support', title: 'Notes' }],
      next_cursor: null,
    }),
    listMessages: async () => [{ role: 'assistant', content: 'Existing history' }],
    listApprovals: async () => [],
    ...overrides,
  })
}
