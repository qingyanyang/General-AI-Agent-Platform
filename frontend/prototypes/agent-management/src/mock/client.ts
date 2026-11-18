/**
 * PROTOTYPE mock API (#52, #53, #54). In-memory stand-in for the management endpoints.
 * Mirrors the backend's permission checks and status codes closely enough to
 * exercise the UI. No network requests are made.
 */
import { ApiError } from '@/lib/errors'
import type {
  AccessGrant,
  AgentConfiguration,
  AgentPage,
  AgentPatch,
  AgentRecord,
  ExecutionPage,
  ExecutionRecord,
  GrantPage,
  GrantUpsert,
  LlmModel,
  SkillSummary,
  ToolCatalogItem,
} from '@/lib/management'
import {
  AGENT_ACCESS_MANAGE,
  AGENTS_CONFIGURE,
  AGENTS_EXECUTE,
  AGENTS_READ,
} from '@/lib/permissions'

import {
  applyDraftItems,
  INSTRUCTION_CHARACTER_LIMIT,
  resetConfigurationDrafts,
  validateDraftItems,
  type PublishDraft,
} from './configuration-draft'
import {
  MOCK_MODELS,
  MOCK_SKILLS,
  personaByKey,
  seedAgents,
  seedConfigurations,
  seedExecutions,
  seedGrants,
} from './data'
import { assignedAgentIds, canAccessAgent, canEditPrompt } from './effective-access'
import { appendLog, bumpDataVersion, getOptions, setOptions } from './options'
import { AGENTS_PROMPT, PLATFORM_TECHNICAL } from './platform-permissions'
import { resetProductState, listBuiltinTools } from './product-state'
import { isGlobalBusinessRole, type RoleId } from './roles'
import {
  readAccessAudience,
  readAssignments,
  readLeadership,
  readMemberships,
  readOwning,
  resetUsersState,
} from './users-state'

export type AgentStatusFilter = 'active' | 'inactive' | 'all'

export type ExecutionQuery = {
  agentId?: string
  status?: string
  cursor?: string
}

const AGENT_PAGE = 5
const GRANT_PAGE = 4
const EXECUTION_PAGE = 6
const AGENT_ID_MAX = 64

let agents = seedAgents()
let configurations = seedConfigurations()
let grants = seedGrants()
let executions = seedExecutions()
let grantSeq = grants.length
const resetListeners = new Set<() => void>()

/** Lets the mock chat API reseed its sessions together with the management data. */
export function onMockReset(listener: () => void) {
  resetListeners.add(listener)
}

export function resetMockData() {
  agents = seedAgents()
  configurations = seedConfigurations()
  grants = seedGrants()
  executions = seedExecutions()
  grantSeq = grants.length
  resetUsersState()
  resetProductState()
  resetConfigurationDrafts()
  for (const listener of resetListeners) {
    listener()
  }
  bumpDataVersion()
}

export function getGrants(): AccessGrant[] {
  return grants
}

export function getExecutions(): ExecutionRecord[] {
  return executions
}

export function callerRole(): RoleId {
  return caller().id
}

export function callerIsGlobalAdmin(): boolean {
  return isGlobalBusinessRole(callerRole())
}

/** Visible in catalog / chat: global admins see all; others see company-wide or group-assigned agents. */
export function callerCanView(agentId: string): boolean {
  if (callerIsGlobalAdmin() && has(AGENTS_READ)) {
    return true
  }
  return (
    has(AGENTS_READ) &&
    canAccessAgent(
      readMemberships(),
      readAssignments(),
      readAccessAudience(),
      caller().userId,
      agentId,
    )
  )
}

export function callerCanExecuteAgent(agentId: string): boolean {
  if (!has(AGENTS_EXECUTE)) {
    return false
  }
  if (callerIsGlobalAdmin()) {
    return true
  }
  return canAccessAgent(
    readMemberships(),
    readAssignments(),
    readAccessAudience(),
    caller().userId,
    agentId,
  )
}

/** Full business configuration (Admin / Super Admin). Technical fields gated separately. */
export function callerCanConfigureAgent(agentId: string): boolean {
  return has(AGENTS_CONFIGURE) && callerIsGlobalAdmin() && Boolean(findAgent(agentId))
}

export function callerCanEditPrompt(agentId: string): boolean {
  if (callerCanConfigureAgent(agentId)) {
    return true
  }
  return (
    has(AGENTS_PROMPT) &&
    canEditPrompt(readLeadership(), readOwning(), caller().userId, agentId)
  )
}

