/**
 * PROTOTYPE business skills, MCP connections, and knowledge sources.
 * Secrets are never stored. MCP rows only show a connection reference and status.
 */
import { MOCK_TOOLS } from './data'

export type BuiltinTool = {
  name: string
  description: string
}

export type InstructionSkill = {
  id: string
  agentId: string
  name: string
  description: string
  instructions: string
}

export type McpTool = {
  id: string
  name: string
  description: string
  enabled: boolean
}

export type McpAuth = 'none' | 'api-key'

export type McpServer = {
  id: string
  name: string
  endpoint: string
  status: 'connected' | 'disabled'
  /** Method only. The prototype never stores or shows an API key. */
  auth: McpAuth
  tools: McpTool[]
}

export type KnowledgeDocument = {
  id: string
  agentId: string
  name: string
  type: 'pdf' | 'docx' | 'txt'
  sizeBytes: number
  uploadedAt: string
  status: 'processing' | 'ready' | 'failed'
}

export type ExecutableSkill = {
  name: string
  description: string
}

const EXECUTABLE_SKILLS: ExecutableSkill[] = [
  { name: 'quantity-check', description: 'Technical check used by approved tools. Not editable by business roles.' },
  { name: 'document-index', description: 'Indexes files already connected to an agent. Super Admin only.' },
]

function seedSkills(): InstructionSkill[] {
  return [
    {
      id: 'skill-daily-plan',
      agentId: 'estimator-agent',
      name: 'daily-plan',
      description: 'Use when the user asks for today’s work plan or a short site schedule.',
      instructions: 'List the jobs for the day, the people involved, and any blockers. Keep it to one page.',
    },
    {
      id: 'skill-training',
      agentId: 'estimator-agent',
      name: 'training-summary',
      description: 'Use when the user asks for a training or induction summary.',
      instructions: 'Summarize the training points, who must attend, and the completion record to keep.',
    },
    {
      id: 'skill-quote',
      agentId: 'estimator-service-agent',
      name: 'quote-generation',
      description:
        'Generate construction quotations from uploaded cost breakdown spreadsheets. Use when the user requests a new quote, quote revision, or quotation PDF.',
      instructions:
        'Read the cost breakdown, apply the approved rate rules, and draft a quotation. Do not invent unit rates. Offer a PDF when the PDF Generator tool is available.',
    },
    {
      id: 'skill-invoice',
      agentId: 'estimator-service-agent',
      name: 'invoice-breakdown',
      description: 'Use when the user asks to split an invoice into work categories.',
      instructions: 'Allocate each line to one category and show the totals. Flag lines that do not match a category.',
    },
  ]
}

function seedMcp(): McpServer[] {
  return [
    {
      id: 'mcp-projects',
      name: 'Project register',
      endpoint: 'https://mcp.example.construction/projects',
      status: 'connected',
      auth: 'none',
      tools: [
        { id: 'mcp-projects:list', name: 'list-projects', description: 'List active projects.', enabled: true },
        { id: 'mcp-projects:get', name: 'get-project', description: 'Read one project record.', enabled: true },
        { id: 'mcp-projects:update', name: 'update-project', description: 'Update a project record.', enabled: true },
      ],
    },
    {
      id: 'mcp-docs',
      name: 'Document archive',
      endpoint: 'https://mcp.example.construction/documents',
      status: 'connected',
      auth: 'api-key',
      tools: [
        { id: 'mcp-docs:search', name: 'search-documents', description: 'Search archived documents.', enabled: true },
        { id: 'mcp-docs:fetch', name: 'fetch-document', description: 'Read one archived document.', enabled: true },
      ],
    },
  ]
}

function seedKnowledge(): KnowledgeDocument[] {
  return [
    {
      id: 'doc-handbook',
      agentId: 'estimator-agent',
      name: 'Estimating handbook.pdf',
      type: 'pdf',
      sizeBytes: 248_320,
      uploadedAt: '2026-11-12T02:00:00.000Z',
      status: 'ready',
    },
    {
      id: 'doc-rates',
      agentId: 'estimator-service-agent',
      name: 'Approved rate library.docx',
      type: 'docx',
      sizeBytes: 86_016,
      uploadedAt: '2026-11-14T06:30:00.000Z',
      status: 'ready',
    },
  ]
}

