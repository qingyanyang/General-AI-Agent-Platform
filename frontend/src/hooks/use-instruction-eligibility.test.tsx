import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useInstructionEligibility } from '@/hooks/use-instruction-eligibility'
import { clearInstructionEligibility } from '@/lib/instruction-eligibility-cache'
import { ApiError } from '@/lib/errors'
import type { ManagementClient } from '@/lib/management'

function client(
  getInstructionSkills: ManagementClient['getInstructionSkills'],
): ManagementClient {
  return { getInstructionSkills } as ManagementClient
}

describe('useInstructionEligibility', () => {
  beforeEach(() => {
    clearInstructionEligibility()
  })

  it('marks eligible on 200 and caches items', async () => {
    const items = [
      { id: '1', name: 'A', description: '', instructions: 'do' },
    ]
    const managementClient = client(async () => ({ items }))
    const { result } = renderHook(() =>
      useInstructionEligibility({
        managementClient,
        agentId: 'agent-1',
        onUnauthorized: vi.fn(),
      }),
    )
    await waitFor(() => expect(result.current.status).toBe('eligible'))
    expect(result.current.items).toEqual(items)
  })

  it('hides as forbidden on 403 without signing out', async () => {
    const onUnauthorized = vi.fn()
    const managementClient = client(async () => {
      throw new ApiError(403, 'Denied')
    })
    const { result } = renderHook(() =>
      useInstructionEligibility({
        managementClient,
        agentId: 'agent-1',
        onUnauthorized,
      }),
    )
    await waitFor(() => expect(result.current.status).toBe('forbidden'))
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('exposes a retryable error on network failure', async () => {
    let fail = true
    const getInstructionSkills = vi.fn(async () => {
      if (fail) {
        throw new Error('network down')
      }
      return { items: [] }
    })
    const managementClient = client(getInstructionSkills)
    const { result } = renderHook(() =>
      useInstructionEligibility({
        managementClient,
        agentId: 'agent-1',
        onUnauthorized: vi.fn(),
      }),
    )
    await waitFor(() => expect(result.current.status).toBe('error'))
    fail = false
    await act(async () => {
      result.current.retry()
    })
    await waitFor(() => expect(result.current.status).toBe('eligible'))
  })

  it('ignores stale responses after agentId changes', async () => {
    let resolveFirst: (value: { items: [] }) => void = () => undefined
    const first = new Promise<{ items: [] }>((resolve) => {
      resolveFirst = resolve
    })
    const getInstructionSkills = vi.fn(async (agentId: string) => {
      if (agentId === 'slow') {
        return first
      }
      return {
        items: [{ id: '2', name: 'Fast', description: '', instructions: 'go' }],
      }
    })
    const managementClient = client(getInstructionSkills)
    const { result, rerender } = renderHook(
      ({ agentId }: { agentId: string }) =>
        useInstructionEligibility({
          managementClient,
          agentId,
          onUnauthorized: vi.fn(),
        }),
      { initialProps: { agentId: 'slow' } },
    )
    rerender({ agentId: 'fast' })
    await waitFor(() => expect(result.current.status).toBe('eligible'))
    expect(result.current.items[0]?.name).toBe('Fast')
    await act(async () => {
      resolveFirst({ items: [] })
    })
    expect(result.current.items[0]?.name).toBe('Fast')
  })
})
