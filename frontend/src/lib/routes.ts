/** Production route helpers aligned with the agent-management prototype. */

export type SettingsSection = 'details' | 'access' | 'configuration'

export const SETTINGS_SECTIONS: SettingsSection[] = ['details', 'configuration', 'access']

export const DIRECTORY_PATH = '/directory'
export const GROUPS_PATH = '/groups'
export const USERS_PATH = '/users'

export function userPath(userId: string, section?: 'access' | 'usage'): string {
  const path = `${USERS_PATH}/${encodeURIComponent(userId)}`
  return section ? `${path}/${section}` : path
}

export function groupPath(groupId: string): string {
  return `${GROUPS_PATH}/${encodeURIComponent(groupId)}`
}

export function chatPath(agentId?: string, sessionId?: string): string {
  if (!agentId) {
    return '/chat'
  }
  const base = `/chat/${encodeURIComponent(agentId)}`
  return sessionId ? `${base}/${encodeURIComponent(sessionId)}` : base
}

export function settingsPath(agentId: string, section?: SettingsSection): string {
  const base = `/agents/${encodeURIComponent(agentId)}/settings`
  return section ? `${base}/${section}` : base
}

export function isSettingsSection(value: string | undefined): value is SettingsSection {
  return value !== undefined && (SETTINGS_SECTIONS as string[]).includes(value)
}
