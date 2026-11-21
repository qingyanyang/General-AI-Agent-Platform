import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

import { ManagementPage } from '@/components/manage/management-page'
import { ApiError } from '@/lib/errors'
import { clearReadCache } from '@/lib/read-cache'
import type {
  AgentConfiguration,
  AgentRecord,
  ExecutionRecord,
  LlmModel,
  ManagementClient,
} from '@/lib/management'
import {
  AGENT_ACCESS_MANAGE,
  AGENTS_CONFIGURE,
  AGENTS_READ,
  PLATFORM_TECHNICAL,
} from '@/lib/permissions'

const developer = new Set([AGENTS_READ, AGENTS_CONFIGURE, PLATFORM_TECHNICAL])
const superAdmin = new Set([
  AGENTS_READ,
  AGENTS_CONFIGURE,
  AGENT_ACCESS_MANAGE,
  PLATFORM_TECHNICAL,
])
const reader = new Set([AGENTS_READ])
const accessAdmin = new Set([AGENTS_READ, AGENT_ACCESS_MANAGE])
const businessAdmin = new Set([AGENTS_READ, AGENTS_CONFIGURE, AGENT_ACCESS_MANAGE])

const model: LlmModel = {
  provider: 'deepseek',
  model: 'deepseek-flash',
  temperature_min: 0,
  temperature_max: 2,
}

function agent(id: string, name: string): AgentRecord {
  return {
    id,
    name,
    description: null,
    status: 'active',
    created_by: 'ada',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  }
}

function configuration(overrides: Partial<AgentConfiguration> = {}): AgentConfiguration {
  return {
    system_prompt: 'Hello',
    llm_provider: 'deepseek',
    llm_model: 'deepseek-flash',
    temperature: 1,
    tool_names: [],
    skill_names: [],
    approval_tool_names: [],
    ...overrides,
  }
}

function execution(status: string): ExecutionRecord {
  return {
    id: `exec-${status}`,
    user_id: 'ada',
    agent_id: 'alpha',
    session_id: null,
    status,
    started_at: '2026-03-01T00:00:00Z',
    completed_at: status === 'running' || status === 'awaiting_approval' ? null : '2026-03-01T00:01:00Z',
    duration_ms: status === 'running' || status === 'awaiting_approval' ? null : 1000,
    error_summary: status === 'failed' ? 'tool failed' : null,
    langsmith_run_id: 'run-123',
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function createClient(overrides: Partial<ManagementClient> = {}): ManagementClient {
  const unused = async () => {
    throw new Error('unexpected client call')
  }
  return {
    listAgents: async () => ({ items: [], next_cursor: null }),
    getAgent: unused,
    createAgent: unused,
    updateAgent: unused,
    deactivateAgent: unused,
    getConfiguration: unused,
    putConfiguration: unused,
    getAccessConfig: unused,
    putAccessConfig: unused,
    activateAccessConfig: unused,
    getInstructionSkills: unused,
    putInstructionSkills: unused,
    getKnowledgeReferences: unused,
    putKnowledgeReferences: unused,
    listGroups: async () => ({ items: [], next_cursor: null }),
    listAllGroups: async () => [],
    createGroup: unused,
    getGroup: unused,
    updateGroup: unused,
    deleteGroup: unused,
    listGroupAgents: unused,
    assignGroupAgent: unused,
    unassignGroupAgent: unused,
    listMemberships: unused,
    upsertMembership: unused,
    deleteMembership: unused,
    listUsers: unused,
    getUser: unused,
    listUserAccess: unused,
    listUserExecutions: unused,
    inviteUser: unused,
    updateUser: unused,
    listTools: async () => [{ name: 'echo', description: 'Echo' }],
    listModels: async () => [model],
    listSkills: async () => [],
    listGrants: unused,
    upsertGrant: unused,
    deleteGrant: unused,
    listExecutions: unused,
    ...overrides,
  }
}

function renderPage(
  client: ManagementClient,
  permissions: ReadonlySet<string>,
  options: { onUnauthorized?: () => void; projectUrl?: string | null } = {},
) {
  const onUnauthorized = options.onUnauthorized ?? vi.fn()
  const view = render(
    <MemoryRouter>
      <ManagementPage
        client={client}
        permissions={permissions}
        accountLabel="Ada"
        projectUrl={options.projectUrl}
        onUnauthorized={onUnauthorized}
        onSignOut={vi.fn()}
      />
    </MemoryRouter>,
  )
  return { ...view, onUnauthorized }
}

async function openListedAgent(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: new RegExp(name) }))
  await screen.findByLabelText('System prompt')
}