function seedMcpAssignment(): Record<string, string[]> {
  return {
    'estimator-agent': ['mcp-projects:list'],
    'estimator-service-agent': ['mcp-projects:list', 'mcp-projects:get'],
  }
}

let skills = seedSkills()
let mcpServers = seedMcp()
let knowledge = seedKnowledge()
let mcpAssignment = seedMcpAssignment()
let builtinTools = seedBuiltinTools()
let skillSeq = skills.length
let mcpSeq = mcpServers.length
let docSeq = knowledge.length
const indexTimers: number[] = []

function seedBuiltinTools(): BuiltinTool[] {
  return MOCK_TOOLS.map((tool) => ({ name: tool.name, description: tool.description }))
}

export function resetProductState() {
  for (const timer of indexTimers) {
    window.clearTimeout(timer)
  }
  indexTimers.length = 0
  skills = seedSkills()
  mcpServers = seedMcp()
  knowledge = seedKnowledge()
  mcpAssignment = seedMcpAssignment()
  builtinTools = seedBuiltinTools()
  skillSeq = skills.length
  mcpSeq = mcpServers.length
  docSeq = knowledge.length
}

export function listBuiltinTools(): BuiltinTool[] {
  return builtinTools
}

export function saveBuiltinTool(input: { previousName?: string; name: string; description: string }): BuiltinTool {
  const name = input.name.trim()
  const description = input.description.trim()
  const previous = input.previousName
  if (previous) {
    builtinTools = builtinTools.map((tool) => (tool.name === previous ? { name, description } : tool))
    return { name, description }
  }
  const existing = builtinTools.find((tool) => tool.name === name)
  if (existing) {
    builtinTools = builtinTools.map((tool) => (tool.name === name ? { name, description } : tool))
    return { name, description }
  }
  const created = { name, description }
  builtinTools = [...builtinTools, created]
  return created
}

export function deleteBuiltinTool(name: string) {
  builtinTools = builtinTools.filter((tool) => tool.name !== name)
}

export function listInstructionSkills(agentId: string): InstructionSkill[] {
  return skills.filter((skill) => skill.agentId === agentId)
}

export function saveInstructionSkill(input: {
  id?: string
  agentId: string
  name: string
  description: string
  instructions: string
}): InstructionSkill {
  const name = input.name.trim()
  const existing = input.id ? skills.find((skill) => skill.id === input.id && skill.agentId === input.agentId) : undefined
  if (existing) {
    const next = { ...existing, name, description: input.description.trim(), instructions: input.instructions }
    skills = skills.map((skill) => (skill.id === existing.id ? next : skill))
    return next
  }
  skillSeq += 1
  const created: InstructionSkill = {
    id: `skill-${skillSeq}`,
    agentId: input.agentId,
    name,
    description: input.description.trim(),
    instructions: input.instructions,
  }
  skills = [...skills, created]
  return created
}

export function deleteInstructionSkill(agentId: string, skillId: string) {
  skills = skills.filter((skill) => !(skill.agentId === agentId && skill.id === skillId))
}

export function listExecutableSkills(): ExecutableSkill[] {
  return EXECUTABLE_SKILLS
}

export function listMcpServers(): McpServer[] {
  return mcpServers
}

export function discoverMcpTools(serverId: string): McpTool[] {
  return [
    { id: `${serverId}:list`, name: 'list-records', description: 'List records exposed by this server.', enabled: true },
    { id: `${serverId}:get`, name: 'get-record', description: 'Read one record from this server.', enabled: true },
  ]
}

export function connectMcpServer(input: { name: string; endpoint: string; auth: McpAuth }): McpServer {
  mcpSeq += 1
  const id = `mcp-${mcpSeq}`
  const created: McpServer = {
    id,
    name: input.name.trim(),
    endpoint: input.endpoint.trim(),
    status: 'connected',
    auth: input.auth,
    tools: discoverMcpTools(id),
  }
  mcpServers = [...mcpServers, created]
  return created
}

