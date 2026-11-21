import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'

import { UserDetailPage } from '@/components/manage/user-detail-page'
import type { AppShellContext } from '@/components/shell/app-shell'
import { createChatClient } from '@/lib/api'
import { createManagementClient, type RunUsage } from '@/lib/management'
import { AGENT_ACCESS_MANAGE } from '@/lib/permissions'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('paginates Usage and opens safe run details with clearly labeled partial costs', async () => {
  const user = userEvent.setup()
  const run: RunUsage = {
    id: 'run-1',
    user_id: 'subject',
    agent_id: 'default',
    session_id: null,
    status: 'awaiting_approval',
    started_at: '2026-11-21T02:00:00Z',
    completed_at: null,
    duration_ms: null,
    error_summary: null,
    langsmith_run_id: 'trace-1',
    models: [{ provider: 'openai', model: 'test-model' }],
    tokens: { completeness: 'partial', input_tokens: 9, output_tokens: 3, total_tokens: 12 },
    estimated_model_cost: {
      completeness: 'partial',
      totals: [{ currency: 'USD', amount: '0.000000001000' }, { currency: 'EUR', amount: '0.01' }],
    },
  }
  const fetchUsage = vi.fn<typeof fetch>(async (input) => {
    const { pathname, searchParams } = new URL(String(input), 'http://localhost')
    if (pathname === '/users/subject') {
      return Response.json({
        user_id: 'subject', display_name: 'Ada', email: null, email_verified: false,
        role: 'user', status: 'active', first_seen_at: '', last_seen_at: '', memberships: [],
      })
    }
    if (pathname === '/users/subject/executions') {
      const second = searchParams.get('cursor') === 'next'
      return Response.json({
        items: second ? [{
          ...run, id: 'run-2', agent_id: 'older-agent', status: 'failed',
          tokens: { completeness: 'not_captured', input_tokens: null, output_tokens: null, total_tokens: null },
          estimated_model_cost: { completeness: 'not_captured', totals: [] },
        }] : [run],
        next_cursor: second ? null : 'next',
        summary: { total: 2, by_status: { awaiting_approval: 1, failed: 1 } },
      })
    }
    if (pathname === '/users/subject/executions/run-1') {
      return Response.json({
        ...run,
        model_calls: [{
          id: 'model-1', provider: 'openai', requested_model: 'test-model',
          reported_model: null, started_at: run.started_at, status: 'succeeded', duration_ms: 95,
          tokens: { ...run.tokens, completeness: 'complete' },
          cached_input_tokens: 2, cache_write_tokens: null,
          estimated_model_cost: { completeness: 'unknown', totals: [] },
        }],
        tool_calls: [{
          id: 'tool-1', name: 'lookup', started_at: run.started_at, status: 'pending', duration_ms: null,
        }],
      })
    }
    throw new Error(`Unexpected request to ${pathname}`)
  })
  vi.stubGlobal('fetch', fetchUsage)
  const getToken = async () => 'test-token'
  const context: AppShellContext = {
    client: createChatClient(getToken),
    managementClient: createManagementClient(getToken),
    permissions: new Set([AGENT_ACCESS_MANAGE]),
    accountLabel: 'Admin', accountName: null, accountEmail: null, accountRole: null,
    onUnauthorized: vi.fn(), onSignOut: vi.fn(), canCreateAgent: false, openCreateAgent: vi.fn(),
  }
  render(
    <MemoryRouter initialEntries={['/users/subject/usage']}>
      <Routes>
        <Route element={<Outlet context={context} />}>
          <Route path="/users/:userId/:section" element={<UserDetailPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

  const table = await screen.findByRole('table')
  const rows = within(table)
  expect(rows.getByText('USD 0.000000001')).toBeVisible()
  expect(rows.getByText('EUR 0.01')).toBeVisible()
  expect(rows.getByText('Partial · known costs')).toBeVisible()
  expect(rows.getByText('Partial · known tokens')).toBeVisible()
  expect(rows.getByText('Awaiting approval')).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'Load more' }))
  expect(await rows.findByText('older-agent')).toBeVisible()
  expect(rows.getAllByText('Usage not captured')).toHaveLength(2)

  await user.click(rows.getAllByRole('button')[0])
  const detail = within(await screen.findByRole('region', { name: 'Execution details' }))
  expect(await detail.findByText('lookup')).toBeVisible()
  expect(detail.getByText('Cached input 2')).toBeVisible()
  expect(detail.getByText('Unknown')).toBeVisible()
  expect(detail.getByText('95 ms', { exact: false })).toBeVisible()
})
