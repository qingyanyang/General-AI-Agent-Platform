import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'

import { GroupDetailPage } from '@/components/manage/group-detail-page'
import type { AppShellContext } from '@/components/shell/app-shell'
import { createChatClient } from '@/lib/api'
import {
  createManagementClient,
  type DirectoryUser,
  type GroupMembership,
  type ManagementClient,
} from '@/lib/management'
import { AGENT_ACCESS_MANAGE } from '@/lib/permissions'
import { clearReadCache } from '@/lib/read-cache'

const groupId = '11111111-1111-4111-8111-111111111111'

function renderGroup(overrides: Partial<ManagementClient>) {
  const getToken = async () => 'test-token'
  const context: AppShellContext = {
    client: createChatClient(getToken),
    managementClient: {
      ...createManagementClient(getToken),
      getGroup: async () => ({
        id: groupId, name: 'Support', description: null, designation: null,
        member_count: 0, agent_count: 0,
      }),
      listGroupAgents: async () => [],
      listMemberships: async () => ({ items: [], next_cursor: null }),
      ...overrides,
    },
    permissions: new Set([AGENT_ACCESS_MANAGE]),
    accountLabel: 'Administrator',
    accountName: null,
    accountEmail: null,
    accountRole: null,
    onUnauthorized: vi.fn(),
    onSignOut: vi.fn(),
    canCreateAgent: false,
    openCreateAgent: vi.fn(),
  }
  render(
    <MemoryRouter initialEntries={[`/groups/${groupId}`]}>
      <Routes>
        <Route element={<Outlet context={context} />}>
          <Route path="/groups/:groupId" element={<GroupDetailPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

function person(name: string, role: DirectoryUser['role'] = 'user'): DirectoryUser {
  return {
    user_id: name.toLowerCase(),
    email: `${name.toLowerCase()}@example.com`,
    display_name: name,
    role,
    email_verified: true,
    status: 'active',
    first_seen_at: '',
    last_seen_at: '',
  }
}

afterEach(() => {
  cleanup()
  clearReadCache()
})

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

it('lists eligible members before searching and adds the selected user with the chosen role', async () => {
  const user = userEvent.setup()
  const existingMember: GroupMembership = {
    user_id: 'existing', group_id: groupId, display_name: 'Existing', email: null,
    designation: 'member', created_at: '', updated_at: '',
  }
  const listUsers = vi.fn<ManagementClient['listUsers']>().mockResolvedValueOnce({
    items: [person('Ada'), person('Admin', 'admin'), person('Owner', 'super-admin'), person('Existing')],
    next_cursor: 'next',
  }).mockResolvedValueOnce({
    items: [person('Grace')],
    next_cursor: null,
  })
  const upsertMembership = vi.fn<ManagementClient['upsertMembership']>()
    .mockResolvedValue({ ...existingMember, user_id: 'grace', designation: 'leader' })
  renderGroup({
    listUsers,
    listMemberships: async () => ({ items: [existingMember], next_cursor: null }),
    upsertMembership,
  })

  await user.click(await screen.findByRole('button', { name: 'Add member' }))
  const dialog = within(screen.getByRole('dialog', { name: 'Add member' }))
  expect(await dialog.findByRole('radio', { name: /Ada/ })).toBeVisible()
  expect(dialog.getByRole('radio', { name: /Grace/ })).toBeVisible()
  expect(dialog.getAllByRole('radio')).toHaveLength(2)
  expect(dialog.getByRole('button', { name: 'Add member' })).toBeDisabled()
  expect(listUsers).toHaveBeenNthCalledWith(1, undefined, undefined, {
    role: 'user', excludeGroupId: groupId,
  })
  expect(listUsers).toHaveBeenNthCalledWith(2, undefined, 'next', {
    role: 'user', excludeGroupId: groupId,
  })

  await user.type(dialog.getByRole('textbox', { name: 'Search people' }), 'grace@')
  expect(dialog.getAllByRole('radio')).toHaveLength(1)
  await user.click(dialog.getByRole('radio', { name: /Grace/ }))
  await user.selectOptions(dialog.getByRole('combobox', { name: 'Group role' }), 'leader')
  await user.click(dialog.getByRole('button', { name: 'Add member' }))
  expect(upsertMembership).toHaveBeenCalledWith(groupId, { user_id: 'grace', designation: 'leader' })
})

it('shows agent loading placeholders until the assigned and available lists resolve', async () => {
  const user = userEvent.setup()
  const assigned = deferred<Awaited<ReturnType<ManagementClient['listGroupAgents']>>>()
  const choices = deferred<Awaited<ReturnType<ManagementClient['listAgents']>>>()
  await act(async () => {
    renderGroup({
      listGroupAgents: () => assigned.promise,
      listAgents: () => choices.promise,
    })
  })

  expect(await screen.findByRole('status', { name: 'Loading assigned agents' })).toBeVisible()
  expect(screen.queryByText('No agents assigned')).not.toBeInTheDocument()

  await act(async () => assigned.resolve([]))
  expect(await screen.findByText('No agents assigned')).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'Add agent' }))
  const dialog = within(screen.getByRole('dialog', { name: 'Add agent' }))
  expect(dialog.getByRole('status', { name: 'Loading agents' })).toBeVisible()
  expect(dialog.queryByText('There are no more agents to add.')).not.toBeInTheDocument()

  await act(async () => choices.resolve({ items: [], next_cursor: null }))
  expect(await dialog.findByText('There are no more agents to add.')).toBeVisible()
})
