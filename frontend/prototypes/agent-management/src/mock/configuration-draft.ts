import type { AgentConfiguration } from '@/lib/management'

import {
  addKnowledgeDocuments,
  assignedMcpTools,
  connectMcpServer,
  deleteInstructionSkill,
  deleteMcpServer,
  discoverMcpTools,
  listInstructionSkills,
  listKnowledge,
  listMcpServers,
  removeKnowledge,
  saveInstructionSkill,
  saveMcpServer,
  setAssignedMcpTools,
  type InstructionSkill,
  type KnowledgeDocument,
  type McpServer,
} from './product-state'

export const INSTRUCTION_CHARACTER_LIMIT = 20_000

export type DraftChange<T> = { kind: 'added' | 'edited'; value: T } | { kind: 'removed' }
export type SkillDraft = Pick<InstructionSkill, 'name' | 'description' | 'instructions'>
export type McpConnectionDraft = Pick<McpServer, 'name' | 'endpoint' | 'auth'>
export type KnowledgeDraft = Pick<KnowledgeDocument, 'name' | 'type' | 'sizeBytes'>

export type DraftItems = {
  skills: Record<string, DraftChange<SkillDraft>>
  connections: Record<string, DraftChange<McpConnectionDraft>>
  mcpTools: Record<string, boolean>
  knowledge: Record<string, DraftChange<KnowledgeDraft>>
}

export type PublishDraft = DraftItems & { configuration: AgentConfiguration | null }

export type ConfigurationFields = {
  model: string
  temperature: string
  instructions: string
  tools: string[]
}

export type ConfigurationDraft = DraftItems & { fields: Partial<ConfigurationFields> }

export const EMPTY_CONFIGURATION_DRAFT: ConfigurationDraft = {
  fields: {},
  skills: {},
  connections: {},
  mcpTools: {},
  knowledge: {},
}

// Mock drafts survive navigation for the current editor and agent, like the rest of the demo workspace.
const draftsByEditor = new Map<string, ConfigurationDraft>()
const draftListeners = new Set<() => void>()

function notifyDraftListeners() {
  for (const listener of draftListeners) {
    listener()
  }
}

export function subscribeConfigurationDrafts(listener: () => void): () => void {
  draftListeners.add(listener)
  return () => {
    draftListeners.delete(listener)
  }
}

export function draftAgentIds(editorId: string): Set<string> {
  const ids = new Set<string>()
  for (const key of draftsByEditor.keys()) {
    const parsed: unknown = JSON.parse(key)
    if (Array.isArray(parsed) && parsed[0] === editorId && typeof parsed[1] === 'string') {
      ids.add(parsed[1])
    }
  }
  return ids
}

export function hasDraftChanges(draft: ConfigurationDraft): boolean {
  return Object.values(draft).some((changes) => Object.keys(changes).length > 0)
}

export function readConfigurationDraft(editorId: string, agentId: string): ConfigurationDraft {
  return draftsByEditor.get(JSON.stringify([editorId, agentId])) ?? EMPTY_CONFIGURATION_DRAFT
}

export function storeConfigurationDraft(editorId: string, agentId: string, draft: ConfigurationDraft) {
  const key = JSON.stringify([editorId, agentId])
  if (hasDraftChanges(draft)) {
    draftsByEditor.set(key, draft)
  } else {
    draftsByEditor.delete(key)
  }
  notifyDraftListeners()
}

export function resetConfigurationDrafts() {
  draftsByEditor.clear()
  notifyDraftListeners()
}

export function normalizedSkillName(name: string): string {
  return name.trim().toLowerCase()
}

function projectItems<T extends { id: string }, D extends Partial<T>>(
  published: T[],
  changes: Record<string, DraftChange<D>>,
  create: (id: string, draft: D) => T,
): T[] {
  const items = published.flatMap((item) => {
    const change = changes[item.id]
    if (change?.kind === 'removed') {
      return []
    }
    return [change?.kind === 'edited' ? { ...item, ...change.value } : item]
  })
  for (const [id, change] of Object.entries(changes)) {
    if (change.kind === 'added') {
      items.push(create(id, change.value))
    }
  }
  return items
}

