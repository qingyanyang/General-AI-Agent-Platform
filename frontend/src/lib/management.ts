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

export type GroupDesignation = 'member' | 'leader'

export type GroupRecord = {
  id: string
  name: string
  description: string | null
  designation: GroupDesignation | null
  member_count: number
  agent_count: number
  created_at?: string
  updated_at?: string
}

export type GroupAgent = {
  agent_id: string
  agent_name: string | null
  is_owning: boolean
}

export type KnowledgeReference = { id: string; name: string; size: string }

export type AccessSource = {
  kind: 'company' | 'group' | 'grant'
  group_id: string | null
  name: string | null
}

export type EffectiveAccess = {
  agent_id: string
  agent_name: string | null
  can_use: boolean
  can_edit_prompt: boolean
  sources: AccessSource[]
}

export type ExecutionSummary = {
  total: number
  by_status: Record<string, number>
}

export type UsageCompleteness = 'not_captured' | 'unknown' | 'partial' | 'complete'

export type RunTokens = {
  completeness: UsageCompleteness
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
}

export type EstimatedModelCost = {
  completeness: UsageCompleteness
  totals: { currency: string; amount: string }[]
}

export type RunUsage = ExecutionRecord & {
  models: { provider: string; model: string }[]
  tokens: RunTokens
  estimated_model_cost: EstimatedModelCost
}

type ToolCallUsage = {
  id: string
  name: string
  status: string
  started_at: string
  duration_ms: number | null
}

type ModelCallUsage = Omit<ToolCallUsage, 'name'> & {
  provider: string
  requested_model: string
  reported_model: string | null
  tokens: RunTokens
  cached_input_tokens: number | null
  cache_write_tokens: number | null
  estimated_model_cost: EstimatedModelCost
}

export type RunUsageDetail = RunUsage & {
  model_calls: ModelCallUsage[]
  tool_calls: ToolCallUsage[]
}

export type ExecutionUsagePage = {
  items: RunUsage[]
  next_cursor: string | null
  summary: ExecutionSummary
}

export type GroupPage = {
  items: GroupRecord[]
  next_cursor: string | null
}

export type GroupCreate = {
  name: string
  description?: string | null
}

export type GroupMembership = {
  group_id: string
  user_id: string
  designation: GroupDesignation
  display_name: string | null
  email: string | null
  created_at: string
  updated_at: string
}

export type DirectoryRole = 'user' | 'admin' | 'super-admin'
export type DirectoryStatus = 'active' | 'pending' | 'disabled'

export type DirectoryUser = {
  user_id: string
  email: string | null
  display_name: string | null
  email_verified: boolean
  role: DirectoryRole | null
  status: DirectoryStatus
  first_seen_at: string
  last_seen_at: string
}

export type UserMembership = {
  group_id: string
  group_name: string
  designation: GroupDesignation
}

export type DirectoryUserDetail = DirectoryUser & {
  memberships: UserMembership[]
}

export type DirectoryUserPage = {
  items: DirectoryUser[]
  next_cursor: string | null
}

export type MembershipPage = {
  items: GroupMembership[]
  next_cursor: string | null
}

export type InstructionSkillItem = {
  id: string
  name: string
  description: string
  instructions: string
}

export type InstructionSkillsOut = {
  items: InstructionSkillItem[]
}

