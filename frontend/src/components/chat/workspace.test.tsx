import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { Workspace } from '@/components/chat/workspace'
import { resetAgentDrafts, storeAgentDraft } from '@/lib/agent-drafts'
import { clearPreferredAgentId } from '@/lib/chat-preference'
import { clearTranscriptCache } from '@/lib/transcript-cache'
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
    deleteSession: unused,
    listMessages: unused,
    listApprovals: unused,
    streamMessage: unused,
    decideApproval: unused,
    ...overrides,
  }
}

function renderAt(client: ChatClient, path: string, onUnauthorized = vi.fn()) {
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/chat/:agentId?/:sessionId?"
          element={
            <Workspace
              client={client}
              accountLabel="Ada"
              onUnauthorized={onUnauthorized}
              onSignOut={vi.fn()}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  )
  return { ...view, onUnauthorized }
}

function renderWorkspace(client: ChatClient, onUnauthorized = vi.fn()) {
  return renderAt(client, '/chat', onUnauthorized)
}

async function openAgentPicker(user: ReturnType<typeof userEvent.setup>) {
  const change = screen.queryByRole('button', { name: /Change agent|Choose an agent/i })
  if (change) {
    await user.click(change)
  }
}

async function chooseAgent(user: ReturnType<typeof userEvent.setup>, name: string) {
  await openAgentPicker(user)
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
  afterEach(() => {
    cleanup()
    resetAgentDrafts()
    clearPreferredAgentId()
    clearTranscriptCache()
  })

  it('shows a Draft badge while the agent has unpublished configuration edits', async () => {
    const user = userEvent.setup()
    storeAgentDraft(support.id, {
      technical: {
        system_prompt: 'Draft prompt',
        llm_provider: 'openai',
        llm_model: 'gpt',
        temperature: '',
        tool_names: [],
        skill_names: [],
        approval_tool_names: [],
      },
      skills: null,
      connections: [],
      documents: null,
    })
    const client = createClient({
      listAgents: async () => ({ items: [support], next_cursor: null }),
      listSessions: async () => ({ items: [], next_cursor: null }),
    })
    renderWorkspace(client)
    await chooseAgent(user, 'Support')
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0)
  })

  it('keeps the picked agent selected when switching from an agent URL', async () => {
    const user = userEvent.setup()
    const listSessions = vi.fn(async () => ({ items: [], next_cursor: null }))
    const client = createClient({
      listAgents: async () => ({ items: [support, billing], next_cursor: null }),
      listSessions,
    })

    renderAt(client, '/chat/billing')
    await screen.findByRole('heading', { name: 'Billing' })
    await chooseAgent(user, 'Support')

    expect(await screen.findByRole('heading', { name: 'Support' })).toBeInTheDocument()
    expect(listSessions).toHaveBeenCalledTimes(2)
  })

  it('loads the open session and switches to another without reopening the previous one', async () => {
    const user = userEvent.setup()
    const listMessages = vi.fn(async (sessionId: string) => [
      {
        role: 'user' as const,
        content: sessionId === 'alpha' ? 'Alpha history' : 'Beta history',
      },
    ])
    const client = createClient({
      listAgents: async () => ({ items: [support], next_cursor: null }),
      listSessions: async () => ({
        items: [
          { id: 'alpha', agent_id: 'support', title: 'Alpha' },
          { id: 'beta', agent_id: 'support', title: 'Beta' },
        ],
        next_cursor: null,
      }),
      listApprovals: async () => [],
      listMessages,
    })
    renderAt(client, '/chat/support/alpha')
    expect(await screen.findByText('Alpha history')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Beta' }))
    expect(await screen.findByText('Beta history')).toBeInTheDocument()
    expect(screen.queryByText('Alpha history')).not.toBeInTheDocument()
    await waitFor(() => {
      const betaLoads = listMessages.mock.calls.filter(([id]) => id === 'beta').length
      const alphaLoads = listMessages.mock.calls.filter(([id]) => id === 'alpha').length
      expect(betaLoads).toBeGreaterThan(0)
      expect(alphaLoads).toBeLessThan(3)
      expect(betaLoads).toBeLessThan(3)
    })
  })

  it('shows a cached conversation immediately while it refreshes', async () => {
    const user = userEvent.setup()
    let alphaLoads = 0
    const refresh = deferred<ChatMessage[]>()
    const listMessages = vi.fn(async (sessionId: string) => {
      if (sessionId !== 'alpha') {
        return [{ role: 'user' as const, content: 'Beta history' }]
      }
      alphaLoads += 1
      if (alphaLoads > 1) {
        return refresh.promise
      }
      return [{ role: 'user' as const, content: 'Alpha history' }]
    })
    const client = createClient({
      listAgents: async () => ({ items: [support], next_cursor: null }),
      listSessions: async () => ({
        items: [
          { id: 'alpha', agent_id: 'support', title: 'Alpha' },
          { id: 'beta', agent_id: 'support', title: 'Beta' },
        ],
        next_cursor: null,
      }),
      listApprovals: async () => [],
      listMessages,
    })
    renderAt(client, '/chat/support/alpha')
    expect(await screen.findByText('Alpha history')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Beta' }))
    expect(await screen.findByText('Beta history')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Alpha' }))
    expect(screen.getByText('Alpha history')).toBeInTheDocument()
    expect(alphaLoads).toBe(2)
    refresh.resolve([{ role: 'user', content: 'Alpha refreshed' }])
    expect(await screen.findByText('Alpha refreshed')).toBeInTheDocument()
  })

  it('selects the first agent, and the last chosen agent on the next visit', async () => {
    const user = userEvent.setup()
    const client = createClient({
      listAgents: async () => ({ items: [support, billing], next_cursor: null }),
      listSessions: async () => ({ items: [], next_cursor: null }),
    })
    const first = renderWorkspace(client)
    expect(await screen.findByRole('button', { name: /Support/ })).toHaveTextContent('Support')
    expect(screen.queryByRole('button', { name: 'Billing' })).not.toBeInTheDocument()
    await openAgentPicker(user)
    await user.click(screen.getByRole('button', { name: 'Billing' }))
    expect(screen.getByRole('button', { name: /Change agent/i })).toHaveTextContent('Billing')
    first.unmount()

    renderWorkspace(client)
    expect(await screen.findByRole('button', { name: /Billing/ })).toHaveTextContent('Billing')
    expect(screen.queryByRole('button', { name: 'Support' })).not.toBeInTheDocument()
  })

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
    await openAgentPicker(user)
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

  it('ignores a late done event after Stop', async () => {
    const user = userEvent.setup()
    let emit: (event: StreamEvent) => void = () => undefined
    const client = textSessionClient({
      streamMessage: (_sessionId, _content, abortSignal, onEvent) => {
        emit = onEvent
        return new Promise<StreamTerminal>((resolve) => {
          abortSignal.addEventListener('abort', () => resolve({ kind: 'aborted' }))
        })
      },
    })
    renderWorkspace(client)
    await openSupportSession(user, 'Notes')
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'please-stop')
    const sending = user.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByRole('button', { name: 'Stop' })
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    emit({
      type: 'done',
      execution_id: 'exec-1',
      message: { role: 'assistant', content: 'LATE-DONE' },
    })
    expect(screen.queryByText('LATE-DONE')).not.toBeInTheDocument()
    expect(screen.getByText('Stopped.')).toBeInTheDocument()
    await sending
  })

  it('keeps a newer session load when an older 409 refresh finishes later', async () => {
    const user = userEvent.setup()
    let calls = 0
    let releaseStale: (messages: ChatMessage[]) => void = () => undefined
    const refreshStarted = deferred<void>()
    const listMessages = vi.fn(async (): Promise<ChatMessage[]> => {
      calls += 1
      if (calls === 1) {
        return [{ role: 'user', content: 'Please send the file' }]
      }
      if (calls === 2) {
        return new Promise((resolve) => {
          releaseStale = resolve
          refreshStarted.resolve()
        })
      }
      return [{ role: 'assistant', content: 'Reloaded history' }]
    })
    renderWorkspace(
      sessionClient({
        listMessages,
        decideApproval: async () => {
          throw new ApiError(409, 'Approval does not match the pending call')
        },
      }),
    )
    await openSupportSession(user)
    const approving = user.click(await screen.findByRole('button', { name: 'Approve' }))
    await refreshStarted.promise
    await user.click(screen.getByRole('button', { name: 'Quarterly review' }))
    expect(await screen.findByText('Reloaded history')).toBeInTheDocument()
    await act(async () => {
      releaseStale([{ role: 'assistant', content: 'Stale conflict history' }])
      await Promise.resolve()
    })
    expect(screen.queryByText('Stale conflict history')).not.toBeInTheDocument()
    expect(screen.getByText('Reloaded history')).toBeInTheDocument()
    await approving
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

  it('archives empty New chat drafts when an agent is selected', async () => {
    const user = userEvent.setup()
    const deleteSession = vi.fn(async () => undefined)
    const createSession = vi.fn(async () => {
      throw new Error('should not create on select')
    })
    renderWorkspace(
      createClient({
        listAgents: async () => ({ items: [support], next_cursor: null }),
        listSessions: async () => ({
          items: [
            { id: 'draft-1', agent_id: 'support', title: 'New chat' },
            { id: 'draft-2', agent_id: 'support', title: 'New chat' },
            { id: 'draft-3', agent_id: 'support', title: 'New chat' },
            { id: 'real-1', agent_id: 'support', title: 'Quarterly review' },
          ],
          next_cursor: null,
        }),
        listMessages: async (sessionId: string) => {
          if (sessionId === 'real-1') {
            return [{ role: 'user', content: 'Please send the file' }]
          }
          return []
        },
        listApprovals: async () => [],
        deleteSession,
        createSession,
      }),
    )
    await chooseAgent(user, 'Support')
    await waitFor(() => expect(deleteSession).toHaveBeenCalledTimes(3))
    expect(createSession).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Quarterly review' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New chat' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'New chat' })).toHaveLength(1)
  })

  it('creates a session on first send and surfaces create failures without littering history', async () => {
    const user = userEvent.setup()
    const createSession = vi.fn(async () => {
      throw new ApiError(403, 'Forbidden')
    })
    renderWorkspace(
      sessionClient({
        createSession,
      }),
    )
    await chooseAgent(user, 'Support')
    expect(await screen.findByText('Choose a conversation or start a new chat.')).toBeInTheDocument()
    expect(createSession).not.toHaveBeenCalled()
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'hello')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You can view this agent, but you cannot run it.',
    )
    expect(createSession).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'New chat' })).toBeInTheDocument()
  })

  it('keeps history when an approval is forbidden', async () => {
    const user = userEvent.setup()
    renderWorkspace(
      sessionClient({
        decideApproval: async () => {
          throw new ApiError(403, 'Forbidden')
        },
      }),
    )
    await openSupportSession(user)
    expect(await screen.findByText('Please send the file')).toBeInTheDocument()
    expect(screen.getByText('read_file')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reject' }))
    expect(await screen.findByText('read_file')).toBeInTheDocument()
    expect(screen.getByText('Please send the file')).toBeInTheDocument()
  })

  it('archives a conversation from the sidebar', async () => {
    const user = userEvent.setup()
    const deleteSession = vi.fn(async () => undefined)
    renderWorkspace(sessionClient({ deleteSession }))
    await openSupportSession(user)
    await user.click(screen.getByRole('button', { name: 'Delete Quarterly review' }))
    await waitFor(() => expect(deleteSession).toHaveBeenCalledWith('sess-1'))
    expect(screen.queryByRole('button', { name: 'Quarterly review' })).not.toBeInTheDocument()
  })

  it('clears the open conversation when starting a new chat without creating a session', async () => {
    const user = userEvent.setup()
    const createSession = vi.fn(async () => {
      throw new Error('should not create on New chat')
    })
    renderWorkspace(
      sessionClient({
        createSession,
      }),
    )
    await openSupportSession(user)
    expect(await screen.findByText('Please send the file')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'New chat' }))
    expect(await screen.findByText('Choose a conversation or start a new chat.')).toBeInTheDocument()
    expect(screen.queryByText('Please send the file')).not.toBeInTheDocument()
    expect(createSession).not.toHaveBeenCalled()
  })

  it('shows an access card when the account cannot list agents', async () => {
    renderWorkspace(
      createClient({
        listAgents: async () => {
          throw new ApiError(403, 'Forbidden')
        },
      }),
    )
    expect(await screen.findByText("You don't have access yet")).toBeInTheDocument()
    expect(screen.getByText(/Ask an admin to give you access/)).toBeInTheDocument()
    expect(
      screen.queryByText('You can view this agent, but you cannot run it.'),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument()
  })

  it('asks an admin for an agent when the account can sign in but none are available', async () => {
    renderWorkspace(
      createClient({
        listAgents: async () => ({ items: [], next_cursor: null }),
      }),
    )
    expect(await screen.findByText('No agents yet')).toBeInTheDocument()
    expect(screen.getByText(/Ask an admin to add you to a group/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument()
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
