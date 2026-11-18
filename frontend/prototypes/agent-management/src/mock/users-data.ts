/**
 * PROTOTYPE MOCK DATA: directory users, groups, leadership, access audience,
 * group→agent assignments, and per-agent owning group (Prompt editors).
 *
 * Required scenarios:
 * - Estimator Agent is managed by the Estimator Group.
 * - Estimator Service Agent is managed by the Estimator Service Group.
 * - Finance can use Estimator Service Agent and cannot edit its skills.
 */

function at(day: number, hour: number, minute = 0): string {
  return new Date(Date.UTC(2026, 10, day, hour, minute)).toISOString()
}

function usageUuid(seed: number): string {
  const hex = (seed * 2654435761).toString(16).padStart(8, '0').slice(-8)
  return `${hex}-5a1e-4c2d-9b3f-${String(seed).padStart(12, '0')}`
}

export type DirectoryUser = {
  id: string
  display_name: string | null
  email: string | null
  /** Initials or short label for the avatar circle. */
  avatar_initials: string
  first_seen_at: string
  last_seen_at: string
  /** Display role. Invite and administrator actions can change it in this prototype. */
  role_label: string | null
  /** Account setup state. Omitted means active. */
  status?: 'pending' | 'active' | 'disabled'
}

export type UserGroup = {
  id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

export type GroupMembership = {
  group_id: string
  user_id: string
}

export type GroupLeadership = {
  group_id: string
  user_id: string
}

/** Membership in an assigned group can use the agent when access mode is `groups`. */
export type GroupAgentAssignment = {
  group_id: string
  agent_id: string
}

/** `company` = everyone; `groups` = only assigned groups. */
export type AccessAudienceMode = 'company' | 'groups'

export type AccessSource =
  | { kind: 'company' }
  | { kind: 'group'; group_id: string; group_name: string }

export type EffectiveAgentAccess = {
  agent_id: string
  agent_name: string | null
  sources: AccessSource[]
  can_use: boolean
  can_edit_prompt: boolean
}

export type UsageSummary = {
  total: number
  by_status: Record<string, number>
}

export type GroupIdentity = 'Leader' | 'Member'

export function seedDirectoryUsers(): DirectoryUser[] {
  return [
    {
      id: 'auth0|mock-super-admin',
      display_name: 'Mock Super Admin',
      email: 'super.admin@example.construction',
      avatar_initials: 'SA',
      first_seen_at: at(1, 0),
      last_seen_at: at(17, 2, 10),
      role_label: 'Super Admin',
    },
    {
      id: 'auth0|mock-admin',
      display_name: 'Mock Admin',
      email: 'admin@example.construction',
      avatar_initials: 'MA',
      first_seen_at: at(1, 1),
      last_seen_at: at(17, 1, 55),
      role_label: 'Admin',
    },
    {
      id: 'auth0|mock-chelsea',
      display_name: 'Chelsea Finance',
      email: 'chelsea@example.construction',
      avatar_initials: 'CF',
      first_seen_at: at(2, 4),
      last_seen_at: at(17, 1, 40),
      role_label: 'User',
    },
    {
      id: 'auth0|mock-morgan',
      display_name: 'Morgan AI Ops',
      email: 'morgan@example.construction',
      avatar_initials: 'MO',
      first_seen_at: at(3, 5),
      last_seen_at: at(17, 0, 50),
      role_label: 'User',
    },
    {
      id: 'auth0|mock-sam',
      display_name: 'Sam Finance',
      email: 'sam@example.construction',
      avatar_initials: 'SF',
      first_seen_at: at(3, 8),
      last_seen_at: at(16, 22, 5),
      role_label: 'User',
    },
    {
      id: 'auth0|mock-riley',
      display_name: 'Riley AI Ops',
      email: 'riley@example.construction',
      avatar_initials: 'RA',
      first_seen_at: at(4, 6),
      last_seen_at: at(16, 18, 0),
      role_label: 'User',
    },
    {
      id: 'auth0|mock-jordan',
      display_name: 'Jordan Project',
      email: 'jordan@example.construction',
      avatar_initials: 'JP',
      first_seen_at: at(7, 1),
      last_seen_at: at(17, 0, 30),
      role_label: 'User',
    },
    {
      id: 'auth0|mock-avery',
      display_name: 'Avery Estimating',
      email: 'avery@example.construction',
      avatar_initials: 'AE',
      first_seen_at: at(8, 3),
      last_seen_at: at(17, 1, 20),
      role_label: 'User',
    },
    {
      id: 'auth0|mock-unrelated',
      display_name: 'Pat Outside',
      email: 'pat@example.construction',
      avatar_initials: 'PO',
      first_seen_at: at(10, 7),
      last_seen_at: at(15, 14, 22),
      role_label: 'User',
      status: 'disabled',
    },
    {
      id: 'auth0|mock-pending',
      display_name: 'Casey Invite',
      email: 'casey@example.construction',
      avatar_initials: 'CI',
      first_seen_at: at(17, 3),
      last_seen_at: at(17, 3),
      role_label: 'User',
      status: 'pending',
    },
  ]
}

export function seedGroups(): UserGroup[] {
  return [
    {
      id: 'grp-estimating',
      name: 'Estimator Group',
      description: 'Managing group for Estimator Agent. Avery is the Leader.',
      created_at: at(5, 8),
      updated_at: at(15, 8),
    },
    {
      id: 'grp-estimator-service',
      name: 'Estimator Service Group',
      description: 'Managing group for Estimator Service Agent. Morgan is the Leader.',
      created_at: at(5, 9),
      updated_at: at(15, 9),
    },
    {
      id: 'grp-finance',
      name: 'Finance',
      description: 'Uses Estimator Service Agent. Chelsea is the Leader and cannot edit its skills.',
      created_at: at(5, 1),
      updated_at: at(15, 4),
    },
  ]
}

export function seedMemberships(): GroupMembership[] {
  return [
    { group_id: 'grp-estimating', user_id: 'auth0|mock-avery' },
    { group_id: 'grp-estimating', user_id: 'auth0|mock-jordan' },
    { group_id: 'grp-estimator-service', user_id: 'auth0|mock-morgan' },
    { group_id: 'grp-estimator-service', user_id: 'auth0|mock-riley' },
    { group_id: 'grp-finance', user_id: 'auth0|mock-chelsea' },
    { group_id: 'grp-finance', user_id: 'auth0|mock-sam' },
  ]
}

export function seedLeadership(): GroupLeadership[] {
  return [
    { group_id: 'grp-estimating', user_id: 'auth0|mock-avery' },
    { group_id: 'grp-estimator-service', user_id: 'auth0|mock-morgan' },
    { group_id: 'grp-finance', user_id: 'auth0|mock-chelsea' },
  ]
}

export function seedAccessAudience(): Record<string, AccessAudienceMode> {
  return {
    'estimator-agent': 'groups',
    'estimator-service-agent': 'groups',
  }
}

export function seedGroupAssignments(): GroupAgentAssignment[] {
  return [
    { group_id: 'grp-estimating', agent_id: 'estimator-agent' },
    { group_id: 'grp-estimator-service', agent_id: 'estimator-service-agent' },
    { group_id: 'grp-finance', agent_id: 'estimator-service-agent' },
  ]
}

/** Managing group for Instruction Skills. Separate from groups that can only use the agent. */
export function seedOwningGroups(): Record<string, string | null> {
  return {
    'estimator-agent': 'grp-estimating',
    'estimator-service-agent': 'grp-estimator-service',
  }
}

export function seedExtraUserExecutions(): {
  id: string
  user_id: string
  agent_id: string
  session_id: string | null
  status: string
  started_at: string
  completed_at: string | null
  duration_ms: number | null
  error_summary: string | null
  langsmith_run_id: string
}[] {
  const rows: {
    user_id: string
    agent_id: string
    status: string
    day: number
    hour: number
    minute: number
    durationMs: number | null
    error: string | null
  }[] = [
    {
      user_id: 'auth0|mock-chelsea',
      agent_id: 'estimator-service-agent',
      status: 'succeeded',
      day: 17,
      hour: 0,
      minute: 40,
      durationMs: 980,
      error: null,
    },
    {
      user_id: 'auth0|mock-sam',
      agent_id: 'estimator-service-agent',
      status: 'failed',
      day: 16,
      hour: 21,
      minute: 5,
      durationMs: 410,
      error: 'Agent execution failed: upstream model timeout',
    },
    {
      user_id: 'auth0|mock-morgan',
      agent_id: 'estimator-agent',
      status: 'succeeded',
      day: 16,
      hour: 11,
      minute: 0,
      durationMs: 3012,
      error: null,
    },
    {
      user_id: 'auth0|mock-riley',
      agent_id: 'estimator-agent',
      status: 'succeeded',
      day: 15,
      hour: 14,
      minute: 0,
      durationMs: 1540,
      error: null,
    },
  ]
  return rows.map((row, index) => {
    const started = new Date(Date.UTC(2026, 10, row.day, row.hour, row.minute))
    const id = usageUuid(7000 + index)
    const open = row.status === 'running' || row.status === 'awaiting_approval'
    return {
      id,
      user_id: row.user_id,
      agent_id: row.agent_id,
      session_id: usageUuid(7100 + index),
      status: row.status,
      started_at: started.toISOString(),
      completed_at:
        open || row.durationMs === null ? null : new Date(started.getTime() + row.durationMs).toISOString(),
      duration_ms: open ? null : row.durationMs,
      error_summary: row.error,
      langsmith_run_id: id,
    }
  })
}