export type InstructionSkillInput = {
  name: string
  description: string
  instructions: string
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
  getInstructionSkills(agentId: string): Promise<InstructionSkillsOut>
  putInstructionSkills(
    agentId: string,
    items: InstructionSkillInput[],
  ): Promise<InstructionSkillsOut>
  getKnowledgeReferences(agentId: string): Promise<KnowledgeReference[]>
  putKnowledgeReferences(agentId: string, items: KnowledgeReference[]): Promise<KnowledgeReference[]>
  listGroups(cursor?: string): Promise<GroupPage>
  listAllGroups(): Promise<GroupRecord[]>
  createGroup(body: GroupCreate): Promise<GroupRecord>
  getGroup(groupId: string): Promise<GroupRecord>
  updateGroup(groupId: string, body: GroupCreate): Promise<GroupRecord>
  deleteGroup(groupId: string): Promise<void>
  listGroupAgents(groupId: string): Promise<GroupAgent[]>
  assignGroupAgent(groupId: string, agentId: string): Promise<void>
  unassignGroupAgent(groupId: string, agentId: string): Promise<void>
  listMemberships(groupId: string, cursor?: string): Promise<MembershipPage>
  upsertMembership(
    groupId: string,
    body: { user_id: string; designation: GroupDesignation },
  ): Promise<GroupMembership>
  deleteMembership(groupId: string, userId: string): Promise<void>
  listUsers(
    query?: string,
    cursor?: string,
    filters?: { role?: DirectoryRole; excludeGroupId?: string },
  ): Promise<DirectoryUserPage>
  getUser(userId: string): Promise<DirectoryUserDetail>
  listUserAccess(userId: string): Promise<EffectiveAccess[]>
  listUserExecutions(
    userId: string,
    query?: ExecutionQuery & { from?: string; to?: string },
  ): Promise<ExecutionUsagePage>
  getUserExecutionUsage(userId: string, executionId: string): Promise<RunUsageDetail>
  inviteUser(body: {
    email: string
    role: DirectoryRole
    group_id?: string | null
  }): Promise<DirectoryUser>
  updateUser(
    userId: string,
    patch: { role?: DirectoryRole; status?: 'active' | 'disabled' },
  ): Promise<DirectoryUser>
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

function usageCompleteness(value: unknown): UsageCompleteness {
  if (value === 'not_captured' || value === 'unknown' || value === 'partial' || value === 'complete') {
    return value
  }
  throw unexpectedResponse()
}

function optionalUsageCount(value: unknown): number | null {
  if (value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0)) {
    return value
  }
  throw unexpectedResponse()
}

function parseRunTokens(value: unknown): RunTokens {
  if (!isRecord(value)) {
    throw unexpectedResponse()
  }
  return {
    completeness: usageCompleteness(value.completeness),
    input_tokens: optionalUsageCount(value.input_tokens),
    output_tokens: optionalUsageCount(value.output_tokens),
    total_tokens: optionalUsageCount(value.total_tokens),
  }
}

function parseEstimatedModelCost(value: unknown): EstimatedModelCost {
  if (!isRecord(value) || !Array.isArray(value.totals)) {
    throw unexpectedResponse()
  }
  const totals = value.totals.map((entry: unknown) => {
    if (
      !isRecord(entry) ||
      typeof entry.currency !== 'string' || !/^[A-Z]{3}$/.test(entry.currency) ||
      typeof entry.amount !== 'string' || !/^\d+(?:\.\d+)?$/.test(entry.amount)
    ) {
      throw unexpectedResponse()
    }
    return { currency: entry.currency, amount: entry.amount }
  })
  return { completeness: usageCompleteness(value.completeness), totals }
}

function parseRunUsage(value: unknown): RunUsage {
  if (!isRecord(value) || !Array.isArray(value.models)) {
    throw unexpectedResponse()
  }
  return {
    ...parseExecution(value),
    models: value.models.map((model: unknown) => {
      if (!isRecord(model) || typeof model.provider !== 'string' || typeof model.model !== 'string') {
        throw unexpectedResponse()
      }
      return { provider: model.provider, model: model.model }
    }),
    tokens: parseRunTokens(value.tokens),
    estimated_model_cost: parseEstimatedModelCost(value.estimated_model_cost),
  }
}

function parseCallTiming(value: Record<string, unknown>) {
  if (
    typeof value.id !== 'string' ||
    typeof value.status !== 'string' ||
    typeof value.started_at !== 'string'
  ) {
    throw unexpectedResponse()
  }
  return {
    id: value.id,
    status: value.status,
    started_at: value.started_at,
    duration_ms: optionalUsageCount(value.duration_ms),
  }
}

