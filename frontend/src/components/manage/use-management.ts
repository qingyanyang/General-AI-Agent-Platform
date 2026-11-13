import { useCallback, useEffect, useRef, useState } from 'react'

import { isApiError } from '@/lib/errors'
import type {
  AccessGrant,
  AgentConfiguration,
  AgentPatch,
  AgentRecord,
  LlmModel,
  ManagementClient,
  SkillSummary,
  ToolCatalogItem,
} from '@/lib/management'
import { AGENT_ACCESS_MANAGE, AGENTS_CONFIGURE, AGENTS_READ } from '@/lib/permissions'

const DISCARD_MESSAGE = 'Discard unsaved changes?'

export type MetadataForm = {
  name: string
  description: string
}

export type ConfigForm = {
  system_prompt: string
  llm_provider: string
  llm_model: string
  temperature: string
  tool_names: string[]
  skill_names: string[]
  approval_tool_names: string[]
}

type AgentDetail = {
  id: string
  metadata: AgentRecord | null
  metadataForm: MetadataForm | null
  savedMetadata: MetadataForm | null
  configForm: ConfigForm | null
  savedConfig: ConfigForm | null
  tools: ToolCatalogItem[]
  models: LlmModel[]
  skills: SkillSummary[] | null
  skillsUnavailable: boolean
  configDenied: string | null
  catalogError: string | null
}

type ManagementOptions = {
  client: ManagementClient
  permissions: ReadonlySet<string>
  onUnauthorized: () => void
}

function metadataFromAgent(agent: AgentRecord): MetadataForm {
  return { name: agent.name, description: agent.description ?? '' }
}

function configFromApi(config: AgentConfiguration): ConfigForm {
  return {
    system_prompt: config.system_prompt,
    llm_provider: config.llm_provider,
    llm_model: config.llm_model,
    temperature: config.temperature === null ? '' : String(config.temperature),
    tool_names: [...config.tool_names],
    skill_names: [...config.skill_names],
    approval_tool_names: [...config.approval_tool_names],
  }
}

function sameList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function metadataDirty(detail: AgentDetail | null): boolean {
  if (!detail?.metadataForm || !detail.savedMetadata) {
    return false
  }
  return (
    detail.metadataForm.name !== detail.savedMetadata.name ||
    detail.metadataForm.description !== detail.savedMetadata.description
  )
}

function configDirty(detail: AgentDetail | null): boolean {
  const current = detail?.configForm
  const saved = detail?.savedConfig
  if (!current || !saved) {
    return false
  }
  return (
    current.system_prompt !== saved.system_prompt ||
    current.llm_provider !== saved.llm_provider ||
    current.llm_model !== saved.llm_model ||
    current.temperature !== saved.temperature ||
    !sameList(current.tool_names, saved.tool_names) ||
    !sameList(current.skill_names, saved.skill_names) ||
    !sameList(current.approval_tool_names, saved.approval_tool_names)
  )
}

function toggleName(names: string[], name: string, enabled: boolean): string[] {
  if (enabled) {
    return names.includes(name) ? names : [...names, name]
  }
  return names.filter((item) => item !== name)
}

function errorMessage(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback
}

async function settle<T>(promise: Promise<T>): Promise<{ value: T | null; error: unknown }> {
  try {
    return { value: await promise, error: null }
  } catch (error) {
    return { value: null, error }
  }
}

function toConfiguration(form: ConfigForm, models: LlmModel[]): AgentConfiguration {
  const model = models.find(
    (item) => item.provider === form.llm_provider && item.model === form.llm_model,
  )
  const supportsTemperature =
    model !== undefined && model.temperature_min !== null && model.temperature_max !== null
  let temperature: number | null = null
  if (supportsTemperature) {
    const parsed = Number(form.temperature)
    if (!Number.isFinite(parsed)) {
      throw new Error('Temperature is required for this model.')
    }
    temperature = parsed
  } else if (model === undefined && form.temperature.trim() !== '') {
    const parsed = Number(form.temperature)
    temperature = Number.isFinite(parsed) ? parsed : null
  }
  return {
    system_prompt: form.system_prompt,
    llm_provider: form.llm_provider,
    llm_model: form.llm_model,
    temperature,
    tool_names: [...form.tool_names],
    skill_names: [...form.skill_names],
    approval_tool_names: form.approval_tool_names.filter((name) => form.tool_names.includes(name)),
  }
}

