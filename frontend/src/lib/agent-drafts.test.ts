import { publishAgentDraft, resetAgentDrafts, storeAgentDraft } from '@/lib/agent-drafts'
import type { ManagementClient } from '@/lib/management'

const technical = {
  system_prompt: 'Draft prompt',
  llm_provider: 'openai',
  llm_model: 'gpt',
  temperature: '0.2',
  tool_names: ['search'],
  skill_names: [],
  approval_tool_names: [],
}

describe('agent drafts', () => {
  afterEach(() => {
    resetAgentDrafts()
  })

  it('publishes stored configuration and a cleared reference list, then clears the draft', async () => {
    const putConfiguration = vi.fn(async () => ({
      ...technical,
      temperature: 0.2,
    }))
    const putInstructionSkills = vi.fn(async () => ({ items: [] }))
    const putKnowledgeReferences = vi.fn(async () => [])
    const client = {
      listModels: async () => [
        {
          provider: 'openai',
          model: 'gpt',
          temperature_min: 0,
          temperature_max: 1,
        },
      ],
      putConfiguration,
      putInstructionSkills,
      putKnowledgeReferences,
    } as unknown as ManagementClient
    storeAgentDraft('estimator-agent', {
      technical,
      skills: [{ name: 'Rates', description: 'Use the sheet', instructions: 'Never invent rates.' }],
      connections: [],
      documents: [],
    })

    await publishAgentDraft(client, 'estimator-agent')

    expect(putConfiguration).toHaveBeenCalledWith(
      'estimator-agent',
      expect.objectContaining({ system_prompt: 'Draft prompt', temperature: 0.2 }),
    )
    expect(putInstructionSkills).toHaveBeenCalledWith('estimator-agent', [
      { name: 'Rates', description: 'Use the sheet', instructions: 'Never invent rates.' },
    ])
    expect(putKnowledgeReferences).toHaveBeenCalledWith('estimator-agent', [])
    await expect(publishAgentDraft(client, 'estimator-agent')).resolves.toBeUndefined()
    expect(putConfiguration).toHaveBeenCalledTimes(1)
  })
})