function parseRunUsageDetail(value: unknown): RunUsageDetail {
  if (!isRecord(value) || !Array.isArray(value.model_calls) || !Array.isArray(value.tool_calls)) {
    throw unexpectedResponse()
  }
  return {
    ...parseRunUsage(value),
    model_calls: value.model_calls.map((call: unknown) => {
      if (
        !isRecord(call) || typeof call.provider !== 'string' ||
        typeof call.requested_model !== 'string' ||
        !(typeof call.reported_model === 'string' || call.reported_model === null)
      ) {
        throw unexpectedResponse()
      }
      return {
        ...parseCallTiming(call),
        provider: call.provider,
        requested_model: call.requested_model,
        reported_model: call.reported_model,
        tokens: parseRunTokens(call.tokens),
        cached_input_tokens: optionalUsageCount(call.cached_input_tokens),
        cache_write_tokens: optionalUsageCount(call.cache_write_tokens),
        estimated_model_cost: parseEstimatedModelCost(call.estimated_model_cost),
      }
    }),
    tool_calls: value.tool_calls.map((call: unknown) => {
      if (!isRecord(call) || typeof call.name !== 'string') {
        throw unexpectedResponse()
      }
      return { ...parseCallTiming(call), name: call.name }
    }),
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

function parseDesignation(value: unknown): GroupDesignation | null {
  if (value === null || value === undefined) {
    return null
  }
  if (value === 'member' || value === 'leader') {
    return value
  }
  throw unexpectedResponse()
}

function parseOptionalTimestamp(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string') {
    throw unexpectedResponse()
  }
  return value
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
  const created_at = parseOptionalTimestamp(value.created_at)
  const updated_at = parseOptionalTimestamp(value.updated_at)
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    designation: parseDesignation(value.designation),
    member_count: typeof value.member_count === 'number' ? value.member_count : 0,
    agent_count: typeof value.agent_count === 'number' ? value.agent_count : 0,
    ...(created_at !== undefined ? { created_at } : {}),
    ...(updated_at !== undefined ? { updated_at } : {}),
  }
}

function parseGroupPage(value: unknown): GroupPage {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw unexpectedResponse()
  }
  return { items: value.items.map(parseGroup), next_cursor: parseCursor(value.next_cursor) }
}

function parseInstructionSkillItem(value: unknown): InstructionSkillItem {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.description !== 'string' ||
    typeof value.instructions !== 'string'
  ) {
    throw unexpectedResponse()
  }
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    instructions: value.instructions,
  }
}

function parseKnowledgeReferences(value: unknown): KnowledgeReference[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw unexpectedResponse()
  }
  return value.items.map((item: unknown) => {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      typeof item.name !== 'string' ||
      typeof item.size !== 'string'
    ) {
      throw unexpectedResponse()
    }
    return { id: item.id, name: item.name, size: item.size }
  })
}

function parseInstructionSkills(value: unknown): InstructionSkillsOut {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw unexpectedResponse()
  }
  return { items: value.items.map(parseInstructionSkillItem) }
}

function parseMembership(value: unknown): GroupMembership {
  if (
    !isRecord(value) ||
    typeof value.group_id !== 'string' ||
    typeof value.user_id !== 'string' ||
    (value.designation !== 'member' && value.designation !== 'leader') ||
    typeof value.created_at !== 'string' ||
    typeof value.updated_at !== 'string'
  ) {
    throw unexpectedResponse()
  }
  return {
    group_id: value.group_id,
    user_id: value.user_id,
    designation: value.designation,
    display_name: typeof value.display_name === 'string' ? value.display_name : null,
    email: typeof value.email === 'string' ? value.email : null,
    created_at: value.created_at,
    updated_at: value.updated_at,
  }
}

function parseDirectoryRole(value: unknown): DirectoryRole | null {
  if (value === null) {
    return null
  }
  if (value === 'user' || value === 'admin' || value === 'super-admin') {
    return value
  }
  throw unexpectedResponse()
}

function parseDirectoryStatus(value: unknown): DirectoryStatus {
  if (value === 'active' || value === 'pending' || value === 'disabled') {
    return value
  }
  throw unexpectedResponse()
}

function parseDirectoryUser(value: unknown): DirectoryUser {
  if (
    !isRecord(value) ||
    typeof value.user_id !== 'string' ||
    typeof value.email_verified !== 'boolean' ||
    typeof value.first_seen_at !== 'string' ||
    typeof value.last_seen_at !== 'string'
  ) {
    throw unexpectedResponse()
  }
  return {
    user_id: value.user_id,
    email: typeof value.email === 'string' ? value.email : null,
    display_name: typeof value.display_name === 'string' ? value.display_name : null,
    email_verified: value.email_verified,
    role: parseDirectoryRole(value.role),
    status: parseDirectoryStatus(value.status),
    first_seen_at: value.first_seen_at,
    last_seen_at: value.last_seen_at,
  }
}