export function useManagement({ client, permissions, onUnauthorized }: ManagementOptions) {
  const canRead = permissions.has(AGENTS_READ)
  const canConfigure = permissions.has(AGENTS_CONFIGURE)
  const canManageAccess = permissions.has(AGENT_ACCESS_MANAGE)
  const [agents, setAgents] = useState<AgentRecord[]>([])
  const [agentCursor, setAgentCursor] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [detail, setDetail] = useState<AgentDetail | null>(null)
  const [agentLoading, setAgentLoading] = useState(false)
  const [agentError, setAgentError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [savingMetadata, setSavingMetadata] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [grantAgentId, setGrantAgentId] = useState('')
  const [grants, setGrants] = useState<AccessGrant[]>([])
  const [grantCursor, setGrantCursor] = useState<string | null>(null)
  const [grantLoading, setGrantLoading] = useState(false)
  const [grantError, setGrantError] = useState<string | null>(null)
  const [grantUserId, setGrantUserId] = useState('')
  const [grantView, setGrantView] = useState(true)
  const [grantConfigure, setGrantConfigure] = useState(false)
  const [grantExecute, setGrantExecute] = useState(false)
  const [executionAgentId, setExecutionAgentId] = useState('')
  const [executionStatus, setExecutionStatus] = useState('')
  const [executions, setExecutions] = useState<
    Awaited<ReturnType<ManagementClient['listExecutions']>>['items']
  >([])
  const [executionCursor, setExecutionCursor] = useState<string | null>(null)
  const [executionLoading, setExecutionLoading] = useState(false)
  const [executionError, setExecutionError] = useState<string | null>(null)
  const [createId, setCreateId] = useState('')
  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [grantQueryId, setGrantQueryId] = useState<string | null>(null)
  const [executionQuery, setExecutionQuery] = useState<{ agentId: string; status: string } | null>(
    null,
  )
  const openGeneration = useRef(0)
  const openAgentId = useRef<string | null>(null)
  const grantGeneration = useRef(0)
  const executionGeneration = useRef(0)
  const metadataSaveTicket = useRef(0)
  const configSaveTicket = useRef(0)
  const agentsRef = useRef(agents)
  agentsRef.current = agents
  const detailRef = useRef(detail)
  detailRef.current = detail

  const reportUnauthorized = useCallback(
    (error: unknown): boolean => {
      if (isApiError(error) && error.status === 401) {
        onUnauthorized()
        return true
      }
      return false
    },
    [onUnauthorized],
  )

  const loadAgents = useCallback(
    async (cursor?: string) => {
      if (!canRead) {
        return
      }
      setListLoading(true)
      setListError(null)
      try {
        const page = await client.listAgents(cursor)
        setAgents((current) => (cursor ? [...current, ...page.items] : page.items))
        setAgentCursor(page.next_cursor)
      } catch (error) {
        if (reportUnauthorized(error)) {
          return
        }
        setListError(errorMessage(error, 'Could not load agents.'))
      } finally {
        setListLoading(false)
      }
    },
    [canRead, client, reportUnauthorized],
  )

  useEffect(() => {
    void loadAgents()
  }, [loadAgents])

  const isCurrentOpen = useCallback((id: string, ticket: number) => {
    return openAgentId.current === id && openGeneration.current === ticket
  }, [])

  const loadDetail = useCallback(
    async (id: string, known: AgentRecord | null): Promise<AgentDetail> => {
      let metadata = known ?? agentsRef.current.find((agent) => agent.id === id) ?? null
      if (canRead) {
        try {
          metadata = await client.getAgent(id)
        } catch (error) {
          if (isApiError(error) && error.status === 401) {
            throw error
          }
          if (!(isApiError(error) && (error.status === 403 || error.status === 404))) {
            throw error
          }
        }
      }
      const metadataForm = metadata ? metadataFromAgent(metadata) : null
      if (!canConfigure) {
        return {
          id,
          metadata,
          metadataForm,
          savedMetadata: metadataForm,
          configForm: null,
          savedConfig: null,
          tools: [],
          models: [],
          skills: null,
          skillsUnavailable: false,
          configDenied: null,
          catalogError: null,
        }
      }
      let configuration: AgentConfiguration
      try {
        configuration = await client.getConfiguration(id)
      } catch (error) {
        if (isApiError(error) && error.status === 401) {
          throw error
        }
        if (isApiError(error) && (error.status === 403 || error.status === 404)) {
          return {
            id,
            metadata,
            metadataForm,
            savedMetadata: metadataForm,
            configForm: null,
            savedConfig: null,
            tools: [],
            models: [],
            skills: null,
            skillsUnavailable: false,
            configDenied: error.message,
            catalogError: null,
          }
        }
        throw error
      }
      const [toolsOutcome, modelsOutcome, skillsOutcome] = await Promise.all([
        settle(client.listTools()),
        settle(client.listModels()),
        settle(client.listSkills()),
      ])
      for (const outcome of [toolsOutcome, modelsOutcome, skillsOutcome]) {
        if (outcome.error && isApiError(outcome.error) && outcome.error.status === 401) {
          throw outcome.error
        }
      }
      const skillsDenied =
        skillsOutcome.error !== null &&
        isApiError(skillsOutcome.error) &&
        skillsOutcome.error.status === 403
      const catalogError =
        (toolsOutcome.error && !isApiError(toolsOutcome.error)) ||
        (toolsOutcome.error && isApiError(toolsOutcome.error) && toolsOutcome.error.status !== 403)
          ? errorMessage(toolsOutcome.error, 'Could not load tools.')
          : modelsOutcome.error
            ? errorMessage(modelsOutcome.error, 'Could not load models.')
            : null
      const form = configFromApi(configuration)
      return {
        id,
        metadata,
        metadataForm,
        savedMetadata: metadataForm,
        configForm: form,
        savedConfig: form,
        tools: toolsOutcome.value ?? [],
        models: modelsOutcome.value ?? [],
        skills: skillsDenied ? null : (skillsOutcome.value ?? []),
        skillsUnavailable: skillsDenied,
        configDenied: null,
        catalogError,
      }
    },
    [canConfigure, canRead, client],
  )

  const openAgent = useCallback(
    async (id: string, known?: AgentRecord) => {
      const trimmed = id.trim()
      if (!trimmed) {
        return
      }
      const unsaved = metadataDirty(detailRef.current) || configDirty(detailRef.current)
      if (unsaved && !window.confirm(DISCARD_MESSAGE)) {
        return
      }
      const ticket = openGeneration.current + 1
      openGeneration.current = ticket
      openAgentId.current = trimmed
      setDetail(null)
      setSavingMetadata(false)
      setSavingConfig(false)
      setAgentLoading(true)
      setAgentError(null)
      setConfigError(null)
      setActionError(null)
      try {
        const loaded = await loadDetail(trimmed, known ?? null)
        if (!isCurrentOpen(trimmed, ticket)) {
          return
        }
        setDetail(loaded)
      } catch (error) {
        if (!isCurrentOpen(trimmed, ticket) || reportUnauthorized(error)) {
          return
        }
        setDetail(null)
        setAgentError(errorMessage(error, 'Could not load this agent.'))
      } finally {
        if (isCurrentOpen(trimmed, ticket)) {
          setAgentLoading(false)
        }
      }
    },
    [isCurrentOpen, loadDetail, reportUnauthorized],
  )

  const updateMetadataField = useCallback((field: keyof MetadataForm, value: string) => {
    setDetail((current) => {
      if (!current?.metadataForm) {
        return current
      }
      return { ...current, metadataForm: { ...current.metadataForm, [field]: value } }
    })
  }, [])

  const updateConfigField = useCallback((field: keyof ConfigForm, value: string) => {
    setDetail((current) => {
      if (!current?.configForm) {
        return current
      }
      return { ...current, configForm: { ...current.configForm, [field]: value } }
    })
  }, [])

  const selectModel = useCallback((provider: string, modelName: string) => {
    setDetail((current) => {
      if (!current?.configForm) {
        return current
      }
      const model = current.models.find(
        (item) => item.provider === provider && item.model === modelName,
      )
      const supports =
        model !== undefined && model.temperature_min !== null && model.temperature_max !== null
      let temperature = current.configForm.temperature
      if (!model || !supports) {
        temperature = ''
      } else if (
        temperature.trim() === '' &&
        model.temperature_min !== null &&
        model.temperature_max !== null
      ) {
        temperature = String((model.temperature_min + model.temperature_max) / 2)
      }
      return {
        ...current,
        configForm: {
          ...current.configForm,
          llm_provider: provider,
          llm_model: modelName,
          temperature,
        },
      }
    })
  }, [])

  const toggleTool = useCallback((name: string, enabled: boolean) => {
    setDetail((current) => {
      if (!current?.configForm) {
        return current
      }
      const toolNames = toggleName(current.configForm.tool_names, name, enabled)
      return {
        ...current,
        configForm: {
          ...current.configForm,
          tool_names: toolNames,
          approval_tool_names: current.configForm.approval_tool_names.filter((item) =>
            toolNames.includes(item),
          ),
        },
      }
    })
  }, [])

  const toggleSkill = useCallback((name: string, enabled: boolean) => {
    setDetail((current) => {
      if (!current?.configForm) {
        return current
      }
      return {
        ...current,
        configForm: {
          ...current.configForm,
          skill_names: toggleName(current.configForm.skill_names, name, enabled),
        },
      }
    })
  }, [])

  const toggleApproval = useCallback((name: string, enabled: boolean) => {
    setDetail((current) => {
      if (!current?.configForm || !current.configForm.tool_names.includes(name)) {
        return current
      }
      return {
        ...current,
        configForm: {
          ...current.configForm,
          approval_tool_names: toggleName(current.configForm.approval_tool_names, name, enabled),
        },
      }
    })
  }, [])

  const saveMetadata = useCallback(async () => {
    const current = detailRef.current
    if (!current?.metadataForm || !current.savedMetadata || !canConfigure) {
      return
    }
    const patch: AgentPatch = {}
    if (current.metadataForm.name !== current.savedMetadata.name) {
      patch.name = current.metadataForm.name
    }
    if (current.metadataForm.description !== current.savedMetadata.description) {
      patch.description =
        current.metadataForm.description === '' ? null : current.metadataForm.description
    }
    if (patch.name === undefined && patch.description === undefined) {
      return
    }
    const id = current.id
    const ticket = openGeneration.current
    if (!isCurrentOpen(id, ticket)) {
      return
    }
    const saveTicket = metadataSaveTicket.current + 1
    metadataSaveTicket.current = saveTicket
    setSavingMetadata(true)
    setActionError(null)
    try {
      const updated = await client.updateAgent(id, patch)
      if (!isCurrentOpen(id, ticket)) {
        return
      }
      const form = metadataFromAgent(updated)
      setDetail((previous) => {
        if (!previous || previous.id !== id) {
          return previous
        }
        return { ...previous, metadata: updated, metadataForm: form, savedMetadata: form }
      })
      setAgents((previous) => previous.map((agent) => (agent.id === updated.id ? updated : agent)))
    } catch (error) {
      if (!isCurrentOpen(id, ticket) || reportUnauthorized(error)) {
        return
      }
      setActionError(errorMessage(error, 'Could not save agent details.'))
    } finally {
      if (metadataSaveTicket.current === saveTicket) {
        setSavingMetadata(false)
      }
    }
  }, [canConfigure, client, isCurrentOpen, reportUnauthorized])

  const saveConfiguration = useCallback(async () => {
    const current = detailRef.current
    if (!current?.configForm || !canConfigure) {
      return
    }
    let body: AgentConfiguration
    try {
      body = toConfiguration(current.configForm, current.models)
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : 'Could not save configuration.')
      return
    }
    const id = current.id
    const ticket = openGeneration.current
    if (!isCurrentOpen(id, ticket)) {
      return
    }
    const saveTicket = configSaveTicket.current + 1
    configSaveTicket.current = saveTicket
    setSavingConfig(true)
    setConfigError(null)
    try {
      const saved = await client.putConfiguration(id, body)
      if (!isCurrentOpen(id, ticket)) {
        return
      }
      const form = configFromApi(saved)
      setDetail((previous) => {
        if (!previous || previous.id !== id) {
          return previous
        }
        return { ...previous, configForm: form, savedConfig: form }
      })
    } catch (error) {
      if (!isCurrentOpen(id, ticket) || reportUnauthorized(error)) {
        return
      }
      setConfigError(errorMessage(error, 'Could not save configuration.'))
    } finally {
      if (configSaveTicket.current === saveTicket) {
        setSavingConfig(false)
      }
    }
  }, [canConfigure, client, isCurrentOpen, reportUnauthorized])

  const createAgent = useCallback(async () => {
    const id = createId.trim()
    const name = createName.trim()
    if (!id || !name) {
      setActionError('Agent id and name are required.')
      return
    }
    if (id.length > 64) {
      setActionError('Agent id must be at most 64 characters.')
      return
    }
    setCreating(true)
    setActionError(null)
    try {
      const created = await client.createAgent({
        id,
        name,
        description: createDescription.trim() === '' ? null : createDescription.trim(),
      })
      setAgents((previous) => [created, ...previous.filter((agent) => agent.id !== created.id)])
      setCreateId('')
      setCreateName('')
      setCreateDescription('')
      await openAgent(created.id, created)
    } catch (error) {
      if (!reportUnauthorized(error)) {
        setActionError(errorMessage(error, 'Could not create the agent.'))
      }
    } finally {
      setCreating(false)
    }
  }, [client, createDescription, createId, createName, openAgent, reportUnauthorized])

  const deactivate = useCallback(async () => {
    const current = detailRef.current
    if (!current || !canConfigure) {
      return
    }
    if (!window.confirm('Deactivate this agent?')) {
      return
    }
    const id = current.id
    const ticket = openGeneration.current
    if (!isCurrentOpen(id, ticket)) {
      return
    }
    setActionError(null)
    try {
      const updated = await client.deactivateAgent(id)
      if (!isCurrentOpen(id, ticket)) {
        return
      }
      setAgents((previous) => previous.map((agent) => (agent.id === updated.id ? updated : agent)))
      setDetail((previous) => {
        if (!previous || previous.id !== id) {
          return previous
        }
        return { ...previous, metadata: updated }
      })
    } catch (error) {
      if (!isCurrentOpen(id, ticket) || reportUnauthorized(error)) {
        return
      }
      setActionError(errorMessage(error, 'Could not deactivate this agent.'))
    }
  }, [canConfigure, client, isCurrentOpen, reportUnauthorized])

  const loadGrants = useCallback(
    async (agentId: string) => {
      const trimmed = agentId.trim()
      if (!trimmed || !canManageAccess) {
        return
      }
      const ticket = grantGeneration.current + 1
      grantGeneration.current = ticket
      setGrantLoading(true)
      setGrantError(null)
      try {
        const page = await client.listGrants(trimmed, undefined)
        if (grantGeneration.current !== ticket) {
          return
        }
        setGrantQueryId(trimmed)
        setGrants(page.items)
        setGrantCursor(page.next_cursor)
      } catch (error) {
        if (grantGeneration.current !== ticket || reportUnauthorized(error)) {
          return
        }
        setGrantError(errorMessage(error, 'Could not load grants.'))
      } finally {
        if (grantGeneration.current === ticket) {
          setGrantLoading(false)
        }
      }
    },
    [canManageAccess, client, reportUnauthorized],
  )

  const loadMoreGrants = useCallback(async () => {
    if (!canManageAccess || !grantQueryId || !grantCursor) {
      return
    }
    const queryId = grantQueryId
    const ticket = grantGeneration.current + 1
    grantGeneration.current = ticket
    setGrantLoading(true)
    setGrantError(null)
    try {
      const page = await client.listGrants(queryId, grantCursor)
      if (grantGeneration.current !== ticket) {
        return
      }
      setGrants((current) => [...current, ...page.items])
      setGrantCursor(page.next_cursor)
    } catch (error) {
      if (grantGeneration.current !== ticket || reportUnauthorized(error)) {
        return
      }
      setGrantError(errorMessage(error, 'Could not load grants.'))
    } finally {
      if (grantGeneration.current === ticket) {
        setGrantLoading(false)
      }
    }
  }, [canManageAccess, client, grantCursor, grantQueryId, reportUnauthorized])

  const saveGrant = useCallback(async () => {
    const agentId = grantAgentId.trim()
    const userId = grantUserId.trim()
    if (!agentId || !userId) {
      setGrantError('Agent id and user id are required.')
      return
    }
    setGrantError(null)
    try {
      const saved = await client.upsertGrant({
        user_id: userId,
        agent_id: agentId,
        can_view: grantView,
        can_configure: grantConfigure,
        can_execute: grantExecute,
      })
      setGrants((current) => {
        const rest = current.filter(
          (grant) => !(grant.user_id === userId && grant.agent_id === agentId),
        )
        return saved ? [saved, ...rest] : rest
      })
    } catch (error) {
      if (!reportUnauthorized(error)) {
        setGrantError(errorMessage(error, 'Could not save the grant.'))
      }
    }
  }, [
    client,
    grantAgentId,
    grantConfigure,
    grantExecute,
    grantUserId,
    grantView,
    reportUnauthorized,
  ])

  const revokeGrant = useCallback(
    async (userId: string, agentId: string) => {
      setGrantError(null)
      try {
        await client.deleteGrant(userId, agentId)
        setGrants((current) =>
          current.filter((grant) => !(grant.user_id === userId && grant.agent_id === agentId)),
        )
      } catch (error) {
        if (!reportUnauthorized(error)) {
          setGrantError(errorMessage(error, 'Could not revoke the grant.'))
        }
      }
    },
    [client, reportUnauthorized],
  )

  const loadExecutions = useCallback(async () => {
    if (!canRead) {
      return
    }
    const query = { agentId: executionAgentId.trim(), status: executionStatus }
    const ticket = executionGeneration.current + 1
    executionGeneration.current = ticket
    setExecutionLoading(true)
    setExecutionError(null)
    try {
      const page = await client.listExecutions({
        agentId: query.agentId || undefined,
        status: query.status || undefined,
        cursor: undefined,
      })
      if (executionGeneration.current !== ticket) {
        return
      }
      setExecutionQuery(query)
      setExecutions(page.items)
      setExecutionCursor(page.next_cursor)
    } catch (error) {
      if (executionGeneration.current !== ticket || reportUnauthorized(error)) {
        return
      }
      setExecutionError(errorMessage(error, 'Could not load executions.'))
    } finally {
      if (executionGeneration.current === ticket) {
        setExecutionLoading(false)
      }
    }
  }, [canRead, client, executionAgentId, executionStatus, reportUnauthorized])

  const loadMoreExecutions = useCallback(async () => {
    if (!canRead || !executionQuery || !executionCursor) {
      return
    }
    const query = executionQuery
    const ticket = executionGeneration.current + 1
    executionGeneration.current = ticket
    setExecutionLoading(true)
    setExecutionError(null)
    try {
      const page = await client.listExecutions({
        agentId: query.agentId || undefined,
        status: query.status || undefined,
        cursor: executionCursor,
      })
      if (executionGeneration.current !== ticket) {
        return
      }
      setExecutions((current) => [...current, ...page.items])
      setExecutionCursor(page.next_cursor)
    } catch (error) {
      if (executionGeneration.current !== ticket || reportUnauthorized(error)) {
        return
      }
      setExecutionError(errorMessage(error, 'Could not load executions.'))
    } finally {
      if (executionGeneration.current === ticket) {
        setExecutionLoading(false)
      }
    }
  }, [canRead, client, executionCursor, executionQuery, reportUnauthorized])

  const unsaved = metadataDirty(detail) || configDirty(detail)
  const grantQueryMatches = grantQueryId !== null && grantAgentId.trim() === grantQueryId
  const executionQueryMatches =
    executionQuery !== null &&
    executionQuery.agentId === executionAgentId.trim() &&
    executionQuery.status === executionStatus

  return {
    canRead,
    canConfigure,
    canManageAccess,
    agents,
    agentCursor,
    listLoading,
    listError,
    loadMoreAgents: () => loadAgents(agentCursor ?? undefined),
    detail,
    agentLoading,
    agentError,
    actionError,
    configError,
    savingMetadata,
    savingConfig,
    creating,
    unsaved,
    createId,
    setCreateId,
    createName,
    setCreateName,
    createDescription,
    setCreateDescription,
    createAgent,
    openAgent,
    updateMetadataField,
    updateConfigField,
    selectModel,
    toggleTool,
    toggleSkill,
    toggleApproval,
    saveMetadata,
    saveConfiguration,
    deactivate,
    grantAgentId,
    setGrantAgentId,
    grants,
    grantCursor,
    grantQueryMatches,
    grantLoading,
    grantError,
    grantUserId,
    setGrantUserId,
    grantView,
    setGrantView,
    grantConfigure,
    setGrantConfigure,
    grantExecute,
    setGrantExecute,
    loadGrants,
    loadMoreGrants,
    saveGrant,
    revokeGrant,
    executionAgentId,
    setExecutionAgentId,
    executionStatus,
    setExecutionStatus,
    executions,
    executionCursor,
    executionQueryMatches,
    executionLoading,
    executionError,
    loadExecutions,
    loadMoreExecutions,
  }
}