describe('ManagementPage', () => {
  beforeEach(() => {
    clearReadCache()
  })

  it('creates an agent and shows a conflict from the API', async () => {
    const user = userEvent.setup()
    const createAgent = vi
      .fn<ManagementClient['createAgent']>()
      .mockRejectedValue(new ApiError(409, 'Agent already exists'))
    renderPage(createClient({ createAgent }), superAdmin)
    await user.type(screen.getByRole('textbox', { name: 'New agent id' }), 'support')
    await user.type(screen.getByRole('textbox', { name: 'New agent name' }), 'Support')
    await user.click(screen.getByRole('button', { name: 'Create agent' }))
    expect(createAgent).toHaveBeenCalledWith({
      id: 'support',
      name: 'Support',
      description: null,
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Agent already exists')
  })

  it('saves configuration without trimming the prompt', async () => {
    const user = userEvent.setup()
    const alpha = agent('alpha', 'Alpha')
    const putConfiguration = vi.fn(async (_id: string, body: AgentConfiguration) => body)
    renderPage(
      createClient({
        listAgents: async () => ({ items: [alpha], next_cursor: null }),
        getAgent: async () => alpha,
        getConfiguration: async () => configuration(),
        putConfiguration,
      }),
      developer,
    )
    await openListedAgent(user, 'Alpha')
    const prompt = screen.getByLabelText('System prompt')
    await user.clear(prompt)
    await user.click(prompt)
    await user.paste('  keep\nspaces  ')
    await user.click(screen.getByRole('checkbox', { name: 'echo' }))
    await user.click(screen.getByRole('checkbox', { name: 'Approve echo' }))
    await user.click(screen.getByRole('button', { name: 'Save configuration' }))
    await waitFor(() => expect(putConfiguration).toHaveBeenCalled())
    expect(putConfiguration.mock.calls[0][1]).toMatchObject({
      system_prompt: '  keep\nspaces  ',
      tool_names: ['echo'],
      approval_tool_names: ['echo'],
      skill_names: [],
    })
  })

  it('keeps the configuration form when saving returns 422', async () => {
    const user = userEvent.setup()
    const alpha = agent('alpha', 'Alpha')
    renderPage(
      createClient({
        listAgents: async () => ({ items: [alpha], next_cursor: null }),
        getAgent: async () => alpha,
        getConfiguration: async () => configuration(),
        putConfiguration: async () => {
          throw new ApiError(422, 'temperature must be between 0.0 and 2.0')
        },
      }),
      developer,
    )
    await openListedAgent(user, 'Alpha')
    const prompt = screen.getByLabelText('System prompt')
    await user.clear(prompt)
    await user.click(prompt)
    await user.paste('still here')
    await user.click(screen.getByRole('button', { name: 'Save configuration' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'temperature must be between 0.0 and 2.0',
    )
    expect(prompt).toHaveValue('still here')
  })

  it('shows a configuration 403 without signing out', async () => {
    const user = userEvent.setup()
    const alpha = agent('alpha', 'Alpha')
    const onUnauthorized = vi.fn()
    renderPage(
      createClient({
        listAgents: async () => ({ items: [alpha], next_cursor: null }),
        getAgent: async () => alpha,
        getConfiguration: async () => {
          throw new ApiError(403, 'You cannot configure this agent.')
        },
      }),
      developer,
      { onUnauthorized },
    )
    await user.click(await screen.findByRole('button', { name: /Alpha/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('You cannot configure this agent.')
    expect(screen.queryByRole('button', { name: 'Save configuration' })).not.toBeInTheDocument()
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('hides create, save, and deactivate without configure permission', async () => {
    const user = userEvent.setup()
    const alpha = agent('alpha', 'Alpha')
    renderPage(
      createClient({
        listAgents: async () => ({ items: [alpha], next_cursor: null }),
        getAgent: async () => alpha,
      }),
      reader,
    )
    await user.click(await screen.findByRole('button', { name: /Alpha/ }))
    expect(await screen.findByText(/created by ada/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create agent' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save configuration' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save details' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load grants' })).not.toBeInTheDocument()
  })

  it('manages grants when the agent catalog is empty', async () => {
    const user = userEvent.setup()
    const listGrants = vi.fn<ManagementClient['listGrants']>().mockResolvedValue({
      items: [
        {
          id: 'grant-1',
          user_id: 'auth0|other',
          agent_id: 'hidden-agent',
          can_view: true,
          can_configure: false,
          can_execute: false,
        },
      ],
      next_cursor: null,
    })
    const upsertGrant = vi.fn<ManagementClient['upsertGrant']>().mockResolvedValue(null)
    renderPage(createClient({ listGrants, upsertGrant }), accessAdmin)
    expect(await screen.findByText('No agents to show.')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Grant agent id' }), 'hidden-agent')
    await user.click(screen.getByRole('button', { name: 'Load grants' }))
    expect(await screen.findByText(/auth0\|other/)).toBeInTheDocument()
    expect(listGrants).toHaveBeenCalledWith('hidden-agent', undefined)
    await user.type(screen.getByRole('textbox', { name: 'User id' }), 'auth0|other')
    await user.click(screen.getByRole('checkbox', { name: 'Can view' }))
    await user.click(screen.getByRole('button', { name: 'Save grant' }))
    await waitFor(() => expect(screen.queryByText(/auth0\|other/)).not.toBeInTheDocument())
    expect(upsertGrant).toHaveBeenCalledWith({
      user_id: 'auth0|other',
      agent_id: 'hidden-agent',
      can_view: false,
      can_configure: false,
      can_execute: false,
    })
  })

  it('ignores a slow load after the user switches agents', async () => {
    const user = userEvent.setup()
    const alpha = agent('alpha', 'Alpha')
    const beta = agent('beta', 'Beta')
    const gate = deferred<AgentConfiguration>()
    renderPage(
      createClient({
        listAgents: async () => ({ items: [alpha, beta], next_cursor: null }),
        getAgent: async (id) => (id === 'beta' ? beta : alpha),
        getConfiguration: async (id) =>
          id === 'alpha' ? gate.promise : configuration({ system_prompt: 'prompt b' }),
      }),
      developer,
    )
    await user.click(await screen.findByRole('button', { name: /Alpha/ }))
    await user.click(screen.getByRole('button', { name: /Beta/ }))
    expect(await screen.findByLabelText('System prompt')).toHaveValue('prompt b')
    gate.resolve(configuration({ system_prompt: 'prompt a' }))
    await waitFor(() => expect(screen.getByLabelText('System prompt')).toHaveValue('prompt b'))
  })

  it('keeps unsaved edits in the other form and asks before discarding them', async () => {
    const user = userEvent.setup()
    const alpha = agent('alpha', 'Alpha')
    const beta = agent('beta', 'Beta')
    const updateAgent = vi.fn(async (_id: string, patch: { name?: string }) => ({
      ...alpha,
      name: patch.name ?? alpha.name,
    }))
    const putConfiguration = vi.fn(async (_id: string, body: AgentConfiguration) => body)
    const opened: string[] = []
    renderPage(
      createClient({
        listAgents: async () => ({ items: [alpha, beta], next_cursor: null }),
        getAgent: async (id) => (id === 'beta' ? beta : alpha),
        getConfiguration: async (id) => {
          opened.push(id)
          return configuration({ system_prompt: id === 'beta' ? 'prompt b' : 'prompt a' })
        },
        updateAgent,
        putConfiguration,
      }),
      developer,
    )
    await openListedAgent(user, 'Alpha')
    const prompt = screen.getByLabelText('System prompt')
    await user.clear(prompt)
    await user.click(prompt)
    await user.paste('edited prompt')
    await user.clear(screen.getByRole('textbox', { name: 'Name' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Renamed')
    await user.click(screen.getByRole('button', { name: 'Save details' }))
    await waitFor(() =>
      expect(updateAgent).toHaveBeenCalledWith(
        'alpha',
        { name: 'Renamed' },
        expect.any(AbortSignal),
      ),
    )
    expect(prompt).toHaveValue('edited prompt')
    await user.clear(screen.getByRole('textbox', { name: 'Name' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Renamed again')
    await user.click(screen.getByRole('button', { name: 'Save configuration' }))
    await waitFor(() => expect(putConfiguration).toHaveBeenCalled())
    expect(putConfiguration.mock.calls[0][1].system_prompt).toBe('edited prompt')
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Renamed again')
    expect(updateAgent).toHaveBeenCalledTimes(1)

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await user.click(screen.getByRole('button', { name: /Beta/ }))
    expect(confirm).toHaveBeenCalledWith('Discard unsaved changes?')
    expect(screen.getByLabelText('System prompt')).toHaveValue('edited prompt')
    expect(opened).toEqual(['alpha'])
    confirm.mockRestore()
  })

  it('keeps saved skills when skill discovery returns 403', async () => {
    const user = userEvent.setup()
    const billing = agent('billing', 'Billing')
    const putConfiguration = vi.fn(async (_id: string, body: AgentConfiguration) => body)
    renderPage(
      createClient({
        getAgent: async () => billing,
        getConfiguration: async () =>
          configuration({
            system_prompt: 'Keep me',
            skill_names: ['summarize_brief'],
          }),
        listSkills: async () => {
          throw new ApiError(403, 'Permission denied')
        },
        putConfiguration,
      }),
      developer,
    )
    await user.type(screen.getByRole('textbox', { name: 'Configuration agent id' }), 'billing')
    await user.click(screen.getByRole('button', { name: 'Open configuration' }))
    expect(await screen.findByText('Skill discovery is unavailable.')).toBeInTheDocument()
    expect(screen.getByText('summarize_brief')).toBeInTheDocument()
    const prompt = screen.getByLabelText('System prompt')
    await user.clear(prompt)
    await user.click(prompt)
    await user.paste('Keep me\nmore')
    await user.click(screen.getByRole('button', { name: 'Save configuration' }))
    await waitFor(() => expect(putConfiguration).toHaveBeenCalled())
    expect(putConfiguration.mock.calls[0][1].skill_names).toEqual(['summarize_brief'])
    expect(screen.getByText('summarize_brief')).toBeInTheDocument()
    expect(screen.getByText('Skill discovery is unavailable.')).toBeInTheDocument()
  })

  it('shows awaiting approval separately and links only an http(s) project', async () => {
    const user = userEvent.setup()
    const listExecutions = vi.fn<ManagementClient['listExecutions']>().mockResolvedValue({
      items: [execution('awaiting_approval')],
      next_cursor: null,
    })
    const { rerender } = renderPage(createClient({ listExecutions }), reader, {
      projectUrl: 'javascript:alert(1)',
    })
    expect(screen.getByRole('option', { name: 'Awaiting approval' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Running' })).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Execution status' }), 'awaiting_approval')
    await user.click(screen.getByRole('button', { name: 'Load executions' }))
    const awaiting = await screen.findByRole('article')
    expect(awaiting).toHaveTextContent('Awaiting approval')
    expect(awaiting).toHaveTextContent('No completion or duration yet.')
    expect(awaiting).not.toHaveTextContent('Running')
    expect(screen.queryByRole('link', { name: 'Open LangSmith project' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('LangSmith correlation id')).toHaveValue('run-123')
    expect(listExecutions).toHaveBeenCalledWith({
      agentId: undefined,
      status: 'awaiting_approval',
      cursor: undefined,
    })

    listExecutions.mockResolvedValue({ items: [execution('running')], next_cursor: null })
    rerender(
      <MemoryRouter>
        <ManagementPage
          client={createClient({ listExecutions })}
          permissions={reader}
          accountLabel="Ada"
          projectUrl="https://smith.example/o/acme/projects/p/agent"
          onUnauthorized={vi.fn()}
          onSignOut={vi.fn()}
        />
      </MemoryRouter>,
    )
    await user.selectOptions(screen.getByRole('combobox', { name: 'Execution status' }), 'running')
    await user.click(screen.getByRole('button', { name: 'Load executions' }))
    const running = await screen.findByRole('article')
    expect(running).toHaveTextContent('Running')
    expect(running).toHaveTextContent('No completion or duration yet.')
    expect(running).not.toHaveTextContent('Awaiting approval')
    expect(screen.getByRole('link', { name: 'Open LangSmith project' })).toHaveAttribute(
      'href',
      'https://smith.example/o/acme/projects/p/agent',
    )
  })

  it('drops the previous form when the next agent fails to load', async () => {
    const user = userEvent.setup()
    const alpha = agent('alpha', 'Alpha')
    const beta = agent('beta', 'Beta')
    const putConfiguration = vi.fn()
    const updateAgent = vi.fn()
    renderPage(
      createClient({
        listAgents: async () => ({ items: [alpha, beta], next_cursor: null }),
        getAgent: async (id) => (id === 'beta' ? beta : alpha),
        getConfiguration: async (id) => {
          if (id === 'beta') {
            throw new Error('network down')
          }
          return configuration({ system_prompt: 'prompt a' })
        },
        putConfiguration,
        updateAgent,
      }),
      developer,
    )
    await openListedAgent(user, 'Alpha')
    const prompt = screen.getByLabelText('System prompt')
    await user.clear(prompt)
    await user.click(prompt)
    await user.paste('discard me')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: /Beta/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this agent.')
    expect(screen.queryByLabelText('System prompt')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save configuration' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save details' })).not.toBeInTheDocument()
    expect(putConfiguration).not.toHaveBeenCalled()
    expect(updateAgent).not.toHaveBeenCalled()
  })

  it('aborts an in-flight configuration save when another agent opens', async () => {
    const user = userEvent.setup()
    const alpha = agent('alpha', 'Alpha')
    const beta = agent('beta', 'Beta')
    let alphaSignal: AbortSignal | undefined
    const putConfiguration = vi.fn(
      (id: string, body: AgentConfiguration, signal?: AbortSignal) =>
        new Promise<AgentConfiguration>((resolve) => {
          if (id !== 'alpha') {
            resolve(body)
            return
          }
          alphaSignal = signal
          signal?.addEventListener(
            'abort',
            () => {
              resolve({ ...body, system_prompt: 'late save' })
            },
            { once: true },
          )
        }),
    )
    renderPage(
      createClient({
        listAgents: async () => ({ items: [alpha, beta], next_cursor: null }),
        getAgent: async (id) => (id === 'beta' ? beta : alpha),
        getConfiguration: async (id) =>
          configuration({ system_prompt: id === 'beta' ? 'prompt b' : 'prompt a' }),
        putConfiguration,
      }),
      developer,
    )
    await openListedAgent(user, 'Alpha')
    const prompt = screen.getByLabelText('System prompt')
    await user.clear(prompt)
    await user.click(prompt)
    await user.paste('discard me')
    await user.click(screen.getByRole('button', { name: 'Save configuration' }))
    await waitFor(() => expect(putConfiguration).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Save configuration' })).toBeDisabled()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: /Beta/ }))
    expect(await screen.findByLabelText('System prompt')).toHaveValue('prompt b')
    expect(alphaSignal?.aborted).toBe(true)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save configuration' })).toBeEnabled(),
    )
    expect(screen.queryByDisplayValue('late save')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('discard me')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save configuration' }))
    await waitFor(() => expect(putConfiguration).toHaveBeenCalledTimes(2))
    expect(putConfiguration.mock.calls[1]?.[0]).toBe('beta')
    expect(putConfiguration.mock.calls[1]?.[2]).toEqual(expect.any(AbortSignal))
    expect((putConfiguration.mock.calls[1]?.[2] as AbortSignal).aborted).toBe(false)
  })

  it('keeps load more on the query that produced the cursor', async () => {
    const user = userEvent.setup()
    const listExecutions = vi
      .fn<ManagementClient['listExecutions']>()
      .mockResolvedValueOnce({
        items: [execution('running')],
        next_cursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        items: [{ ...execution('running'), id: 'exec-running-2' }],
        next_cursor: null,
      })
      .mockResolvedValueOnce({
        items: [execution('awaiting_approval')],
        next_cursor: null,
      })
    const listGrants = vi.fn<ManagementClient['listGrants']>().mockResolvedValue({
      items: [
        {
          id: 'grant-1',
          user_id: 'auth0|other',
          agent_id: 'alpha',
          can_view: true,
          can_configure: false,
          can_execute: false,
        },
      ],
      next_cursor: 'grant-cursor',
    })
    renderPage(
      createClient({ listExecutions, listGrants }),
      new Set([AGENTS_READ, AGENT_ACCESS_MANAGE]),
    )
    await user.type(screen.getByRole('textbox', { name: 'Execution agent id' }), 'alpha')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Execution status' }), 'running')
    await user.click(screen.getByRole('button', { name: 'Load executions' }))
    await user.click(await screen.findByRole('button', { name: 'Load more executions' }))
    expect(listExecutions).toHaveBeenLastCalledWith({
      agentId: 'alpha',
      status: 'running',
      cursor: 'cursor-1',
    })
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Execution status' }),
      'awaiting_approval',
    )
    expect(screen.queryByRole('button', { name: 'Load more executions' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Load executions' }))
    await waitFor(() =>
      expect(listExecutions).toHaveBeenLastCalledWith({
        agentId: 'alpha',
        status: 'awaiting_approval',
        cursor: undefined,
      }),
    )

    await user.type(screen.getByRole('textbox', { name: 'Grant agent id' }), 'alpha')
    await user.click(screen.getByRole('button', { name: 'Load grants' }))
    expect(await screen.findByRole('button', { name: 'Load more grants' })).toBeInTheDocument()
    await user.clear(screen.getByRole('textbox', { name: 'Grant agent id' }))
    await user.type(screen.getByRole('textbox', { name: 'Grant agent id' }), 'beta')
    expect(screen.queryByRole('button', { name: 'Load more grants' })).not.toBeInTheDocument()
    expect(listGrants).toHaveBeenCalledTimes(1)
    expect(listGrants).toHaveBeenCalledWith('alpha', undefined)
  })

  it('does not load technical configuration for business Admin without platform:technical', async () => {
    const user = userEvent.setup()
    const alpha = agent('alpha', 'Alpha')
    const getConfiguration = vi.fn(async () => configuration())
    const listTools = vi.fn(async () => [{ name: 'echo', description: 'Echo' }])
    renderPage(
      createClient({
        listAgents: async () => ({ items: [alpha], next_cursor: null }),
        getAgent: async () => alpha,
        getConfiguration,
        listTools,
        getAccessConfig: async () => ({
          agent_id: 'alpha',
          authorization_mode: 'legacy_grants',
          audience_effective: false,
          audience_mode: 'groups',
          owning_group_id: null,
          owning_group_name: null,
          group_ids: [],
          groups: [],
          updated_at: '2026-01-01T00:00:00Z',
        }),
      }),
      businessAdmin,
    )
    await user.click(await screen.findByRole('button', { name: /Alpha/ }))
    expect(await screen.findByRole('textbox', { name: 'Name' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Who can use this agent?' })).toBeInTheDocument()
    expect(screen.queryByLabelText('System prompt')).not.toBeInTheDocument()
    expect(getConfiguration).not.toHaveBeenCalled()
    expect(listTools).not.toHaveBeenCalled()
  })

  it('saves audience changes immediately and keeps the previous mode when save fails', async () => {
    const user = userEvent.setup()
    const alpha = agent('alpha', 'Alpha')
    const putAccessConfig = vi.fn(async () => {
      throw new ApiError(422, 'Cannot remove the owning group')
    })
    const activateAccessConfig = vi.fn(async () => {
      throw new Error('should not activate')
    })
    renderPage(
      createClient({
        listAgents: async () => ({ items: [alpha], next_cursor: null }),
        getAgent: async () => alpha,
        getAccessConfig: async () => ({
          agent_id: 'alpha',
          authorization_mode: 'legacy_grants',
          audience_effective: false,
          audience_mode: 'groups',
          owning_group_id: null,
          owning_group_name: null,
          group_ids: [],
          groups: [],
          updated_at: '2026-01-01T00:00:00Z',
        }),
        putAccessConfig,
        activateAccessConfig,
        listAllGroups: async () => [
          { id: 'g1', name: 'Ops', description: null, designation: null, member_count: 0, agent_count: 0 },
        ],
      }),
      businessAdmin,
    )
    await user.click(await screen.findByRole('button', { name: /Alpha/ }))
    await screen.findByRole('heading', { name: 'Who can use this agent?' })
    await user.click(screen.getByRole('radio', { name: 'Everyone in the company' }))
    expect(await screen.findByText('Cannot remove the owning group')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Selected groups' })).toBeChecked()
    expect(activateAccessConfig).not.toHaveBeenCalled()
  })

  it('hides legacy grants only for the opened audience-effective agent', async () => {
    const user = userEvent.setup()
    const audienceAgent = agent('audience', 'Audience')
    const legacyAgent = agent('legacy', 'Legacy')
    renderPage(
      createClient({
        listAgents: async () => ({
          items: [audienceAgent, legacyAgent],
          next_cursor: null,
        }),
        getAgent: async (id) => (id === 'audience' ? audienceAgent : legacyAgent),
        getAccessConfig: async (id) => ({
          agent_id: id,
          authorization_mode: id === 'audience' ? 'audience' : 'legacy_grants',
          audience_effective: id === 'audience',
          audience_mode: 'groups',
          owning_group_id: null,
          owning_group_name: null,
          group_ids: [],
          groups: [],
          updated_at: '2026-01-01T00:00:00Z',
        }),
        listGrants: async () => ({ items: [], next_cursor: null }),
      }),
      accessAdmin,
    )

    expect(await screen.findByRole('heading', { name: 'Access grants' })).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: /Audience/ }))
    await screen.findByRole('heading', { name: 'Who can use this agent?' })
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Access grants' })).not.toBeInTheDocument()
    })

    await user.click(await screen.findByRole('button', { name: /Legacy/ }))
    await screen.findByRole('heading', { name: 'Who can use this agent?' })
    expect(await screen.findByRole('heading', { name: 'Access grants' })).toBeInTheDocument()
  })

  it('restores legacy grants after a failed open following an audience-effective agent', async () => {
    const user = userEvent.setup()
    const audienceAgent = agent('audience', 'Audience')
    const broken = agent('broken', 'Broken')
    renderPage(
      createClient({
        listAgents: async () => ({
          items: [audienceAgent, broken],
          next_cursor: null,
        }),
        getAgent: async (id) => (id === 'broken' ? broken : audienceAgent),
        getConfiguration: async (id) => {
          if (id === 'broken') {
            throw new Error('network down')
          }
          return configuration()
        },
        getAccessConfig: async (id) => ({
          agent_id: id,
          authorization_mode: id === 'audience' ? 'audience' : 'legacy_grants',
          audience_effective: id === 'audience',
          audience_mode: 'groups',
          owning_group_id: null,
          owning_group_name: null,
          group_ids: [],
          groups: [],
          updated_at: '2026-01-01T00:00:00Z',
        }),
        listGrants: async () => ({ items: [], next_cursor: null }),
      }),
      superAdmin,
    )

    await user.click(await screen.findByRole('button', { name: /Audience/ }))
    await screen.findByRole('heading', { name: 'Who can use this agent?' })
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Access grants' })).not.toBeInTheDocument()
    })

    await user.click(await screen.findByRole('button', { name: /Broken/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this agent.')
    expect(await screen.findByRole('heading', { name: 'Access grants' })).toBeInTheDocument()
  })

  it('adds a group from the search dialog', async () => {
    const user = userEvent.setup()
    const alpha = agent('alpha', 'Alpha')
    const putAccessConfig = vi.fn(async () => ({
      agent_id: 'alpha',
      authorization_mode: 'audience' as const,
      audience_effective: true,
      audience_mode: 'groups' as const,
      owning_group_id: null,
      owning_group_name: null,
      group_ids: ['g1'],
      groups: [{ group_id: 'g1', name: 'Ops', is_owning: false }],
      updated_at: '2026-01-01T00:00:00Z',
    }))
    renderPage(
      createClient({
        listAgents: async () => ({ items: [alpha], next_cursor: null }),
        getAgent: async () => alpha,
        getAccessConfig: async () => ({
          agent_id: 'alpha',
          authorization_mode: 'audience',
          audience_effective: true,
          audience_mode: 'groups',
          owning_group_id: null,
          owning_group_name: null,
          group_ids: [],
          groups: [],
          updated_at: '2026-01-01T00:00:00Z',
        }),
        putAccessConfig,
        listAllGroups: async () => [
          { id: 'g1', name: 'Ops', description: null, designation: null, member_count: 0, agent_count: 0 },
        ],
        listMemberships: async () => ({ items: [], next_cursor: null }),
        listGrants: async () => ({ items: [], next_cursor: null }),
      }),
      accessAdmin,
    )

    await user.click(await screen.findByRole('button', { name: /Alpha/ }))
    await screen.findByRole('heading', { name: 'Who can use this agent?' })
    await user.click(screen.getByRole('button', { name: 'Add group' }))
    await user.click(screen.getByRole('radio', { name: 'Ops' }))
    const addButtons = screen.getAllByRole('button', { name: 'Add group' })
    await user.click(addButtons[addButtons.length - 1])
    expect(await screen.findByRole('link', { name: 'Ops' })).toBeInTheDocument()
    expect(putAccessConfig).toHaveBeenCalled()
  })
})
