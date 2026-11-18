/** PROTOTYPE contexts and hooks. */
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'

import type { AgentRecord } from '@/lib/management'
import {
  AGENT_ACCESS_MANAGE,
  AGENTS_CONFIGURE,
  AGENTS_EXECUTE,
  AGENTS_READ,
} from '@/lib/permissions'

import type { ChatStore } from './chat-store'
import { callerCanEditPrompt, type AgentStatusFilter } from './mock/client'
import { draftAgentIds, subscribeConfigurationDrafts } from './mock/configuration-draft'
import { useOptions } from './mock/options'
import {
  AGENTS_PROMPT,
  DIRECTORY_BROWSE,
  PLATFORM_TECHNICAL,
  USAGE_READ_ANY,
  USERS_READ,
} from './mock/platform-permissions'
import { isGlobalBusinessRole, personaByKey, type RoleId } from './mock/roles'
import { readDisplayNameVersion, subscribeDisplayNames } from './mock/users-state'

export function usePermissions() {
  useSyncExternalStore(subscribeDisplayNames, readDisplayNameVersion)
  const { persona: personaKey } = useOptions()
  const current = personaByKey(personaKey)
  const permissions = new Set(current.permissions)
  const role: RoleId = current.id
  const globalBusiness = isGlobalBusinessRole(role)
  return {
    persona: current,
    role,
    canRead: permissions.has(AGENTS_READ),
    canExecute: permissions.has(AGENTS_EXECUTE),
    /** Full business configuration (Admin / Super Admin). */
    canConfigure: permissions.has(AGENTS_CONFIGURE) && globalBusiness,
    /** Instruction Skills; further scoped by managing-group leadership for Users. */
    canPrompt: permissions.has(AGENTS_PROMPT),
    canCreateAgent: false,
    canDeactivateAgent: false,
    canManageAllGroups: permissions.has(AGENT_ACCESS_MANAGE) && globalBusiness,
    canAssignGroups: permissions.has(AGENT_ACCESS_MANAGE) && globalBusiness,
    canAssignLeaders: permissions.has(AGENT_ACCESS_MANAGE) && globalBusiness,
    /** Membership changes are Admin and Super Admin only. */
    canManageLedMembers: false,
    canBrowsePeople: permissions.has(DIRECTORY_BROWSE),
    /** Administrator user-detail / membership inspection. */
    canReadUsers: permissions.has(USERS_READ) && globalBusiness,
    canOpenUserDetails: permissions.has(USERS_READ) && globalBusiness,
    canReadAnyUsage: permissions.has(USAGE_READ_ANY) && globalBusiness,
    canAccessTechnical: permissions.has(PLATFORM_TECHNICAL),
    isGlobalBusiness: globalBusiness,
    /** Legacy alias for admin group/access surfaces. */
    canManageAccess: permissions.has(AGENT_ACCESS_MANAGE) && globalBusiness,
  }
}

/** Per-agent Agent settings visibility. Hide settings entirely when none of these apply. */
export function useAgentSettingsAccess(agentId: string) {
  const permissions = usePermissions()
  const canOpenDetails = permissions.canConfigure && permissions.canRead
  const canEditSkills = permissions.canConfigure || (permissions.canPrompt && callerCanEditPrompt(agentId))
  const canOpenConfiguration = canEditSkills || (permissions.canAccessTechnical && permissions.canRead)
  const canOpenAccess = permissions.canAssignGroups
  return {
    canOpenDetails,
    canOpenConfiguration,
    canOpenAccess,
    canOpenSettings: canOpenDetails || canOpenConfiguration || canOpenAccess,
  }
}

/** Agent ids with an unpublished configuration draft for the signed-in editor. */
export function useDraftAgentIds(): Set<string> {
  const { persona } = usePermissions()
  const [ids, setIds] = useState(() => draftAgentIds(persona.userId))
  useEffect(() => {
    setIds(draftAgentIds(persona.userId))
    return subscribeConfigurationDrafts(() => setIds(draftAgentIds(persona.userId)))
  }, [persona.userId])
  return ids
}

export const UnsavedContext = createContext<(section: string, dirty: boolean) => void>(() => undefined)

/** Registers a section with unsaved edits so navigation asks before discarding them. */
export function useUnsaved(section: string, dirty: boolean) {
  const register = useContext(UnsavedContext)
  useEffect(() => {
    register(section, dirty)
    return () => register(section, false)
  }, [dirty, register, section])
}

export type CatalogState = {
  agents: AgentRecord[]
  cursor: string | null
  loading: boolean
  error: string | null
  status: AgentStatusFilter
  setStatus: (status: AgentStatusFilter) => void
  query: string
  setQuery: (query: string) => void
  reload: () => void
  loadMore: () => void
  upsert: (agent: AgentRecord) => void
}

export const CatalogContext = createContext<CatalogState | null>(null)

export function useCatalog(): CatalogState {
  const value = useContext(CatalogContext)
  if (!value) {
    throw new Error('useCatalog must be used inside CatalogProvider')
  }
  return value
}

export const ChatContext = createContext<ChatStore | null>(null)

export function useChat(): ChatStore {
  const store = useContext(ChatContext)
  if (!store) {
    throw new Error('useChat must be used inside ChatProvider')
  }
  return store
}

/** Applies a saved agent to both the picker catalog and the open chat header. */
export function useAgentSaved(): (agent: AgentRecord) => void {
  const { upsert } = useCatalog()
  const { agentChanged } = useChat()
  return (agent) => {
    upsert(agent)
    agentChanged(agent)
  }
}

export type ShellActions = {
  openCreateAgent: () => void
}

export const ShellActionsContext = createContext<ShellActions>({ openCreateAgent: () => undefined })

export function useShellActions(): ShellActions {
  return useContext(ShellActionsContext)
}

/** Ask before closing a dialog that holds unsaved input. */
export function useGuardedClose(dirty: boolean, close: () => void) {
  const [confirming, setConfirming] = useState(false)
  return {
    confirming,
    request: () => (dirty ? setConfirming(true) : close()),
    confirm: () => {
      setConfirming(false)
      close()
    },
    cancel: () => setConfirming(false),
  }
}

export function confirmMessage(sections: string[]): string {
  if (sections.length === 0) {
    return 'Your edits will be lost.'
  }
  return `Unsaved changes in ${sections.join(' and ')} will be lost.`
}
