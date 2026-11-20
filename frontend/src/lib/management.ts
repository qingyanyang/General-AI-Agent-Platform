import { apiUrl } from '@/lib/api'
import { apiErrorFromResponse, ApiError } from '@/lib/errors'

const PAGE_LIMIT = 100

export type AgentRecord = {
  id: string
  name: string
  description: string | null
  status: string
  created_by: string
  created_at: string
  updated_at: string
}

export type AgentPage = {
  items: AgentRecord[]
  next_cursor: string | null
}

export type AgentConfiguration = {
  system_prompt: string
  llm_provider: string
  llm_model: string
  temperature: number | null
  tool_names: string[]
  skill_names: string[]
  approval_tool_names: string[]
}

export type ToolCatalogItem = {
  name: string
  description: string
}

export type LlmModel = {
  provider: string
  model: string
  temperature_min: number | null
  temperature_max: number | null
}

export type SkillSummary = {
  name: string
  description: string
}

export type AccessGrant = {
  id: string
  user_id: string
  agent_id: string
  can_view: boolean
  can_configure: boolean
  can_execute: boolean
}

export type GrantPage = {
  items: AccessGrant[]
  next_cursor: string | null
}

export type GrantUpsert = {
  user_id: string
  agent_id: string
  can_view: boolean
  can_configure: boolean
  can_execute: boolean
}

export type ExecutionRecord = {
  id: string
  user_id: string
  agent_id: string
  session_id: string | null
  status: string
  started_at: string
  completed_at: string | null
  duration_ms: number | null
  error_summary: string | null
  langsmith_run_id: string
}

export type ExecutionPage = {
  items: ExecutionRecord[]
  next_cursor: string | null
}

export type ExecutionQuery = {
  agentId?: string
  status?: string
  cursor?: string
}

export type AgentPatch = {
  name?: string
  description?: string | null
}

export type AccessAudienceMode = 'company' | 'groups'
export type AccessAuthorizationMode = 'legacy_grants' | 'audience'

export type AccessConfigGroup = {
  group_id: string
  name: string
  is_owning: boolean
}

export type AgentAccessConfig = {
  agent_id: string
  authorization_mode: AccessAuthorizationMode
  audience_effective: boolean
  audience_mode: AccessAudienceMode | null
  owning_group_id: string | null
  owning_group_name: string | null
  group_ids: string[]
  groups: AccessConfigGroup[]
  updated_at: string
}

export type AgentAccessConfigUpdate = {
  audience_mode: AccessAudienceMode
  owning_group_id: string | null
  group_ids: string[]
}

export type GroupRecord = {
  id: string
  name: string
  description: string | null
}

export type GroupPage = {
  items: GroupRecord[]
  next_cursor: string | null
}

export interface ManagementClient {
  listAgents(cursor?: string): Promise<AgentPage>
  getAgent(id: string): Promise<AgentRecord>
  createAgent(body: { id: string; name: string; description: string | null }): Promise<AgentRecord>
  updateAgent(id: string, patch: AgentPatch, signal?: AbortSignal): Promise<AgentRecord>
  deactivateAgent(id: string, signal?: AbortSignal): Promise<AgentRecord>
  getConfiguration(id: string): Promise<AgentConfiguration>
  putConfiguration(
    id: string,
    body: AgentConfiguration,
    signal?: AbortSignal,
  ): Promise<AgentConfiguration>
  getAccessConfig(id: string): Promise<AgentAccessConfig>
  putAccessConfig(id: string, body: AgentAccessConfigUpdate): Promise<AgentAccessConfig>
  activateAccessConfig(id: string): Promise<AgentAccessConfig>
  listGroups(cursor?: string): Promise<GroupPage>
  listAllGroups(): Promise<GroupRecord[]>
  listTools(): Promise<ToolCatalogItem[]>
  listModels(): Promise<LlmModel[]>
  listSkills(): Promise<SkillSummary[]>
  listGrants(agentId: string, cursor?: string): Promise<GrantPage>
  upsertGrant(body: GrantUpsert): Promise<AccessGrant | null>
  deleteGrant(userId: string, agentId: string): Promise<void>
  listExecutions(query?: ExecutionQuery): Promise<ExecutionPage>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unexpectedResponse(): ApiError {
  return new ApiError(500, 'The server returned an unexpected response.')
}

function parseCursor(value: unknown): string | null {
  if (!(typeof value === 'string' || value === null)) {
    throw unexpectedResponse()
  }
  return value
}

function parseAgent(value: unknown): AgentRecord {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.status !== 'string' ||
    typeof value.created_by !== 'string' ||
    typeof value.created_at !== 'string' ||
    typeof value.updated_at !== 'string' ||
    !(typeof value.description === 'string' || value.description === null)
  ) {
    throw unexpectedResponse()
  }
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    status: value.status,
    created_by: value.created_by,
    created_at: value.created_at,
    updated_at: value.updated_at,
  }
}

function parseAgentPage(value: unknown): AgentPage {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw unexpectedResponse()
  }
  return { items: value.items.map(parseAgent), next_cursor: parseCursor(value.next_cursor) }
}