export function callerVisibleAgentIds(): Set<string> | 'all' {
  if (callerIsGlobalAdmin() && has(AGENTS_READ)) {
    return 'all'
  }
  const memberships = readMemberships()
  const assignments = readAssignments()
  const audience = readAccessAudience()
  const me = caller().userId
  const ids = new Set<string>()
  for (const agent of agents) {
    if (canAccessAgent(memberships, assignments, audience, me, agent.id)) {
      ids.add(agent.id)
    }
  }
  // Keep assignedAgentIds available for diagnostics when audience is groups-only.
  for (const id of assignedAgentIds(memberships, assignments, me)) {
    ids.add(id)
  }
  return ids
}

export type Outcome<T> = { status: number; body: T } | { status: number; error: string }

export function caller() {
  return personaByKey(getOptions().persona)
}

export function has(permission: string): boolean {
  return caller().permissions.includes(permission)
}

export function grantFor(userId: string, agentId: string): AccessGrant | undefined {
  return grants.find((grant) => grant.user_id === userId && grant.agent_id === agentId)
}

export function findAgent(id: string): AgentRecord | undefined {
  return agents.find((agent) => agent.id === id)
}

export function findConfiguration(id: string): AgentConfiguration | undefined {
  return configurations[id]
}

export function addExecution(record: ExecutionRecord) {
  executions = [record, ...executions]
}

export function patchExecution(id: string, patch: Partial<ExecutionRecord>) {
  executions = executions.map((record) => (record.id === id ? { ...record, ...patch } : record))
}

export function deny(): { status: number; error: string } {
  return { status: 403, error: 'Permission denied' }
}

export function page<T>(items: T[], cursor: string | undefined, size: number) {
  const start = cursor ? Number(cursor) : 0
  const slice = items.slice(start, start + size)
  const next = start + size < items.length ? String(start + size) : null
  return { items: slice, next_cursor: next }
}

export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer)
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    })
  })
}

export async function respond<T>(
  method: string,
  path: string,
  handler: () => Outcome<T>,
  signal?: AbortSignal,
): Promise<T> {
  const { scenario } = getOptions()
  try {
    await wait(scenario === 'slow' ? 1800 : 350, signal)
  } catch (error) {
    appendLog({ method, path, status: 'aborted' })
    throw error
  }
  const outcome = handler()
  appendLog({ method, path, status: outcome.status })
  if ('error' in outcome) {
    throw new ApiError(outcome.status, outcome.error)
  }
  return outcome.body
}

function consumeSaveFailure(): Outcome<never> | null {
  if (!getOptions().failNextSave) {
    return null
  }
  setOptions({ failNextSave: false })
  return { status: 422, error: 'Mock 422: the server rejected this save.' }
}

export function scenarioError(
  kind: 'agents' | 'grants' | 'executions' | 'tools' | 'sessions' | 'users' | 'groups',
): Outcome<never> | null {
  if (getOptions().scenario !== 'errors') {
    return null
  }
  switch (kind) {
    case 'agents':
      return { status: 500, error: 'Mock 500: the agent list could not be loaded.' }
    case 'grants':
      return { status: 500, error: 'Mock 500: grants could not be loaded.' }
    case 'executions':
      return { status: 503, error: 'Mock 503: execution history is unavailable.' }
    case 'tools':
      return { status: 500, error: 'Mock 500: the tool catalog could not be loaded.' }
    case 'sessions':
      return { status: 500, error: 'Mock 500: conversations could not be loaded.' }
    case 'users':
      return { status: 500, error: 'Mock 500: the user directory could not be loaded.' }
    case 'groups':
      return { status: 500, error: 'Mock 500: groups could not be loaded.' }
    default: {
      const unreachable: never = kind
      return unreachable
    }
  }
}

export function emptyScenario(): boolean {
  return getOptions().scenario === 'empty'
}

function supportsTemperature(model: LlmModel): boolean {
  return model.temperature_min !== null && model.temperature_max !== null
}

