/**
 * PROTOTYPE MOCK DATA.
 * Fictional agents, configurations, and executions. Authorization scope is
 * driven by access audience, groups, leadership, and owning-group Prompt rights —
 * not editable per-user capability grants. Never shipped and never sent to the API.
 */
import type {
  AccessGrant,
  AgentConfiguration,
  AgentRecord,
  ExecutionRecord,
  LlmModel,
  SkillSummary,
  ToolCatalogItem,
} from '@/lib/management'

import { seedExtraUserExecutions } from './users-data'

/** Re-export fixed-role personas for Demo controls. */
export type { RoleId as PersonaId, RolePersona as Persona } from './roles'
export { PERSONAS, personaById, personaByKey } from './roles'

export const MOCK_TOOLS: ToolCatalogItem[] = [
  { name: 'excel-processor', description: 'Read and summarize spreadsheet workbooks. Illustrative built-in tool.' },
  { name: 'pdf-generator', description: 'Produce a PDF from approved content. Illustrative built-in tool.' },
  { name: 'calculator', description: 'Arithmetic for quantities and totals. Illustrative built-in tool.' },
  { name: 'file-search', description: 'Search files already available to the agent. Illustrative built-in tool.' },
]

export const MOCK_MODELS: LlmModel[] = [
  { provider: 'openai', model: 'gpt-4o-mini', temperature_min: 0, temperature_max: 2 },
  { provider: 'deepseek', model: 'deepseek-flash', temperature_min: 0, temperature_max: 2 },
  { provider: 'deepseek', model: 'deepseek-chat', temperature_min: 0, temperature_max: 2 },
  // Mock approved entry without temperature support, to show the `null` temperature path.
  { provider: 'openai', model: 'mock-fixed-temperature', temperature_min: null, temperature_max: null },
]

export const MOCK_SKILLS: SkillSummary[] = [
  { name: 'meeting_notes', description: 'Turn a meeting transcript into structured notes.' },
  { name: 'summarize_brief', description: 'Summarize a brief into a short executive outline.' },
]

function at(day: number, hour: number, minute = 0): string {
  return new Date(Date.UTC(2026, 10, day, hour, minute)).toISOString()
}

export function seedAgents(): AgentRecord[] {
  return [
    {
      id: 'estimator-agent',
      name: 'Estimator Agent',
      description: 'Project tracking, daily planning, business questions, and training summaries.',
      status: 'active',
      created_by: 'auth0|mock-super-admin',
      created_at: at(2, 8),
      updated_at: at(16, 4, 10),
    },
    {
      id: 'estimator-service-agent',
      name: 'Estimator Service Agent',
      description: 'Quote generation, takeoff preparation, invoice breakdown, and business documents.',
      status: 'active',
      created_by: 'auth0|mock-super-admin',
      created_at: at(3, 1),
      updated_at: at(16, 2, 40),
    },
  ]
}

const BASE_CONFIG: AgentConfiguration = {
  system_prompt: '',
  llm_provider: 'deepseek',
  llm_model: 'deepseek-flash',
  temperature: 1,
  tool_names: [],
  skill_names: [],
  approval_tool_names: [],
}

export function seedConfigurations(): Record<string, AgentConfiguration> {
  return {
    'estimator-agent': {
      ...BASE_CONFIG,
      system_prompt:
        'Help estimators with project tracking, daily plans, and training summaries. Follow Instruction Skills. Do not invent rates.',
      temperature: 0.3,
      tool_names: ['file-search', 'calculator'],
    },
    'estimator-service-agent': {
      ...BASE_CONFIG,
      system_prompt:
        'Help estimator services prepare quotations, takeoffs, and invoice breakdowns. Follow Instruction Skills. Do not invent unit rates.',
      temperature: 0.25,
      tool_names: ['excel-processor', 'pdf-generator', 'calculator'],
      approval_tool_names: ['pdf-generator'],
    },
  }
}

export function seedGrants(): AccessGrant[] {
  // #56: direct capability grants are no longer the product model.
  // Kept as an empty list so older mock helpers still compile.
  return []
}

type ExecutionSeed = [
  agentId: string,
  status: string,
  day: number,
  hour: number,
  minute: number,
  durationMs: number | null,
  error: string | null,
  session: boolean,
]

const EXECUTION_SEEDS: ExecutionSeed[] = [
  ['estimator-service-agent', 'awaiting_approval', 17, 1, 52, null, null, true],
  ['estimator-service-agent', 'running', 17, 1, 48, null, null, true],
  ['estimator-service-agent', 'succeeded', 16, 23, 10, 2140, null, true],
  ['estimator-service-agent', 'failed', 16, 22, 4, 812, 'Agent execution failed: upstream model timeout', true],
  ['estimator-agent', 'succeeded', 16, 9, 30, 3305, null, false],
  ['estimator-agent', 'cancelled', 16, 8, 2, 451, null, true],
]

export function mockUuid(seed: number): string {
  const hex = (seed * 2654435761).toString(16).padStart(8, '0').slice(-8)
  return `${hex}-5a1e-4c2d-9b3f-${String(seed).padStart(12, '0')}`
}

export function seedExecutions(): ExecutionRecord[] {
  const owners = ['auth0|mock-admin', 'auth0|mock-chelsea', 'auth0|mock-sam']
  const records: ExecutionRecord[] = []
  let seed = 1
  for (const owner of owners) {
    for (const [agentId, status, day, hour, minute, durationMs, error, session] of EXECUTION_SEEDS) {
      const started = new Date(Date.UTC(2026, 10, day, hour, minute))
      const id = mockUuid(seed)
      const open = status === 'running' || status === 'awaiting_approval'
      records.push({
        id,
        user_id: owner,
        agent_id: agentId,
        session_id: session ? mockUuid(seed + 900) : null,
        status,
        started_at: started.toISOString(),
        completed_at:
          open || durationMs === null ? null : new Date(started.getTime() + durationMs).toISOString(),
        duration_ms: open ? null : durationMs,
        error_summary: error,
        langsmith_run_id: id,
      })
      seed += 1
    }
  }
  return [...records, ...seedExtraUserExecutions()]
}
