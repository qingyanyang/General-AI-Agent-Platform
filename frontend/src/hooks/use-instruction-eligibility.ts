import { useCallback, useEffect, useRef, useState } from 'react'

import { isApiError } from '@/lib/errors'
import {
  readInstructionEligibility,
  writeInstructionEligibility,
  clearInstructionEligibility,
} from '@/lib/instruction-eligibility-cache'
import type { InstructionEligibility } from '@/lib/instruction-eligibility'
import type { InstructionSkillItem, ManagementClient } from '@/lib/management'

export type InstructionEligibilityState = {
  status: InstructionEligibility
  items: InstructionSkillItem[]
  message: string | null
  retry: () => void
}

type Options = {
  managementClient: ManagementClient | null
  agentId: string | null
  onUnauthorized: () => void
}

/**
 * Probes GET /agents/{id}/instruction-skills for the selected agent only.
 * Uses a generation counter so stale responses from a previous agent are ignored.
 */
export function useInstructionEligibility({
  managementClient,
  agentId,
  onUnauthorized,
}: Options): InstructionEligibilityState {
  const [status, setStatus] = useState<InstructionEligibility>('unknown')
  const [items, setItems] = useState<InstructionSkillItem[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const generation = useRef(0)
  const retryTick = useRef(0)
  const [retryKey, setRetryKey] = useState(0)
  const onUnauthorizedRef = useRef(onUnauthorized)
  onUnauthorizedRef.current = onUnauthorized

  const retry = useCallback(() => {
    if (agentId) {
      clearInstructionEligibility(agentId)
    }
    retryTick.current += 1
    setRetryKey(retryTick.current)
  }, [agentId])

  useEffect(() => {
    if (!agentId || !managementClient) {
      generation.current += 1
      setStatus('unknown')
      setItems([])
      setMessage(null)
      return
    }

    const known = readInstructionEligibility(agentId)
    if (known) {
      setItems(known.status === 'eligible' ? known.items : [])
      setStatus(known.status)
      setMessage(null)
      return
    }

    const ticket = generation.current + 1
    generation.current = ticket
    setStatus('loading')
    setMessage(null)

    let cancelled = false
    void managementClient
      .getInstructionSkills(agentId)
      .then((result) => {
        writeInstructionEligibility(agentId, { status: 'eligible', items: result.items })
        if (cancelled || generation.current !== ticket) {
          return
        }
        setItems(result.items)
        setStatus('eligible')
        setMessage(null)
      })
      .catch((error: unknown) => {
        if (isApiError(error) && error.status === 403) {
          writeInstructionEligibility(agentId, { status: 'forbidden' })
        }
        if (cancelled || generation.current !== ticket) {
          return
        }
        if (isApiError(error) && error.status === 401) {
          onUnauthorizedRef.current()
          return
        }
        if (isApiError(error) && error.status === 403) {
          setItems([])
          setStatus('forbidden')
          setMessage(null)
          return
        }
        setItems([])
        setStatus('error')
        setMessage(isApiError(error) ? error.message : 'Could not check Instruction Skills access.')
      })

    return () => {
      cancelled = true
    }
  }, [agentId, managementClient, retryKey])

  return { status, items, message, retry }
}
