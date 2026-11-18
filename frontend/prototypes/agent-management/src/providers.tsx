/** PROTOTYPE providers (#52, #53): unsaved-change guard, the agent catalog, and chat state. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useBlocker } from 'react-router-dom'

import { isApiError } from '@/lib/errors'
import type { AgentRecord } from '@/lib/management'

import { useChatState } from './chat-store'
import {
  CatalogContext,
  ChatContext,
  confirmMessage,
  UnsavedContext,
  usePermissions,
  type CatalogState,
} from './hooks'
import { mockClient, type AgentStatusFilter } from './mock/client'
import { appendLog } from './mock/options'
import { ConfirmDialog } from './ui'

export function UnsavedProvider({ children }: { children: ReactNode }) {
  const [dirtySections, setDirtySections] = useState<string[]>([])
  const dirty = dirtySections.length > 0

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    const state = nextLocation.state as { skipUnsavedGuard?: boolean } | null
    return (
      dirty &&
      !state?.skipUnsavedGuard &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search)
    )
  })

  useEffect(() => {
    if (!dirty) {
      return
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const register = useCallback((section: string, isDirty: boolean) => {
    setDirtySections((current) => {
      const has = current.includes(section)
      if (isDirty === has) {
        return current
      }
      return isDirty ? [...current, section] : current.filter((item) => item !== section)
    })
  }, [])

  return (
    <UnsavedContext.Provider value={register}>
      {children}
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Discard unsaved changes?"
        confirmLabel="Discard and leave"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={() => {
          setDirtySections([])
          blocker.proceed?.()
        }}
        onCancel={() => blocker.reset?.()}
      >
        {confirmMessage(dirtySections)}
      </ConfirmDialog>
    </UnsavedContext.Provider>
  )
}

export function CatalogProvider({ children }: { children: ReactNode }) {
  const { canRead, isGlobalBusiness } = usePermissions()
  const [agents, setAgents] = useState<AgentRecord[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(canRead)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatusState] = useState<AgentStatusFilter>('active')
  const [query, setQuery] = useState('')
  const generation = useRef(0)
  const effectiveStatus: AgentStatusFilter = isGlobalBusiness ? status : 'active'

  const setStatus = useCallback(
    (next: AgentStatusFilter) => {
      if (!isGlobalBusiness) {
        setStatusState('active')
        return
      }
      setStatusState(next)
    },
    [isGlobalBusiness],
  )

  const load = useCallback(
    async (filter: AgentStatusFilter, next?: string) => {
      if (!canRead) {
        return
      }
      const ticket = ++generation.current
      setLoading(true)
      setError(null)
      try {
        const result = await mockClient.listAgents(filter, next)
        if (generation.current !== ticket) {
          appendLog({ method: 'UI', path: `ignored stale agent list (${filter})`, status: 'stale' })
          return
        }
        setAgents((current) => (next ? [...current, ...result.items] : result.items))
        setCursor(result.next_cursor)
      } catch (caught) {
        if (generation.current !== ticket) {
          return
        }
        setError(isApiError(caught) ? caught.message : 'Could not load agents.')
      } finally {
        if (generation.current === ticket) {
          setLoading(false)
        }
      }
    },
    [canRead],
  )

  useEffect(() => {
    if (!isGlobalBusiness && status !== 'active') {
      setStatusState('active')
    }
  }, [isGlobalBusiness, status])

  useEffect(() => {
    void load(effectiveStatus)
  }, [load, effectiveStatus])

  const value = useMemo<CatalogState>(
    () => ({
      agents,
      cursor,
      loading,
      error,
      status,
      setStatus,
      query,
      setQuery,
      reload: () => void load(effectiveStatus),
      loadMore: () => {
        if (cursor) {
          void load(effectiveStatus, cursor)
        }
      },
      upsert: (agent) => {
        setAgents((current) => {
          const matches = effectiveStatus === 'all' || agent.status === effectiveStatus
          const rest = current.filter((item) => item.id !== agent.id)
          if (!matches) {
            return rest
          }
          const index = current.findIndex((item) => item.id === agent.id)
          if (index === -1) {
            return [agent, ...rest]
          }
          return current.map((item) => (item.id === agent.id ? agent : item))
        })
      },
    }),
    [agents, cursor, error, load, loading, query, status, effectiveStatus, setStatus],
  )

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const store = useChatState()
  return <ChatContext.Provider value={store}>{children}</ChatContext.Provider>
}
