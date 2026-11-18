/**
 * PROTOTYPE: three fixed platform roles. Group leadership is not a platform role —
 * it is evaluated per group membership. Mock handlers authorize from permissions
 * plus resource scope (membership, leadership, access audience, owning group).
 */
import {
  AGENT_ACCESS_MANAGE,
  AGENTS_CONFIGURE,
  AGENTS_EXECUTE,
  AGENTS_READ,
} from '@/lib/permissions'

import {
  AGENTS_PROMPT,
  DIRECTORY_BROWSE,
  PLATFORM_TECHNICAL,
  USAGE_READ_ANY,
  USERS_READ,
} from './platform-permissions'
import { signedInDisplayName } from './users-state'

export type RoleId = 'super-admin' | 'admin' | 'user'

export type RolePersona = {
  id: RoleId
  /** Stable Demo-controls key when multiple people share the User role. */
  personaKey: string
  label: string
  userId: string
  displayName: string
  permissions: string[]
  summary: string
}

/** Documented Auth0-style mapping used by the prototype personas. */
export const ROLE_PERMISSIONS: Record<RoleId, string[]> = {
  'super-admin': [
    AGENTS_READ,
    AGENTS_CONFIGURE,
    AGENTS_EXECUTE,
    AGENTS_PROMPT,
    AGENT_ACCESS_MANAGE,
    USERS_READ,
    USAGE_READ_ANY,
    DIRECTORY_BROWSE,
    PLATFORM_TECHNICAL,
  ],
  admin: [
    AGENTS_READ,
    AGENTS_CONFIGURE,
    AGENTS_EXECUTE,
    AGENTS_PROMPT,
    AGENT_ACCESS_MANAGE,
    USERS_READ,
    USAGE_READ_ANY,
    DIRECTORY_BROWSE,
  ],
  user: [AGENTS_READ, AGENTS_EXECUTE, AGENTS_PROMPT, DIRECTORY_BROWSE],
}

/**
 * Demo personas. Platform roles are only Super Admin, Admin, and User.
 * Extra User people exercise group-scoped leadership scenarios.
 */
export const PERSONAS: RolePersona[] = [
  {
    id: 'super-admin',
    personaKey: 'super-admin',
    label: 'Super Admin',
    userId: 'auth0|mock-super-admin',
    displayName: 'Mock Super Admin',
    permissions: ROLE_PERMISSIONS['super-admin'],
    summary:
      'Business administration plus technical configuration (models, tools, credentials). Demo-only switch.',
  },
  {
    id: 'admin',
    personaKey: 'admin',
    label: 'Admin',
    userId: 'auth0|mock-admin',
    displayName: 'Mock Admin',
    permissions: ROLE_PERMISSIONS.admin,
    summary:
      'Users, groups, Instruction Skills for both agents, access, and usage. No system instructions or technical config.',
  },
  {
    id: 'user',
    personaKey: 'chelsea',
    label: 'User',
    userId: 'auth0|mock-chelsea',
    displayName: 'Chelsea Finance',
    permissions: ROLE_PERMISSIONS.user,
    summary:
      'Finance · Leader. Can use Estimator Service Agent. Cannot edit its Instruction Skills.',
  },
  {
    id: 'user',
    personaKey: 'avery',
    label: 'User',
    userId: 'auth0|mock-avery',
    displayName: 'Avery Estimating',
    permissions: ROLE_PERMISSIONS.user,
    summary: 'Estimator Group · Leader. Can edit Instruction Skills for Estimator Agent.',
  },
  {
    id: 'user',
    personaKey: 'morgan',
    label: 'User',
    userId: 'auth0|mock-morgan',
    displayName: 'Morgan AI Ops',
    permissions: ROLE_PERMISSIONS.user,
    summary: 'Estimator Service Group · Leader. Can edit Instruction Skills for Estimator Service Agent.',
  },
  {
    id: 'user',
    personaKey: 'sam',
    label: 'User',
    userId: 'auth0|mock-sam',
    displayName: 'Sam Finance',
    permissions: ROLE_PERMISSIONS.user,
    summary: 'Finance · Member. Can use Estimator Service Agent. Cannot edit skills.',
  },
]

export function personaByKey(personaKey: string): RolePersona {
  const persona = PERSONAS.find((item) => item.personaKey === personaKey)
  if (!persona) {
    throw new Error(`Unknown persona ${personaKey}`)
  }
  const displayName = signedInDisplayName(persona.userId, persona.displayName)
  return displayName === persona.displayName ? persona : { ...persona, displayName }
}

/** @deprecated Prefer personaByKey — kept for call sites that still pass RoleId during migration. */
export function personaById(id: RoleId | string): RolePersona {
  const byKey = PERSONAS.find((item) => item.personaKey === id)
  if (byKey) {
    return byKey
  }
  const byRole = PERSONAS.find((item) => item.id === id)
  if (!byRole) {
    throw new Error(`Unknown persona ${id}`)
  }
  return byRole
}

export function isGlobalBusinessRole(role: RoleId): boolean {
  return role === 'super-admin' || role === 'admin'
}
