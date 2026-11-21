import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'

import { AgentSettingsPage } from '@/components/manage/agent-settings-page'
import type { AppShellContext } from '@/components/shell/app-shell'
import { readAgentDraft, resetAgentDrafts } from '@/lib/agent-drafts'
import { createChatClient } from '@/lib/api'
import { ApiError } from '@/lib/errors'
import { clearInstructionEligibility } from '@/lib/instruction-eligibility-cache'
import { createManagementClient, type KnowledgeReference } from '@/lib/management'
import { AGENTS_READ } from '@/lib/permissions'

afterEach(() => {
  cleanup()
  resetAgentDrafts()
  clearInstructionEligibility()
})

it('stages reference changes in the agent draft and uses the shared publish and discard actions', async () => {
  const user = userEvent.setup()
  const getToken = async () => 'test-token'
  let saved: KnowledgeReference[] = []
  const put = vi.fn(async (_agentId: string, items: KnowledgeReference[]) => {
    saved = items
    return items
  }).mockRejectedValueOnce(new ApiError(503, 'References are temporarily unavailable.'))
  const context: AppShellContext = {
    client: createChatClient(getToken),
    managementClient: {
      ...createManagementClient(getToken),
      getAgent: async (id) => ({
        id, name: 'Default', status: 'active', description: null,
        created_at: '', created_by: '', updated_at: '',
      }),
      getInstructionSkills: async () => ({ items: [] }),
      getKnowledgeReferences: async () => saved,
      putKnowledgeReferences: put,
    },
    permissions: new Set([AGENTS_READ]),
    accountLabel: 'Test editor',
    accountName: null,
    accountEmail: null,
    accountRole: null,
    onUnauthorized: vi.fn(),
    onSignOut: vi.fn(),
    canCreateAgent: false,
    openCreateAgent: vi.fn(),
  }
  render(
    <MemoryRouter initialEntries={['/agents/default/settings/configuration']}>
      <Routes>
        <Route element={<Outlet context={context} />}>
          <Route path="/agents/:agentId/settings/:section" element={<AgentSettingsPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

  const input = await screen.findByLabelText('Add document references')
  await user.upload(input, new File(['guide'], 'guide.txt', { type: 'text/plain' }))
  expect(screen.getByRole('heading', { name: 'Default' }).parentElement).toContainElement(
    screen.getByText('Draft'),
  )
  expect(screen.getByRole('button', { name: 'Add documents' })).toHaveClass('bg-primary')
  expect(screen.queryByRole('button', { name: 'Save references' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument()
  expect(put).not.toHaveBeenCalled()

  await user.click(screen.getByRole('link', { name: 'Details' }))
  await user.click(screen.getByRole('link', { name: 'Configure' }))
  expect(await screen.findByText('guide.txt')).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'Publish' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('References are temporarily unavailable.')
  expect(screen.getByText('Draft')).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'Publish' }))
  expect(await screen.findByText('Published')).toBeVisible()
  expect(screen.queryByText('Draft')).not.toBeInTheDocument()
  expect(put).toHaveBeenLastCalledWith('default', [
    expect.objectContaining({ name: 'guide.txt', size: '5 B' }),
  ])
  expect(readAgentDraft('default')).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Remove guide.txt' }))
  expect(readAgentDraft('default')?.documents).toEqual([])
  await user.click(screen.getByRole('button', { name: 'Discard draft' }))
  const dialog = screen.getByRole('dialog', { name: 'Discard draft?' })
  await user.click(within(dialog).getByRole('button', { name: 'Discard draft' }))
  expect(screen.getByText('guide.txt')).toBeVisible()
  expect(readAgentDraft('default')).toBeNull()
  expect(put).toHaveBeenCalledTimes(2)
})