export function draftSkills(agentId: string, drafts: DraftItems['skills']): InstructionSkill[] {
  return projectItems(listInstructionSkills(agentId), drafts, (id, skill) => ({ ...skill, id, agentId }))
}

export function draftMcpServers(drafts: DraftItems['connections']): McpServer[] {
  return projectItems(listMcpServers(), drafts, (id, connection) => ({
    ...connection,
    id,
    status: 'connected',
    tools: discoverMcpTools(id),
  }))
}

export function draftKnowledge(
  agentId: string,
  drafts: DraftItems['knowledge'],
): Array<KnowledgeDocument & { draft?: true }> {
  return projectItems<KnowledgeDocument & { draft?: true }, KnowledgeDraft>(
    listKnowledge(agentId),
    drafts,
    (id, document) => ({ ...document, id, agentId, draft: true, uploadedAt: '', status: 'processing' }),
  )
}

export function validateDraftItems(agentId: string, draft: DraftItems): string | null {
  const publishedSkills = listInstructionSkills(agentId)
  for (const [id, change] of Object.entries(draft.skills)) {
    if (change.kind === 'edited' && !publishedSkills.some((skill) => skill.id === id)) {
      return 'An Instruction Skill you changed is no longer available.'
    }
    if (change.kind !== 'removed' && change.value.instructions.length > INSTRUCTION_CHARACTER_LIMIT) {
      return `Skill instructions must be at most ${INSTRUCTION_CHARACTER_LIMIT.toLocaleString()} characters.`
    }
  }
  const names = new Set<string>()
  for (const skill of draftSkills(agentId, draft.skills)) {
    const name = normalizedSkillName(skill.name)
    if (!name) {
      return 'Enter a name for each Instruction Skill.'
    }
    if (names.has(name)) {
      return `An Instruction Skill named “${skill.name.trim()}” already exists.`
    }
    names.add(name)
  }

  const publishedConnections = listMcpServers()
  for (const [id, change] of Object.entries(draft.connections)) {
    if (change.kind === 'removed') {
      continue
    }
    if (change.kind === 'edited' && !publishedConnections.some((server) => server.id === id)) {
      return 'An MCP connection you changed is no longer available.'
    }
    if (!change.value.name.trim() || !change.value.endpoint.trim()) {
      return 'Enter a name and server URL for each MCP connection.'
    }
  }
  const tools = new Set(draftMcpServers(draft.connections).flatMap((server) => server.tools.map((tool) => tool.id)))
  if (Object.keys(draft.mcpTools).some((id) => !tools.has(id))) {
    return 'An MCP tool you changed is no longer available.'
  }
  return null
}

/** Applies a validated draft to the mock's published state in one request. */
export function applyDraftItems(agentId: string, draft: DraftItems) {
  for (const [id, change] of Object.entries(draft.skills)) {
    if (change.kind === 'removed') {
      deleteInstructionSkill(agentId, id)
    } else {
      saveInstructionSkill({ ...change.value, agentId, id: change.kind === 'edited' ? id : undefined })
    }
  }

  const publishedToolIds = new Map<string, string>()
  for (const [id, change] of Object.entries(draft.connections)) {
    if (change.kind === 'removed') {
      deleteMcpServer(id)
    } else if (change.kind === 'edited') {
      saveMcpServer({ ...change.value, id })
    } else {
      const server = connectMcpServer(change.value)
      for (const tool of server.tools) {
        publishedToolIds.set(`${id}${tool.id.slice(server.id.length)}`, tool.id)
      }
    }
  }
  if (Object.keys(draft.mcpTools).length > 0) {
    const assigned = new Set(assignedMcpTools(agentId))
    for (const [id, enabled] of Object.entries(draft.mcpTools)) {
      const toolId = publishedToolIds.get(id) ?? id
      if (enabled) {
        assigned.add(toolId)
      } else {
        assigned.delete(toolId)
      }
    }
    setAssignedMcpTools(agentId, [...assigned])
  }

  const newDocuments: KnowledgeDraft[] = []
  for (const [id, change] of Object.entries(draft.knowledge)) {
    if (change.kind === 'removed') {
      removeKnowledge(agentId, id)
    } else if (change.kind === 'added') {
      newDocuments.push(change.value)
    }
  }
  if (newDocuments.length > 0) {
    addKnowledgeDocuments(agentId, newDocuments)
  }
}
