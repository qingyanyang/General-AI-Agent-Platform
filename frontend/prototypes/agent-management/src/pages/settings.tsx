/** PROTOTYPE agent settings (#53): opened from Chat for the selected agent; returns to the same conversation. */
import { ArrowLeft, FileText, KeyRound, MessageSquare, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, NavLink, useLocation, useParams } from 'react-router-dom'

import { isApiError } from '@/lib/errors'
import type { AgentRecord } from '@/lib/management'
import { cn } from '@/lib/utils'

import { useAgentSaved, useAgentSettingsAccess, useCatalog, useChat, usePermissions } from '../hooks'
import { mockClient } from '../mock/client'
import { appendLog } from '../mock/options'
import {
  USERS_PATH,
  GROUPS_PATH,
  chatPath,
  isSettingsSection,
  SETTINGS_SECTIONS,
  settingsPath,
  type SettingsSection,
} from '../routes'
import { PageFrame } from '../shell'
import { AgentStatusBadge, CopyText, Notice, Skeleton } from '../ui'
import { AccessPanel } from './access'
import { ConfigurePage } from './configuration-tab'
import { DetailsSection } from './details-section'
export type MetadataState =
  | { kind: 'loading' }
  | { kind: 'ready'; agent: AgentRecord }
  | { kind: 'missing'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'skipped' }

function sectionMeta(section: SettingsSection): { label: string; icon: ReactNode } {
  switch (section) {
    case 'details':
      return { label: 'Details', icon: <FileText className="size-4" aria-hidden /> }
    case 'configuration':
      return { label: 'Configure', icon: <SlidersHorizontal className="size-4" aria-hidden /> }
    case 'access':
      return { label: 'Access', icon: <KeyRound className="size-4" aria-hidden /> }
    default: {
      const unreachable: never = section
      return unreachable
    }
  }
}

export function AgentSettingsPage() {
  const { agentId = '', section } = useParams()
  return <AgentSettings key={agentId} agentId={agentId} section={section} />
}

function useAgentMetadata(agentId: string, canRead: boolean) {
  const catalog = useCatalog()
  const known = catalog.agents.find((agent) => agent.id === agentId)
  const [meta, setMeta] = useState<MetadataState>(() => {
    if (!canRead) {
      return { kind: 'skipped' }
    }
    return known ? { kind: 'ready', agent: known } : { kind: 'loading' }
  })

  useEffect(() => {
    if (!canRead) {
      return
    }
    let active = true
    mockClient
      .getAgent(agentId)
      .then((agent) => {
        if (!active) {
          appendLog({ method: 'UI', path: `ignored stale agent ${agentId}`, status: 'stale' })
          return
        }
        setMeta({ kind: 'ready', agent })
      })
      .catch((error: unknown) => {
        if (!active) {
          return
        }
        if (isApiError(error) && error.status === 404) {
          setMeta({ kind: 'missing', message: error.message })
        } else {
          setMeta({ kind: 'error', message: isApiError(error) ? error.message : 'Could not load this agent.' })
        }
      })
    return () => {
      active = false
    }
  }, [agentId, canRead])

  return [meta, setMeta] as const
}

function BackLink({ agentId, agentName }: { agentId: string; agentName: string }) {
  const { canRead, canManageAccess, canReadUsers } = usePermissions()
  const chat = useChat()
  if (!canRead) {
    return (
      <Link
        to={canReadUsers ? USERS_PATH : canManageAccess ? GROUPS_PATH : '/chat'}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back
      </Link>
    )
  }
  const sameAgent = chat.lastChatPath.startsWith(chatPath(agentId))
  const session =
    sameAgent && chat.sessionState.kind === 'ready' && chat.sessionState.session.agent_id === agentId
      ? chat.sessionState.session
      : null
  return (
    <Link
      to={sameAgent ? chat.lastChatPath : chatPath(agentId)}
      className="inline-flex max-w-full items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{session ? `Back to “${session.title}”` : `Back to chat with ${agentName}`}</span>
    </Link>
  )
}

