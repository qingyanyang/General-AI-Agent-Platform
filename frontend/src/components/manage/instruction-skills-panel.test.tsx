import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { InstructionSkillsPanel } from '@/components/manage/instruction-skills-panel'
import { ApiError } from '@/lib/errors'
import type { ManagementClient } from '@/lib/management'

function createClient(
  overrides: Partial<ManagementClient> = {},
): ManagementClient {
  return {
    putInstructionSkills: vi.fn(async (_agentId, items: { name: string; description: string; instructions: string }[]) => ({
      items: items.map((item, index) => ({
        id: `server-${index}`,
        name: item.name,
        description: item.description,
        instructions: item.instructions,
      })),
    })),
    ...overrides,
  } as ManagementClient
}

describe('InstructionSkillsPanel', () => {
  it('publishes a full replacement and adopts server IDs', async () => {
    const user = userEvent.setup()
    const client = createClient()
    render(
      <InstructionSkillsPanel
        agentId="agent-1"
        client={client}
        initialItems={[
          { id: 'old', name: 'Alpha', description: '', instructions: 'one' },
          { id: 'old-2', name: 'Gamma', description: '', instructions: 'three' },
        ]}
        onUnauthorized={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Edit Alpha' }))
    expect(screen.getByRole('region', { name: 'Instructions Markdown preview' })).toHaveTextContent('one')
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.clear(screen.getByRole('textbox', { name: 'Instructions' }))
    await user.type(screen.getByRole('textbox', { name: 'Instructions' }), 'updated')
    await user.click(screen.getByRole('button', { name: 'Update skill' }))
    await user.click(screen.getByRole('button', { name: 'Publish Instruction Skills' }))

    await waitFor(() =>
      expect(client.putInstructionSkills).toHaveBeenCalledWith('agent-1', [
        { name: 'Alpha', description: '', instructions: 'updated' },
        { name: 'Gamma', description: '', instructions: 'three' },
      ]),
    )
  })

  it('previews new instructions as Markdown and keeps the draft when publish fails', async () => {
    const user = userEvent.setup()
    const client = createClient({
      putInstructionSkills: vi.fn(async () => {
        throw new ApiError(422, 'Too many skills')
      }),
    })
    render(
      <InstructionSkillsPanel
        agentId="agent-1"
        client={client}
        initialItems={[]}
        onUnauthorized={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Add skill' }))
    await user.type(screen.getByLabelText(/Name/), 'Only')
    await user.type(screen.getByRole('textbox', { name: 'Instructions' }), '# Review steps')
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.getByRole('heading', { name: 'Review steps' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('textbox', { name: 'Instructions' })).toHaveValue('# Review steps')
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    await user.click(screen.getByRole('button', { name: 'Add to draft' }))
    expect(screen.queryByText('Draft')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Publish Instruction Skills' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many skills')
    expect(client.putInstructionSkills).toHaveBeenCalledWith('agent-1', [
      { name: 'Only', description: '', instructions: '# Review steps' },
    ])
    expect(screen.getByText('Only')).toBeInTheDocument()
  })

  it('confirms discard and restores the baseline', async () => {
    const user = userEvent.setup()
    render(
      <InstructionSkillsPanel
        agentId="agent-1"
        client={createClient()}
        initialItems={[
          { id: '1', name: 'Kept', description: '', instructions: 'yes' },
        ]}
        onUnauthorized={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Remove Kept' }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.queryByText('Kept')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    const confirms = screen.getAllByRole('button', { name: 'Discard' })
    await user.click(confirms[confirms.length - 1])
    expect(await screen.findByText('Kept')).toBeInTheDocument()
  })
})