function parseConfiguration(value: unknown): AgentConfiguration {
  if (
    !isRecord(value) ||
    typeof value.system_prompt !== 'string' ||
    typeof value.llm_provider !== 'string' ||
    typeof value.llm_model !== 'string' ||
    !(typeof value.temperature === 'number' || value.temperature === null)
  ) {
    throw unexpectedResponse()
  }
  return {
    system_prompt: value.system_prompt,
    llm_provider: value.llm_provider,
    llm_model: value.llm_model,
    temperature: value.temperature,
    tool_names: stringList(value.tool_names),
    skill_names: stringList(value.skill_names),
    approval_tool_names: stringList(value.approval_tool_names),
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw unexpectedResponse()
  }
  return value
}

function parseNamed(value: unknown): { name: string; description: string } {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.description !== 'string') {
    throw unexpectedResponse()
  }
  return { name: value.name, description: value.description }
}

function parseNamedList(value: unknown): { name: string; description: string }[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw unexpectedResponse()
  }
  return value.items.map(parseNamed)
}

function parseModel(value: unknown): LlmModel {
  if (
    !isRecord(value) ||
    typeof value.provider !== 'string' ||
    typeof value.model !== 'string' ||
    !(typeof value.temperature_min === 'number' || value.temperature_min === null) ||
    !(typeof value.temperature_max === 'number' || value.temperature_max === null)
  ) {
    throw unexpectedResponse()
  }
  return {
    provider: value.provider,
    model: value.model,
    temperature_min: value.temperature_min,
    temperature_max: value.temperature_max,
  }
}

function parseModels(value: unknown): LlmModel[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw unexpectedResponse()
  }
  return value.items.map(parseModel)
}

function parseGrant(value: unknown): AccessGrant {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.user_id !== 'string' ||
    typeof value.agent_id !== 'string' ||
    typeof value.can_view !== 'boolean' ||
    typeof value.can_configure !== 'boolean' ||
    typeof value.can_execute !== 'boolean'
  ) {
    throw unexpectedResponse()
  }
  return {
    id: value.id,
    user_id: value.user_id,
    agent_id: value.agent_id,
    can_view: value.can_view,
    can_configure: value.can_configure,
    can_execute: value.can_execute,
  }
}

function parseGrantPage(value: unknown): GrantPage {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw unexpectedResponse()
  }
  return { items: value.items.map(parseGrant), next_cursor: parseCursor(value.next_cursor) }
}

function parseExecution(value: unknown): ExecutionRecord {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.user_id !== 'string' ||
    typeof value.agent_id !== 'string' ||
    typeof value.status !== 'string' ||
    typeof value.started_at !== 'string' ||
    typeof value.langsmith_run_id !== 'string' ||
    !(typeof value.session_id === 'string' || value.session_id === null) ||
    !(typeof value.completed_at === 'string' || value.completed_at === null) ||
    !(typeof value.duration_ms === 'number' || value.duration_ms === null) ||
    !(typeof value.error_summary === 'string' || value.error_summary === null)
  ) {
    throw unexpectedResponse()
  }
  return {
    id: value.id,
    user_id: value.user_id,
    agent_id: value.agent_id,
    session_id: value.session_id,
    status: value.status,
    started_at: value.started_at,
    completed_at: value.completed_at,
    duration_ms: value.duration_ms,
    error_summary: value.error_summary,
    langsmith_run_id: value.langsmith_run_id,
  }
}

function parseExecutionPage(value: unknown): ExecutionPage {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw unexpectedResponse()
  }
  return {
    items: value.items.map(parseExecution),
    next_cursor: parseCursor(value.next_cursor),
  }
}

function parseAccessConfigGroup(value: unknown): AccessConfigGroup {
  if (
    !isRecord(value) ||
    typeof value.group_id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.is_owning !== 'boolean'
  ) {
    throw unexpectedResponse()
  }
  return {
    group_id: value.group_id,
    name: value.name,
    is_owning: value.is_owning,
  }
}

function parseAccessConfig(value: unknown): AgentAccessConfig {
  if (
    !isRecord(value) ||
    typeof value.agent_id !== 'string' ||
    (value.authorization_mode !== 'legacy_grants' && value.authorization_mode !== 'audience') ||
    typeof value.audience_effective !== 'boolean' ||
    !(value.audience_mode === 'company' || value.audience_mode === 'groups' || value.audience_mode === null) ||
    !(typeof value.owning_group_id === 'string' || value.owning_group_id === null) ||
    !(typeof value.owning_group_name === 'string' || value.owning_group_name === null) ||
    !Array.isArray(value.group_ids) ||
    value.group_ids.some((item) => typeof item !== 'string') ||
    !Array.isArray(value.groups) ||
    typeof value.updated_at !== 'string'
  ) {
    throw unexpectedResponse()
  }
  return {
    agent_id: value.agent_id,
    authorization_mode: value.authorization_mode,
    audience_effective: value.audience_effective,
    audience_mode: value.audience_mode,
    owning_group_id: value.owning_group_id,
    owning_group_name: value.owning_group_name,
    group_ids: value.group_ids,
    groups: value.groups.map(parseAccessConfigGroup),
    updated_at: value.updated_at,
  }
}