export function saveMcpServer(input: { id: string; name: string; endpoint: string; auth: McpAuth }): McpServer | null {
  const existing = mcpServers.find((server) => server.id === input.id)
  if (!existing) {
    return null
  }
  const next = { ...existing, name: input.name.trim(), endpoint: input.endpoint.trim(), auth: input.auth }
  mcpServers = mcpServers.map((server) => (server.id === existing.id ? next : server))
  return next
}

export function deleteMcpServer(serverId: string) {
  const toolIds = new Set(mcpServers.find((server) => server.id === serverId)?.tools.map((tool) => tool.id) ?? [])
  mcpServers = mcpServers.filter((server) => server.id !== serverId)
  mcpAssignment = Object.fromEntries(
    Object.entries(mcpAssignment).map(([agentId, ids]) => [agentId, ids.filter((id) => !toolIds.has(id))]),
  )
}

export function setMcpStatus(serverId: string, status: McpServer['status']) {
  mcpServers = mcpServers.map((server) => (server.id === serverId ? { ...server, status } : server))
}

export function addMcpTool(serverId: string, name: string, description: string): McpTool | null {
  const server = mcpServers.find((item) => item.id === serverId)
  if (!server) {
    return null
  }
  const tool: McpTool = {
    id: `${serverId}:${name.trim().toLowerCase().replace(/\s+/g, '-')}`,
    name: name.trim(),
    description: description.trim(),
    enabled: true,
  }
  mcpServers = mcpServers.map((item) => (item.id === serverId ? { ...item, tools: [...item.tools, tool] } : item))
  return tool
}

export function updateMcpTool(serverId: string, toolId: string, name: string, description: string) {
  mcpServers = mcpServers.map((server) =>
    server.id === serverId
      ? {
          ...server,
          tools: server.tools.map((tool) =>
            tool.id === toolId ? { ...tool, name: name.trim(), description: description.trim() } : tool,
          ),
        }
      : server,
  )
}

export function setMcpToolEnabled(serverId: string, toolId: string, enabled: boolean) {
  mcpServers = mcpServers.map((server) =>
    server.id === serverId
      ? { ...server, tools: server.tools.map((tool) => (tool.id === toolId ? { ...tool, enabled } : tool)) }
      : server,
  )
  if (!enabled) {
    mcpAssignment = Object.fromEntries(
      Object.entries(mcpAssignment).map(([agentId, ids]) => [agentId, ids.filter((id) => id !== toolId)]),
    )
  }
}

export function listKnowledge(agentId: string): KnowledgeDocument[] {
  return knowledge.filter((document) => document.agentId === agentId)
}

export function addKnowledgeDocuments(
  agentId: string,
  files: Array<{ name: string; type: KnowledgeDocument['type']; sizeBytes: number }>,
): KnowledgeDocument[] {
  const created = files.map((file) => {
    docSeq += 1
    const document: KnowledgeDocument = {
      id: `doc-${docSeq}`,
      agentId,
      name: file.name,
      type: file.type,
      sizeBytes: file.sizeBytes,
      uploadedAt: new Date().toISOString(),
      status: 'processing',
    }
    return document
  })
  knowledge = [...knowledge, ...created]
  for (const document of created) {
    const failed = document.name.toLowerCase().includes('fail')
    const timer = window.setTimeout(() => {
      knowledge = knowledge.map((item) =>
        item.id === document.id && item.status === 'processing'
          ? { ...item, status: failed ? 'failed' : 'ready' }
          : item,
      )
    }, 800)
    indexTimers.push(timer)
  }
  return created
}

export function removeKnowledge(agentId: string, documentId: string) {
  knowledge = knowledge.filter((document) => !(document.agentId === agentId && document.id === documentId))
}

export function assignedMcpTools(agentId: string): string[] {
  return mcpAssignment[agentId] ?? []
}

export function setAssignedMcpTools(agentId: string, toolIds: string[]) {
  mcpAssignment = { ...mcpAssignment, [agentId]: toolIds }
}

export function enabledMcpTools(): { id: string; label: string; serverName: string }[] {
  return mcpServers.flatMap((server) =>
    server.status === 'connected'
      ? server.tools
          .filter((tool) => tool.enabled)
          .map((tool) => ({ id: tool.id, label: tool.name, serverName: server.name }))
      : [],
  )
}
