import { useSyncExternalStore } from 'react'

import type { InstructionSkillDraftFields } from '@/lib/instruction-skills'
import { writeInstructionEligibility } from '@/lib/instruction-eligibility-cache'
import type { AgentConfiguration, KnowledgeReference, LlmModel, ManagementClient } from '@/lib/management'
import { cachedModels, writeCachedConfiguration } from '@/lib/read-cache'

/** Unpublished Configure fields. Same shape as the settings configuration form. */
export type TechnicalDraft = {
  system_prompt: string
  llm_provider: string
  llm_model: string
  temperature: string
  tool_names: string[]
  skill_names: string[]
  approval_tool_names: string[]
}

export type DraftConnection = { id: string; name: string; endpoint: string }

export type AgentDraft = {
  technical: TechnicalDraft | null
  skills: InstructionSkillDraftFields[] | null
  connections: DraftConnection[]
  documents: KnowledgeReference[] | null
}

const EMPTY: AgentDraft = {
  technical: null,
  skills: null,
  connections: [],
  documents: null,
}

const drafts = new Map<string, AgentDraft>()
const listeners = new Set<() => void>()
let snapshot: ReadonlySet<string> = new Set()

function emit() {
  snapshot = new Set(drafts.keys())
  for (const listener of listeners) {
    listener()
  }
}

export function hasAgentDraftContent(draft: AgentDraft): boolean {
  return (
    draft.technical !== null ||
    draft.skills !== null ||
    draft.connections.length > 0 ||
    draft.documents !== null
  )
}

export function readAgentDraft(agentId: string): AgentDraft | null {
  return drafts.get(agentId) ?? null
}

export function storeAgentDraft(agentId: string, draft: AgentDraft) {
  if (!hasAgentDraftContent(draft)) {
    if (drafts.delete(agentId)) {
      emit()
    }
    return
  }
  drafts.set(agentId, draft)
  emit()
}

export function clearAgentDraft(agentId: string) {
  if (drafts.delete(agentId)) {
    emit()
  }
}

export function resetAgentDrafts() {
  if (drafts.size === 0) {
    return
  }
  drafts.clear()
  emit()
}

export function subscribeAgentDrafts(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function draftAgentIds(): ReadonlySet<string> {
  return snapshot
}

export function useDraftAgentIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeAgentDrafts, draftAgentIds, draftAgentIds)
}

export function emptyAgentDraft(): AgentDraft {
  return {
    technical: null,
    skills: null,
    connections: [],
    documents: null,
  }
}

export function configurationFromDraft(form: TechnicalDraft, models: LlmModel[]): AgentConfiguration {
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

/** Publishes the stored Configure draft and clears it. */
export async function publishAgentDraft(client: ManagementClient, agentId: string): Promise<void> {
  const draft = readAgentDraft(agentId) ?? EMPTY
  if (!hasAgentDraftContent(draft)) {
    return
  }
  if (draft.technical) {
    const models = await cachedModels(() => client.listModels())
    const saved = await client.putConfiguration(
      agentId,
      configurationFromDraft(draft.technical, models),
    )
    writeCachedConfiguration(agentId, saved)
  }
  if (draft.skills) {
    const result = await client.putInstructionSkills(agentId, draft.skills)
    writeInstructionEligibility(agentId, { status: 'eligible', items: result.items })
  }
  if (draft.documents !== null) {
    await client.putKnowledgeReferences(agentId, draft.documents)
  }
  if (readAgentDraft(agentId) === draft) {
    clearAgentDraft(agentId)
  }
}