function parseUserDetail(value: unknown): DirectoryUserDetail {
  if (!isRecord(value) || !Array.isArray(value.memberships)) {
    throw unexpectedResponse()
  }
  return {
    ...parseDirectoryUser(value),
    memberships: value.memberships.map((item) => {
      if (
        !isRecord(item) ||
        typeof item.group_id !== 'string' ||
        typeof item.group_name !== 'string' ||
        (item.designation !== 'member' && item.designation !== 'leader')
      ) {
        throw unexpectedResponse()
      }
      return {
        group_id: item.group_id,
        group_name: item.group_name,
        designation: item.designation,
      }
    }),
  }
}

function parseMembershipPage(value: unknown): MembershipPage {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw unexpectedResponse()
  }
  return {
    items: value.items.map(parseMembership),
    next_cursor: parseCursor(value.next_cursor),
  }
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
    async getInstructionSkills(agentId) {
      const response = await authorizedFetch(
        `/agents/${encodeURIComponent(agentId)}/instruction-skills`,
      )
      return parseInstructionSkills(await readJson(response))
    },
    async putInstructionSkills(agentId, items) {
      const response = await authorizedFetch(
        `/agents/${encodeURIComponent(agentId)}/instruction-skills`,
        {
          method: 'PUT',
          body: JSON.stringify({
            items: items.map(({ name, description, instructions }) => ({
              name,
              description,
              instructions,
            })),
          }),
        },
      )
      return parseInstructionSkills(await readJson(response))
    },
    async getKnowledgeReferences(agentId) {
      const path = `/agents/${encodeURIComponent(agentId)}/knowledge-references`
      return parseKnowledgeReferences(await readJson(await authorizedFetch(path)))
    },
    async putKnowledgeReferences(agentId, items) {
      const path = `/agents/${encodeURIComponent(agentId)}/knowledge-references`
      const response = await authorizedFetch(path, {
        method: 'PUT',
        body: JSON.stringify({ items }),
      })
      return parseKnowledgeReferences(await readJson(response))
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
    async createGroup(body) {
      const response = await authorizedFetch('/groups', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      return parseGroup(await readJson(response))
    },
    async getGroup(groupId) {
      const response = await authorizedFetch(`/groups/${encodeURIComponent(groupId)}`)
      return parseGroup(await readJson(response))
    },
    async updateGroup(groupId, body) {
      const response = await authorizedFetch(`/groups/${encodeURIComponent(groupId)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      return parseGroup(await readJson(response))
    },
    async deleteGroup(groupId) {
      const response = await authorizedFetch(`/groups/${encodeURIComponent(groupId)}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        throw await apiErrorFromResponse(response)
      }
    },
    async assignGroupAgent(groupId, agentId) {
      const response = await authorizedFetch(`/groups/${encodeURIComponent(groupId)}/agents`, {
        method: 'POST',
        body: JSON.stringify({ agent_id: agentId }),
      })
      if (!response.ok) {
        throw await apiErrorFromResponse(response)
      }
    },
    async unassignGroupAgent(groupId, agentId) {
      const response = await authorizedFetch(
        `/groups/${encodeURIComponent(groupId)}/agents/${encodeURIComponent(agentId)}`,
        { method: 'DELETE' },
      )
      if (!response.ok) {
        throw await apiErrorFromResponse(response)
      }
    },
    async listGroupAgents(groupId) {
      const response = await authorizedFetch(`/groups/${encodeURIComponent(groupId)}/agents`)
      const body = await readJson(response)
      if (!isRecord(body) || !Array.isArray(body.items)) {
        throw unexpectedResponse()
      }
      return body.items.map((item) => {
        if (
          !isRecord(item) ||
          typeof item.agent_id !== 'string' ||
          !(typeof item.agent_name === 'string' || item.agent_name === null) ||
          typeof item.is_owning !== 'boolean'
        ) {
          throw unexpectedResponse()
        }
        return {
          agent_id: item.agent_id,
          agent_name: item.agent_name,
          is_owning: item.is_owning,
        }
      })
    },
    async listMemberships(groupId, cursor) {
      const response = await authorizedFetch(
        `/groups/${encodeURIComponent(groupId)}/memberships?${pageQuery(cursor)}`,
      )
      return parseMembershipPage(await readJson(response))
    },
    async upsertMembership(groupId, body) {
      const response = await authorizedFetch(
        `/groups/${encodeURIComponent(groupId)}/memberships`,
        {
          method: 'PUT',
          body: JSON.stringify(body),
        },
      )
      return parseMembership(await readJson(response))
    },
    async listUsers(query, cursor, filters) {
      const params = new URLSearchParams()
      if (query) {
        params.set('q', query)
      }
      if (cursor) {
        params.set('cursor', cursor)
      }
      if (filters?.role) {
        params.set('role', filters.role)
      }
      if (filters?.excludeGroupId) {
        params.set('exclude_group_id', filters.excludeGroupId)
      }
      const response = await authorizedFetch(`/users?${params.toString()}`)
      const body = await readJson(response)
      if (!isRecord(body) || !Array.isArray(body.items)) {
        throw unexpectedResponse()
      }
      return {
        items: body.items.map(parseDirectoryUser),
        next_cursor: parseCursor(body.next_cursor),
      }
    },
    async getUser(userId) {
      const response = await authorizedFetch(`/users/${encodeURIComponent(userId)}`)
      return parseUserDetail(await readJson(response))
    },
    async listUserAccess(userId) {
      const response = await authorizedFetch(`/users/${encodeURIComponent(userId)}/access`)
      const body = await readJson(response)
      if (!isRecord(body) || !Array.isArray(body.items)) {
        throw unexpectedResponse()
      }
      return body.items.map((item) => {
        if (
          !isRecord(item) ||
          typeof item.agent_id !== 'string' ||
          !(typeof item.agent_name === 'string' || item.agent_name === null) ||
          typeof item.can_use !== 'boolean' ||
          typeof item.can_edit_prompt !== 'boolean' ||
          !Array.isArray(item.sources)
        ) {
          throw unexpectedResponse()
        }
        const sources = item.sources.map((source): AccessSource => {
          if (
            !isRecord(source) ||
            (source.kind !== 'company' && source.kind !== 'group' && source.kind !== 'grant')
          ) {
            throw unexpectedResponse()
          }
          return {
            kind: source.kind,
            group_id: typeof source.group_id === 'string' ? source.group_id : null,
            name: typeof source.name === 'string' ? source.name : null,
          }
        })
        return {
          agent_id: item.agent_id,
          agent_name: item.agent_name,
          can_use: item.can_use,
          can_edit_prompt: item.can_edit_prompt,
          sources,
        }
      })
    },
    async listUserExecutions(userId, query = {}) {
      const extra: Record<string, string> = {}
      if (query.agentId) {
        extra.agent_id = query.agentId
      }
      if (query.status) {
        extra.status = query.status
      }
      if (query.from) {
        extra.from = query.from
      }
      if (query.to) {
        extra.to = query.to
      }
      const response = await authorizedFetch(
        `/users/${encodeURIComponent(userId)}/executions?${pageQuery(query.cursor, extra)}`,
      )
      const body = await readJson(response)
      if (
        !isRecord(body) || !Array.isArray(body.items) ||
        !isRecord(body.summary) || typeof body.summary.total !== 'number'
      ) {
        throw unexpectedResponse()
      }
      const byStatus = body.summary.by_status
      if (!isRecord(byStatus)) {
        throw unexpectedResponse()
      }
      const by_status: Record<string, number> = {}
      for (const [key, count] of Object.entries(byStatus)) {
        if (typeof count !== 'number') {
          throw unexpectedResponse()
        }
        by_status[key] = count
      }
      return {
        items: body.items.map(parseRunUsage),
        next_cursor: parseCursor(body.next_cursor),
        summary: { total: body.summary.total, by_status },
      }
    },
    async getUserExecutionUsage(userId, executionId) {
      const response = await authorizedFetch(
        `/users/${encodeURIComponent(userId)}/executions/${encodeURIComponent(executionId)}`,
      )
      return parseRunUsageDetail(await readJson(response))
    },
    async inviteUser(body) {
      const response = await authorizedFetch('/users/invitations', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      return parseDirectoryUser(await readJson(response))
    },
    async updateUser(userId, patch) {
      const response = await authorizedFetch(`/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      return parseDirectoryUser(await readJson(response))
    },
    async deleteMembership(groupId, userId) {
      const response = await authorizedFetch(
        `/groups/${encodeURIComponent(groupId)}/memberships/${encodeURIComponent(userId)}`,
        { method: 'DELETE' },
      )
      if (!response.ok) {
        throw await apiErrorFromResponse(response)
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