function validateConfiguration(body: AgentConfiguration): string | null {
  if (body.system_prompt.length > INSTRUCTION_CHARACTER_LIMIT) {
    return `system_prompt must be at most ${INSTRUCTION_CHARACTER_LIMIT} characters`
  }
  const model = MOCK_MODELS.find(
    (item) => item.provider === body.llm_provider && item.model === body.llm_model,
  )
  if (!model) {
    return `LLM '${body.llm_provider}/${body.llm_model}' is not in APPROVED_LLM_MODELS`
  }
  if (supportsTemperature(model)) {
    if (body.temperature === null) {
      return `temperature is required for model '${model.provider}/${model.model}'`
    }
    if (body.temperature < (model.temperature_min ?? 0) || body.temperature > (model.temperature_max ?? 0)) {
      return `temperature must be between ${model.temperature_min} and ${model.temperature_max} for '${model.provider}/${model.model}'`
    }
  } else if (body.temperature !== null) {
    return `model '${model.provider}/${model.model}' does not support temperature`
  }
  for (const name of body.tool_names) {
    if (!listBuiltinTools().some((tool) => tool.name === name)) {
      return `unknown tool '${name}'`
    }
  }
  for (const name of body.skill_names) {
    if (!MOCK_SKILLS.some((skill) => skill.name === name)) {
      return `unknown skill '${name}'`
    }
  }
  for (const name of body.approval_tool_names) {
    if (!body.tool_names.includes(name)) {
      return `approval tool '${name}' is not in tool_names`
    }
  }
  return null
}