function parseGroup(value: unknown): GroupRecord {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !(typeof value.description === 'string' || value.description === null)
  ) {
    throw unexpectedResponse()
  }
  return {
    id: value.id,
    name: value.name,
    description: value.description,
  }
}

function parseGroupPage(value: unknown): GroupPage {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw unexpectedResponse()
  }
  return { items: value.items.map(parseGroup), next_cursor: parseCursor(value.next_cursor) }
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw await apiErrorFromResponse(response)
  }
  return (await response.json()) as unknown
}

export function createManagementClient(
  getAccessToken: () => Promise<string>,
): ManagementClient {
  async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await getAccessToken()
    if (init.signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    if (init.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    return fetch(apiUrl(path), { ...init, headers })
  }

  function pageQuery(cursor?: string, extra?: Record<string, string>): string {
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT), ...extra })
    if (cursor) {
      params.set('cursor', cursor)
    }
    return params.toString()
  }

  return {
    async listAgents(cursor?: string) {
      const response = await authorizedFetch(`/agents?${pageQuery(cursor, { status: 'all' })}`)
      return parseAgentPage(await readJson(response))
    },
    async getAgent(id: string) {
      const response = await authorizedFetch(`/agents/${encodeURIComponent(id)}`)
      return parseAgent(await readJson(response))
    },
    async createAgent(body) {
      const response = await authorizedFetch('/agents', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      return parseAgent(await readJson(response))
    },
    async updateAgent(id, patch, signal) {
      const response = await authorizedFetch(`/agents/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
        signal,
      })
      return parseAgent(await readJson(response))
    },
    async deactivateAgent(id, signal) {
      const response = await authorizedFetch(`/agents/${encodeURIComponent(id)}/deactivate`, {
        method: 'POST',
        signal,
      })
      return parseAgent(await readJson(response))
    },
    async getConfiguration(id) {
      const response = await authorizedFetch(`/agents/${encodeURIComponent(id)}/configuration`)
      return parseConfiguration(await readJson(response))
    },
    async putConfiguration(id, body, signal) {
      const response = await authorizedFetch(`/agents/${encodeURIComponent(id)}/configuration`, {
        method: 'PUT',
        body: JSON.stringify(body),
        signal,
      })
      return parseConfiguration(await readJson(response))
    },
    async getAccessConfig(id) {
      const response = await authorizedFetch(`/agents/${encodeURIComponent(id)}/access-config`)
      return parseAccessConfig(await readJson(response))
    },
    async putAccessConfig(id, body) {
      const response = await authorizedFetch(`/agents/${encodeURIComponent(id)}/access-config`, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
      return parseAccessConfig(await readJson(response))
    },
    async activateAccessConfig(id) {
      const response = await authorizedFetch(
        `/agents/${encodeURIComponent(id)}/access-config/activate`,
        { method: 'POST', body: '{}' },
      )
      return parseAccessConfig(await readJson(response))
    },
    async listGroups(cursor) {
      const response = await authorizedFetch(`/groups?${pageQuery(cursor)}`)
      return parseGroupPage(await readJson(response))
    },
    async listAllGroups() {
      const items: GroupRecord[] = []
      let cursor: string | undefined
      for (;;) {
        const page = await this.listGroups(cursor)
        items.push(...page.items)
        if (!page.next_cursor) {
          return items
        }
        cursor = page.next_cursor
      }
    },
    async listTools() {
      const response = await authorizedFetch('/tools')
      return parseNamedList(await readJson(response))
    },
    async listModels() {
      const response = await authorizedFetch('/llm-models')
      return parseModels(await readJson(response))
    },
    async listSkills() {
      const response = await authorizedFetch('/skills')
      return parseNamedList(await readJson(response))
    },
    async listGrants(agentId, cursor) {
      const response = await authorizedFetch(
        `/agent-access/grants?${pageQuery(cursor, { agent_id: agentId })}`,
      )
      return parseGrantPage(await readJson(response))
    },
    async upsertGrant(body) {
      const response = await authorizedFetch('/agent-access/grants', {
        method: 'PUT',
        body: JSON.stringify(body),
      })
      if (response.status === 204) {
        return null
      }
      return parseGrant(await readJson(response))
    },
    async deleteGrant(userId, agentId) {
      const params = new URLSearchParams({ user_id: userId, agent_id: agentId })
      const response = await authorizedFetch(`/agent-access/grants?${params.toString()}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        throw await apiErrorFromResponse(response)
      }
    },
    async listExecutions(query: ExecutionQuery = {}) {
      const extra: Record<string, string> = {}
      if (query.agentId) {
        extra.agent_id = query.agentId
      }
      if (query.status) {
        extra.status = query.status
      }
      const response = await authorizedFetch(`/executions?${pageQuery(query.cursor, extra)}`)
      return parseExecutionPage(await readJson(response))
    },
  }
}
