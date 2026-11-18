import type { AgentConfiguration, LlmModel } from '@/lib/management'

import { mockClient } from './mock/client'
import {
  EMPTY_CONFIGURATION_DRAFT,
  hasDraftChanges,
  INSTRUCTION_CHARACTER_LIMIT,
  readConfigurationDraft,
  storeConfigurationDraft,
  validateDraftItems,
  type ConfigurationFields,
} from './mock/configuration-draft'

type TemperatureModel = LlmModel & { temperature_min: number; temperature_max: number }

export function modelKey(model: { provider: string; model: string }): string {
  return `${model.provider}/${model.model}`
}

export function toFields(config: AgentConfiguration): ConfigurationFields {
  return {
    model: modelKey({ provider: config.llm_provider, model: config.llm_model }),
    temperature: config.temperature === null ? '' : String(config.temperature),
    instructions: config.system_prompt,
    tools: config.tool_names,
  }
}

export function supportsTemperature(model: LlmModel | undefined): model is TemperatureModel {
  return model !== undefined && model.temperature_min !== null && model.temperature_max !== null
}

export function applyFields(
  config: AgentConfiguration,
  fields: Partial<ConfigurationFields>,
  models: LlmModel[] | null,
): AgentConfiguration {
  const next = { ...config }
  if (fields.model !== undefined || fields.temperature !== undefined) {
    const current = toFields(config)
    const model = models?.find((item) => modelKey(item) === (fields.model ?? current.model))
    if (!model) {
      throw new Error('Choose a model from the model list.')
    }
    let temperature = null
    if (supportsTemperature(model)) {
      const value = fields.temperature ?? current.temperature
      temperature = Number(value)
      if (!value.trim() || !Number.isFinite(temperature) || temperature < model.temperature_min || temperature > model.temperature_max) {
        throw new Error(`Enter a temperature between ${model.temperature_min} and ${model.temperature_max}.`)
      }
    }
    next.llm_provider = model.provider
    next.llm_model = model.model
    next.temperature = temperature
  }
  if (fields.instructions !== undefined) {
    if (fields.instructions.length > INSTRUCTION_CHARACTER_LIMIT) {
      throw new Error(`System instructions must be at most ${INSTRUCTION_CHARACTER_LIMIT.toLocaleString()} characters.`)
    }
    next.system_prompt = fields.instructions
  }
  if (fields.tools) {
    const tools = fields.tools
    next.tool_names = tools
    next.approval_tool_names = config.approval_tool_names.filter((name) => tools.includes(name))
  }
  return next
}

export async function publishAgentDraft(agentId: string, editorId: string): Promise<void> {
  const workspace = readConfigurationDraft(editorId, agentId)
  if (!hasDraftChanges(workspace)) {
    return
  }
  const invalid = validateDraftItems(agentId, workspace)
  if (invalid) {
    throw new Error(invalid)
  }
  const hasTechnicalFields = Object.keys(workspace.fields).length > 0
  let configuration: AgentConfiguration | null = null
  if (hasTechnicalFields) {
    const [config, models] = await Promise.all([
      mockClient.getConfiguration(agentId),
      mockClient.listModels(),
    ])
    configuration = applyFields(config, workspace.fields, models)
  }
  await mockClient.publishConfiguration(agentId, {
    configuration,
    skills: workspace.skills,
    connections: workspace.connections,
    mcpTools: workspace.mcpTools,
    knowledge: workspace.knowledge,
  })
  storeConfigurationDraft(editorId, agentId, EMPTY_CONFIGURATION_DRAFT)
}