function AgentSettings({ agentId, section }: { agentId: string; section: string | undefined }) {
  const permissions = usePermissions()
  const settingsAccess = useAgentSettingsAccess(agentId)
  const location = useLocation()
  const onSaved = useAgentSaved()
  const routeState = location.state as { created?: boolean } | null
  const [meta, setMeta] = useAgentMetadata(agentId, permissions.canRead)

  const allowed = SETTINGS_SECTIONS.filter((item) => {
    switch (item) {
      case 'details':
        return settingsAccess.canOpenDetails
      case 'configuration':
        return settingsAccess.canOpenConfiguration
      case 'access':
        return settingsAccess.canOpenAccess
      default: {
        const unreachable: never = item
        return unreachable
      }
    }
  })

  const requested = section === 'skills' ? 'configuration' : section

  if (!settingsAccess.canOpenSettings || allowed.length === 0) {
    return <Navigate replace to={chatPath(agentId)} state={{ skipUnsavedGuard: true }} />
  }

  if (section === 'skills' && allowed.includes('configuration')) {
    return (
      <Navigate replace to={settingsPath(agentId, 'configuration')} state={{ ...routeState, skipUnsavedGuard: true }} />
    )
  }

  if (!isSettingsSection(requested) || !allowed.includes(requested)) {
    return <Navigate replace to={settingsPath(agentId, allowed[0])} state={{ ...routeState, skipUnsavedGuard: true }} />
  }

  const agent = meta.kind === 'ready' ? meta.agent : null
  const agentName = agent?.name ?? agentId

  return (
    <PageFrame mobileTitle={`Settings · ${agentName}`}>
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-5xl px-4 pt-5 sm:px-8 sm:pt-6">
          <BackLink agentId={agentId} agentName={agentName} />
          <p className="mt-4 text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">Agent settings</p>
          {meta.kind === 'loading' ? (
            <Skeleton className="mt-2 h-10 w-64 max-w-full" />
          ) : (
            <h1 className="mt-1 font-serif text-3xl break-words sm:text-4xl">{agentName}</h1>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {agent ? <AgentStatusBadge status={agent.status} /> : null}
            {meta.kind === 'skipped' ? (
              <span className="text-xs text-muted-foreground">Opened by ID · name and status need agents:read</span>
            ) : null}
            <div className="w-full max-w-xs min-w-0">
              <CopyText value={agentId} label="agent ID" />
            </div>
          </div>
          <nav aria-label="Settings sections" className="-mb-px mt-5 flex gap-1 overflow-x-auto">
            {allowed.map((item) => {
              const metaItem = sectionMeta(item)
              return (
                <NavLink
                  key={item}
                  to={settingsPath(agentId, item)}
                  className={({ isActive }) =>
                    cn(
                      'inline-flex shrink-0 items-center gap-2 border-b-2 px-2.5 pt-2 pb-3 text-sm font-medium whitespace-nowrap sm:px-3',
                      isActive
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )
                  }
                >
                  {metaItem.icon}
                  {metaItem.label}
                </NavLink>
              )
            })}
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-8">
        {routeState?.created ? (
          <Notice
            tone="success"
            title="Agent created"
            action={
              permissions.canRead ? (
                <Link
                  to={chatPath(agentId)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
                >
                  <MessageSquare className="size-3.5" aria-hidden />
                  Start a chat
                </Link>
              ) : null
            }
          >
            Assign groups under Access before people can use it. Business Skills hold the task rules.
          </Notice>
        ) : null}
        <SectionContent
          section={requested}
          agentId={agentId}
          meta={meta}
          onAgentUpdated={(updated) => {
            setMeta({ kind: 'ready', agent: updated })
            onSaved(updated)
          }}
        />
      </div>
    </PageFrame>
  )
}

function SectionContent({
  section,
  agentId,
  meta,
  onAgentUpdated,
}: {
  section: SettingsSection
  agentId: string
  meta: MetadataState
  onAgentUpdated: (agent: AgentRecord) => void
}) {
  const { canAccessTechnical, canConfigure } = usePermissions()
  switch (section) {
    case 'details':
      return <DetailsSection agentId={agentId} meta={meta} onUpdated={onAgentUpdated} />
    case 'configuration':
      return (
        <ConfigurePage agentId={agentId} technical={canAccessTechnical} knowledge={canConfigure} />
      )
    case 'access':
      return <AccessPanel agentId={agentId} />
    default: {
      const unreachable: never = section
      return unreachable
    }
  }
}