export const mockClient = {
  listAgents(status: AgentStatusFilter, cursor?: string): Promise<AgentPage> {
    return respond('GET', `/agents?status=${status}${cursor ? `&cursor=${cursor}` : ''}`, () => {
      if (!has(AGENTS_READ)) {
        return deny()
      }
      const failure = scenarioError('agents')
      if (failure) {
        return failure
      }
      // Users only see active agents they can access. Admins may filter by status.
      const effectiveStatus: AgentStatusFilter = callerIsGlobalAdmin() ? status : 'active'
      const visible = emptyScenario()
        ? []
        : agents.filter(
            (agent) =>
              callerCanView(agent.id) && (effectiveStatus === 'all' || agent.status === effectiveStatus),
          )
      return { status: 200, body: page(visible, cursor, AGENT_PAGE) }
    })
  },

  getAgent(id: string): Promise<AgentRecord> {
    return respond('GET', `/agents/${id}`, () => {
      if (!has(AGENTS_READ)) {
        return deny()
      }
      const agent = agents.find((item) => item.id === id)
      if (!agent || !callerCanView(id)) {
        return { status: 404, error: 'Agent not found' }
      }
      // Users cannot open inactive agents even by direct URL.
      if (!callerIsGlobalAdmin() && agent.status !== 'active') {
        return { status: 404, error: 'Agent not found' }
      }
      return { status: 200, body: agent }
    })
  },

  createAgent(body: { id: string; name: string; description: string | null }): Promise<AgentRecord> {
    return respond('POST', '/agents', () => {
      if (!has(AGENTS_CONFIGURE) || !callerIsGlobalAdmin()) {
        return deny()
      }
      const failure = consumeSaveFailure()
      if (failure) {
        return failure
      }
      const id = body.id.trim()
      if (!id) {
        return { status: 422, error: 'id must be a non-empty string' }
      }
      if (id.length > AGENT_ID_MAX) {
        return { status: 422, error: `id must be at most ${AGENT_ID_MAX} characters` }
      }
      if (!body.name.trim()) {
        return { status: 422, error: 'name must be a non-empty string' }
      }
      if (agents.some((agent) => agent.id === id)) {
        return { status: 409, error: 'Agent already exists' }
      }
      const now = new Date().toISOString()
      const me = caller().userId
      const created: AgentRecord = {
        id,
        name: body.name.trim(),
        description: body.description,
        status: 'active',
        created_by: me,
        created_at: now,
        updated_at: now,
      }
      agents = [created, ...agents]
      configurations = {
        ...configurations,
        [id]: {
          system_prompt: '',
          llm_provider: 'deepseek',
          llm_model: 'deepseek-flash',
          temperature: 1,
          tool_names: [],
          skill_names: [],
          approval_tool_names: [],
        },
      }
      grantSeq += 1
      grants = [
        {
          id: `mock-grant-${String(grantSeq).padStart(3, '0')}`,
          user_id: me,
          agent_id: id,
          can_view: true,
          can_configure: true,
          can_execute: true,
        },
        ...grants,
      ]
      return { status: 201, body: created }
    })
  },

  updateAgent(id: string, patch: AgentPatch, signal?: AbortSignal): Promise<AgentRecord> {
    return respond(
      'PATCH',
      `/agents/${id}`,
      () => {
        if (!has(AGENTS_CONFIGURE)) {
          return deny()
        }
        const agent = agents.find((item) => item.id === id)
        if (!agent) {
          return { status: 404, error: 'Agent not found' }
        }
        if (!callerCanConfigureAgent(id)) {
          return { status: 403, error: 'Agent access denied' }
        }
        const failure = consumeSaveFailure()
        if (failure) {
          return failure
        }
        if (patch.name !== undefined && !patch.name.trim()) {
          return { status: 422, error: 'name must be a non-empty string' }
        }
        const updated: AgentRecord = {
          ...agent,
          name: patch.name?.trim() ?? agent.name,
          description: patch.description === undefined ? agent.description : patch.description,
          updated_at: new Date().toISOString(),
        }
        agents = agents.map((item) => (item.id === id ? updated : item))
        return { status: 200, body: updated }
      },
      signal,
    )
  },

  deactivateAgent(id: string): Promise<AgentRecord> {
    return respond('POST', `/agents/${id}/deactivate`, () => {
      if (!has(AGENTS_CONFIGURE)) {
        return deny()
      }
      const agent = agents.find((item) => item.id === id)
      if (!agent) {
        return { status: 404, error: 'Agent not found' }
      }
      if (!callerCanConfigureAgent(id)) {
        return { status: 403, error: 'Agent access denied' }
      }
      const updated: AgentRecord = { ...agent, status: 'inactive', updated_at: new Date().toISOString() }
      agents = agents.map((item) => (item.id === id ? updated : item))
      return { status: 200, body: updated }
    })
  },

  getConfiguration(id: string): Promise<AgentConfiguration> {
    return respond('GET', `/agents/${id}/configuration`, () => {
      const config = configurations[id]
      if (!config) {
        return { status: 404, error: 'Agent not found' }
      }
      // Full configure for Admin; prompt editors may read the config they can patch.
      if (callerCanConfigureAgent(id) || callerCanEditPrompt(id)) {
        return { status: 200, body: config }
      }
      if (!has(AGENTS_CONFIGURE) && !has(AGENTS_PROMPT)) {
        return deny()
      }
      return { status: 403, error: 'Agent access denied' }
    })
  },

  putConfiguration(id: string, body: AgentConfiguration, signal?: AbortSignal): Promise<AgentConfiguration> {
    return respond(
      'PUT',
      `/agents/${id}/configuration`,
      () => {
        if (!has(AGENTS_CONFIGURE) || !has(PLATFORM_TECHNICAL)) {
          return deny()
        }
        if (!configurations[id]) {
          return { status: 404, error: 'Agent not found' }
        }
        if (!callerCanConfigureAgent(id)) {
          return { status: 403, error: 'Agent access denied' }
        }
        const failure = consumeSaveFailure()
        if (failure) {
          return failure
        }
        const invalid = validateConfiguration(body)
        if (invalid) {
          return { status: 422, error: invalid }
        }
        configurations = { ...configurations, [id]: body }
        return { status: 200, body }
      },
      signal,
    )
  },

  publishConfiguration(id: string, draft: PublishDraft, signal?: AbortSignal): Promise<AgentConfiguration | null> {
    return respond('POST', `/agents/${id}/configuration/publish`, () => {
      if (!configurations[id] || !findAgent(id)) {
        return { status: 404, error: 'Agent not found' }
      }
      if (!callerCanEditPrompt(id)) {
        return deny()
      }
      const technicalChanges = draft.configuration !== null || Object.keys(draft.connections).length > 0 ||
        Object.keys(draft.mcpTools).length > 0
      if (technicalChanges && (!callerCanConfigureAgent(id) || !has(PLATFORM_TECHNICAL))) {
        return deny()
      }
      if (Object.keys(draft.knowledge).length > 0 && !callerCanConfigureAgent(id)) {
        return deny()
      }

      const failure = consumeSaveFailure()
      if (failure) {
        return failure
      }
      const invalid = (draft.configuration && validateConfiguration(draft.configuration)) ?? validateDraftItems(id, draft)
      if (invalid) {
        return { status: 422, error: invalid }
      }

      applyDraftItems(id, draft)
      if (draft.configuration) {
        configurations = { ...configurations, [id]: draft.configuration }
      }
      return { status: 200, body: draft.configuration }
    }, signal)
  },

  /** Prompt-only update for owning-group leaders (or Admins via configure path). */
  putPrompt(id: string, systemPrompt: string, signal?: AbortSignal): Promise<AgentConfiguration> {
    return respond(
      'PATCH',
      `/agents/${id}/configuration/prompt`,
      () => {
        if (!callerCanEditPrompt(id)) {
          return { status: 403, error: 'Agent access denied' }
        }
        const current = configurations[id]
        if (!current) {
          return { status: 404, error: 'Agent not found' }
        }
        if (systemPrompt.length > INSTRUCTION_CHARACTER_LIMIT) {
          return { status: 422, error: `system_prompt must be at most ${INSTRUCTION_CHARACTER_LIMIT} characters` }
        }
        const failure = consumeSaveFailure()
        if (failure) {
          return failure
        }
        const body = { ...current, system_prompt: systemPrompt }
        configurations = { ...configurations, [id]: body }
        return { status: 200, body }
      },
      signal,
    )
  },

  listTools(): Promise<ToolCatalogItem[]> {
    return respond('GET', '/tools', () => {
      if (!has(AGENTS_CONFIGURE) || !has(PLATFORM_TECHNICAL)) {
        return deny()
      }
      return scenarioError('tools') ?? { status: 200, body: listBuiltinTools() }
    })
  },

  listModels(): Promise<LlmModel[]> {
    return respond('GET', '/llm-models', () => {
      if (!has(AGENTS_CONFIGURE) || !has(PLATFORM_TECHNICAL)) {
        return deny()
      }
      return { status: 200, body: MOCK_MODELS }
    })
  },

  listSkills(): Promise<SkillSummary[]> {
    return respond('GET', '/skills', () => {
      if (!has(AGENTS_READ) || getOptions().skillsForbidden) {
        return deny()
      }
      return { status: 200, body: MOCK_SKILLS }
    })
  },

  listGrants(agentId: string, cursor?: string): Promise<GrantPage> {
    return respond('GET', `/agent-access/grants?agent_id=${agentId}${cursor ? `&cursor=${cursor}` : ''}`, () => {
      if (!has(AGENT_ACCESS_MANAGE)) {
        return deny()
      }
      const failure = scenarioError('grants')
      if (failure) {
        return failure
      }
      const matching = emptyScenario() ? [] : grants.filter((grant) => grant.agent_id === agentId)
      return { status: 200, body: page(matching, cursor, GRANT_PAGE) }
    })
  },

  upsertGrant(body: GrantUpsert): Promise<AccessGrant | null> {
    return respond('PUT', '/agent-access/grants', () => {
      if (!has(AGENT_ACCESS_MANAGE)) {
        return deny()
      }
      const failure = consumeSaveFailure()
      if (failure) {
        return failure
      }
      if (!body.user_id.trim()) {
        return { status: 422, error: 'user_id must be a non-empty string' }
      }
      if (!agents.some((agent) => agent.id === body.agent_id)) {
        return { status: 422, error: 'Unknown agent_id' }
      }
      const existing = grantFor(body.user_id, body.agent_id)
      if (!body.can_view && !body.can_configure && !body.can_execute) {
        grants = grants.filter((grant) => grant !== existing)
        return { status: 204, body: null }
      }
      if (existing) {
        const updated = { ...existing, ...body }
        grants = grants.map((grant) => (grant === existing ? updated : grant))
        return { status: 200, body: updated }
      }
      grantSeq += 1
      const created: AccessGrant = { id: `mock-grant-${String(grantSeq).padStart(3, '0')}`, ...body }
      grants = [created, ...grants]
      return { status: 200, body: created }
    })
  },

  deleteGrant(userId: string, agentId: string): Promise<void> {
    return respond('DELETE', `/agent-access/grants?user_id=${userId}&agent_id=${agentId}`, () => {
      if (!has(AGENT_ACCESS_MANAGE)) {
        return deny()
      }
      const existing = grantFor(userId, agentId)
      if (!existing) {
        return { status: 404, error: 'Grant not found' }
      }
      grants = grants.filter((grant) => grant !== existing)
      return { status: 204, body: undefined }
    })
  },

  listExecutions(query: ExecutionQuery): Promise<ExecutionPage> {
    const params = new URLSearchParams()
    if (query.agentId) params.set('agent_id', query.agentId)
    if (query.status) params.set('status', query.status)
    if (query.cursor) params.set('cursor', query.cursor)
    return respond('GET', `/executions?${params.toString()}`, () => {
      if (!has(AGENTS_READ)) {
        return deny()
      }
      const failure = scenarioError('executions')
      if (failure) {
        return failure
      }
      const me = caller().userId
      const owned = emptyScenario()
        ? []
        : executions.filter(
            (execution) =>
              execution.user_id === me &&
              (!query.agentId || execution.agent_id === query.agentId) &&
              (!query.status || execution.status === query.status),
          )
      return { status: 200, body: page(owned, query.cursor, EXECUTION_PAGE) }
    })
  },
}

export type MockClient = typeof mockClient
