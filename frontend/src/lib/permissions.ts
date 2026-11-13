export const AGENTS_READ = 'agents:read'
export const AGENTS_CONFIGURE = 'agents:configure'
export const AGENTS_EXECUTE = 'agents:execute'
export const AGENT_ACCESS_MANAGE = 'agent-access:manage'

function decodeBase64Url(segment: string): string {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return atob(normalized + padding)
}

/**
 * Permissions for UI controls only. Matches the API: any invalid entry fails closed.
 * The backend still authorizes every request.
 */
export function permissionsFromToken(token: string): ReadonlySet<string> {
  const segment = token.split('.')[1]
  if (!segment) {
    return new Set()
  }
  let payload: unknown
  try {
    payload = JSON.parse(decodeBase64Url(segment)) as unknown
  } catch {
    return new Set()
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return new Set()
  }
  const raw = (payload as { permissions?: unknown }).permissions
  if (!Array.isArray(raw)) {
    return new Set()
  }
  const permissions = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string' || item.length === 0) {
      return new Set()
    }
    permissions.add(item)
  }
  return permissions
}

export function canOpenManagement(permissions: ReadonlySet<string>): boolean {
  return (
    permissions.has(AGENTS_READ) ||
    permissions.has(AGENTS_CONFIGURE) ||
    permissions.has(AGENT_ACCESS_MANAGE)
  )
}
