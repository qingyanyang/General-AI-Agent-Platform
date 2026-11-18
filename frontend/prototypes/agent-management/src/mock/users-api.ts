/**
 * PROTOTYPE mock API: directory, groups, leadership, access audience,
 * owning group, effective access, and admin usage inspection.
 */
import type { ExecutionRecord } from '@/lib/management'
import { AGENT_ACCESS_MANAGE } from '@/lib/permissions'

import {
  caller,
  callerIsGlobalAdmin,
  callerRole,
  deny,
  emptyScenario,
  findAgent,
  getExecutions,
  has,
  page,
  respond,
  scenarioError,
} from './client'
import {
  effectiveAccessForUser,
  groupsForUser,
  identityInGroup,
} from './effective-access'
import { DIRECTORY_BROWSE, USAGE_READ_ANY, USERS_READ } from './platform-permissions'
import type {
  AccessAudienceMode,
  DirectoryUser,
  EffectiveAgentAccess,
  UsageSummary,
  UserGroup,
} from './users-data'
import {
  nextGroupSeq,
  readAccessAudience,
  readAssignments,
  readGroups,
  readLeadership,
  readMemberships,
  readOwning,
  readUsers,
  writeUsers,
  writeAccessAudience,
  writeAssignments,
  writeGroups,
  writeLeadership,
  writeMemberships,
  writeOwning,
} from './users-state'

const USER_PAGE = 8
const GROUP_PAGE = 8
const MEMBER_PAGE = 8
const ASSIGNMENT_PAGE = 8
const USAGE_PAGE = 6

function findUser(id: string): DirectoryUser | undefined {
  return readUsers().find((user) => user.id === id)
}

function findGroup(id: string): UserGroup | undefined {
  return readGroups().find((group) => group.id === id)
}

function bumpGroup(groupId: string) {
  writeGroups(
    readGroups().map((group) =>
      group.id === groupId ? { ...group, updated_at: new Date().toISOString() } : group,
    ),
  )
}

function groupSummary(group: UserGroup, viewerId?: string) {
  const leaders = readLeadership()
    .filter((row) => row.group_id === group.id)
    .map((row) => {
      const user = findUser(row.user_id)
      return {
        user_id: row.user_id,
        display_name: user?.display_name ?? null,
        avatar_initials: user?.avatar_initials ?? '?',
      }
    })
  const owned = Object.entries(readOwning())
    .filter(([, owningGroupId]) => owningGroupId === group.id)
    .map(([agentId]) => ({
      agent_id: agentId,
      agent_name: findAgent(agentId)?.name ?? null,
    }))
  return {
    ...group,
    member_count: readMemberships().filter((row) => row.group_id === group.id).length,
    agent_count: readAssignments().filter((row) => row.group_id === group.id).length,
    leaders,
    owned_agents: owned,
    viewer_identity: viewerId
      ? identityInGroup(readMemberships(), readLeadership(), group.id, viewerId)
      : null,
  }
}

function canAdminUsers(): boolean {
  return has(USERS_READ) && callerIsGlobalAdmin()
}

function callerIsSuperAdmin(): boolean {
  return callerRole() === 'super-admin'
}

function isSuperAdminUser(user: DirectoryUser): boolean {
  return user.role_label === 'Super Admin'
}

/** Super Admins are visible only to Super Admins. */
function visibleDirectoryUsers(): DirectoryUser[] {
  const users = readUsers()
  if (callerIsSuperAdmin()) {
    return users
  }
  return users.filter((user) => !isSuperAdminUser(user))
}

function canViewDirectoryUser(userId: string): boolean {
  const user = findUser(userId)
  if (!user) {
    return false
  }
  return callerIsSuperAdmin() || !isSuperAdminUser(user)
}

function canListGroups(): boolean {
  return has(DIRECTORY_BROWSE) || canAdminUsers() || (has(AGENT_ACCESS_MANAGE) && callerIsGlobalAdmin())
}

function canViewGroup(groupId: string): boolean {
  if (has(AGENT_ACCESS_MANAGE) && callerIsGlobalAdmin()) {
    return true
  }
  return readMemberships().some((row) => row.group_id === groupId && row.user_id === caller().userId)
}

function canManageGroupMembers(groupId: string): boolean {
  return groupId.length > 0 && has(AGENT_ACCESS_MANAGE) && callerIsGlobalAdmin()
}

function matchUserQuery(user: DirectoryUser, query: string): boolean {
  if (!query) {
    return true
  }
  const needle = query.toLowerCase()
  return (
    user.id.toLowerCase().includes(needle) ||
    (user.display_name?.toLowerCase().includes(needle) ?? false) ||
    (user.email?.toLowerCase().includes(needle) ?? false)
  )
}

function filterUsage(
  records: ExecutionRecord[],
  query: { agentId?: string; status?: string; from?: string; to?: string },
): ExecutionRecord[] {
  return records.filter((execution) => {
    if (query.agentId && execution.agent_id !== query.agentId) {
      return false
    }
    if (query.status && execution.status !== query.status) {
      return false
    }
    if (query.from && execution.started_at < query.from) {
      return false
    }
    if (query.to && execution.started_at > query.to) {
      return false
    }
    return true
  })
}

function summarize(records: ExecutionRecord[]): UsageSummary {
  const by_status: Record<string, number> = {}
  for (const record of records) {
    by_status[record.status] = (by_status[record.status] ?? 0) + 1
  }
  return { total: records.length, by_status }
}

function withAgentNames(rows: EffectiveAgentAccess[]): EffectiveAgentAccess[] {
  return rows.map((row) => ({
    ...row,
    agent_name: findAgent(row.agent_id)?.name ?? row.agent_name,
  }))
}

function publicUser(user: DirectoryUser) {
  return {
    id: user.id,
    display_name: user.display_name,
    email: user.email,
    avatar_initials: user.avatar_initials,
  }
}

export const mockUsersApi = {
  /** Basic People directory — available to every signed-in role. */
  listPeople(
    query?: string,
    cursor?: string,
  ): Promise<{ items: ReturnType<typeof publicUser>[]; next_cursor: string | null }> {
    return respond('GET', `/people?q=${query ?? ''}${cursor ? `&cursor=${cursor}` : ''}`, () => {
      if (!has(DIRECTORY_BROWSE)) {
        return deny()
      }
      const failure = scenarioError('users')
      if (failure) {
        return failure
      }
      const matched = emptyScenario()
        ? []
        : visibleDirectoryUsers()
            .filter((user) => matchUserQuery(user, query?.trim() ?? ''))
            .slice()
            .sort((a, b) => (a.display_name ?? a.id).localeCompare(b.display_name ?? b.id))
            .map(publicUser)
      return { status: 200, body: page(matched, cursor, USER_PAGE) }
    })
  },

  searchPeople(query: string): Promise<ReturnType<typeof publicUser>[]> {
    return respond('GET', `/people/search?q=${query}`, () => {
      if (!has(DIRECTORY_BROWSE)) {
        return deny()
      }
      const matched = visibleDirectoryUsers()
        .filter((user) => matchUserQuery(user, query.trim()))
        .slice(0, 8)
        .map(publicUser)
      return { status: 200, body: matched }
    })
  },

  listUsers(query?: string, cursor?: string): Promise<{ items: DirectoryUser[]; next_cursor: string | null }> {
    return respond('GET', `/users?q=${query ?? ''}${cursor ? `&cursor=${cursor}` : ''}`, () => {
      // All signed-in roles may browse the list; Super Admins stay hidden from non–Super Admins.
      if (!(has(DIRECTORY_BROWSE) || canAdminUsers())) {
        return deny()
      }
      const failure = scenarioError('users')
      if (failure) {
        return failure
      }
      const matched = emptyScenario()
        ? []
        : visibleDirectoryUsers()
            .filter((user) => matchUserQuery(user, query?.trim() ?? ''))
            .slice()
            .sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at))
      return { status: 200, body: page(matched, cursor, USER_PAGE) }
    })
  },

  getUser(userId: string): Promise<DirectoryUser> {
    return respond('GET', `/users/${encodeURIComponent(userId)}`, () => {
      if (!canAdminUsers()) {
        return deny()
      }
      if (!canViewDirectoryUser(userId)) {
        return { status: 404, error: 'User not found' }
      }
      const user = findUser(userId)
      if (!user) {
        return { status: 404, error: 'User not found' }
      }
      return { status: 200, body: user }
    })
  },

  listUserGroups(userId: string): Promise<UserGroup[]> {
    return respond('GET', `/users/${encodeURIComponent(userId)}/groups`, () => {
      if (!canAdminUsers()) {
        return deny()
      }
      if (!canViewDirectoryUser(userId)) {
        return { status: 404, error: 'User not found' }
      }
      if (!findUser(userId)) {
        return { status: 404, error: 'User not found' }
      }
      return { status: 200, body: groupsForUser(readMemberships(), readGroups(), userId) }
    })
  },

  listUserEffectiveAccess(userId: string): Promise<EffectiveAgentAccess[]> {
    return respond('GET', `/users/${encodeURIComponent(userId)}/access`, () => {
      if (!canAdminUsers()) {
        return deny()
      }
      if (!canViewDirectoryUser(userId)) {
        return { status: 404, error: 'User not found' }
      }
      if (!findUser(userId)) {
        return { status: 404, error: 'User not found' }
      }
      const agentIds = Object.keys(readAccessAudience()).filter((id) => findAgent(id))
      const allAgents = [...new Set([...agentIds, ...readAssignments().map((row) => row.agent_id)])]
      const rows = effectiveAccessForUser(
        userId,
        readMemberships(),
        readAssignments(),
        readGroups(),
        readLeadership(),
        readOwning(),
        readAccessAudience(),
        allAgents,
        new Map(),
      )
      return { status: 200, body: withAgentNames(rows) }
    })
  },

  listUserUsage(
    userId: string,
    query: { agentId?: string; status?: string; from?: string; to?: string; cursor?: string },
  ): Promise<{ items: ExecutionRecord[]; next_cursor: string | null; summary: UsageSummary }> {
    const params = new URLSearchParams()
    if (query.agentId) params.set('agent_id', query.agentId)
    if (query.status) params.set('status', query.status)
    if (query.from) params.set('from', query.from)
    if (query.to) params.set('to', query.to)
    if (query.cursor) params.set('cursor', query.cursor)
    return respond('GET', `/admin/users/${encodeURIComponent(userId)}/executions?${params}`, () => {
      if (!(has(USAGE_READ_ANY) && callerIsGlobalAdmin())) {
        return deny()
      }
      if (!canViewDirectoryUser(userId)) {
        return { status: 404, error: 'User not found' }
      }
      if (!findUser(userId)) {
        return { status: 404, error: 'User not found' }
      }
      const failure = scenarioError('executions')
      if (failure) {
        return failure
      }
      const owned = emptyScenario()
        ? []
        : filterUsage(
            getExecutions().filter((execution) => execution.user_id === userId),
            query,
          ).sort((a, b) => b.started_at.localeCompare(a.started_at))
      const paged = page(owned, query.cursor, USAGE_PAGE)
      return { status: 200, body: { ...paged, summary: summarize(owned) } }
    })
  },

  listGroups(cursor?: string): Promise<{
    items: Array<ReturnType<typeof groupSummary>>
    next_cursor: string | null
  }> {
    return respond('GET', `/groups${cursor ? `?cursor=${cursor}` : ''}`, () => {
      if (!canListGroups()) {
        return deny()
      }
      const failure = scenarioError('groups')
      if (failure) {
        return failure
      }
      const me = caller().userId
      let items = emptyScenario()
        ? []
        : readGroups()
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((group) => groupSummary(group, me))
      if (!(has(AGENT_ACCESS_MANAGE) && callerIsGlobalAdmin())) {
        items = items.filter((group) => canViewGroup(group.id))
      }
      return { status: 200, body: page(items, cursor, GROUP_PAGE) }
    })
  },

  searchGroups(query: string): Promise<UserGroup[]> {
    return respond('GET', `/groups/search?q=${query}`, () => {
      if (!(has(AGENT_ACCESS_MANAGE) && callerIsGlobalAdmin()) && !has(DIRECTORY_BROWSE)) {
        return deny()
      }
      const needle = query.trim().toLowerCase()
      let matched = readGroups().filter(
        (group) =>
          !needle ||
          group.name.toLowerCase().includes(needle) ||
          group.id.toLowerCase().includes(needle),
      )
      if (!(has(AGENT_ACCESS_MANAGE) && callerIsGlobalAdmin())) {
        matched = matched.filter((group) => canViewGroup(group.id))
      }
      return { status: 200, body: matched.slice(0, 8) }
    })
  },

  getGroup(groupId: string): Promise<ReturnType<typeof groupSummary>> {
    return respond('GET', `/groups/${groupId}`, () => {
      if (!canListGroups() || !canViewGroup(groupId)) {
        return deny()
      }
      const group = findGroup(groupId)
      if (!group) {
        return { status: 404, error: 'Group not found' }
      }
      return { status: 200, body: groupSummary(group, caller().userId) }
    })
  },

  createGroup(body: { name: string; description: string | null }): Promise<UserGroup> {
    return respond('POST', '/groups', () => {
      if (!(has(AGENT_ACCESS_MANAGE) && callerIsGlobalAdmin())) {
        return deny()
      }
      const name = body.name.trim()
      if (!name) {
        return { status: 422, error: 'name must be a non-empty string' }
      }
      if (readGroups().some((group) => group.name.toLowerCase() === name.toLowerCase())) {
        return { status: 409, error: `A group named “${name}” already exists.` }
      }
      const now = new Date().toISOString()
      const created: UserGroup = {
        id: `grp-custom-${nextGroupSeq()}`,
        name,
        description: body.description?.trim() ? body.description.trim() : null,
        created_at: now,
        updated_at: now,
      }
      writeGroups([created, ...readGroups()])
      return { status: 201, body: created }
    })
  },

  updateGroup(groupId: string, body: { name: string; description: string | null }): Promise<UserGroup> {
    return respond('PATCH', `/groups/${groupId}`, () => {
      if (!(has(AGENT_ACCESS_MANAGE) && callerIsGlobalAdmin())) {
        return deny()
      }
      const group = findGroup(groupId)
      if (!group) {
        return { status: 404, error: 'Group not found' }
      }
      const name = body.name.trim()
      if (!name) {
        return { status: 422, error: 'name must be a non-empty string' }
      }
      if (
        readGroups().some((item) => item.id !== groupId && item.name.toLowerCase() === name.toLowerCase())
      ) {
        return { status: 409, error: `A group named “${name}” already exists.` }
      }
      const updated: UserGroup = {
        ...group,
        name,
        description: body.description?.trim() ? body.description.trim() : null,
        updated_at: new Date().toISOString(),
      }
      writeGroups(readGroups().map((item) => (item.id === groupId ? updated : item)))
      return { status: 200, body: updated }
    })
  },

  deleteGroup(groupId: string): Promise<void> {
    return respond('DELETE', `/groups/${groupId}`, () => {
      if (!(has(AGENT_ACCESS_MANAGE) && callerIsGlobalAdmin())) {
        return deny()
      }
      if (!findGroup(groupId)) {
        return { status: 404, error: 'Group not found' }
      }
      writeGroups(readGroups().filter((group) => group.id !== groupId))
      writeMemberships(readMemberships().filter((row) => row.group_id !== groupId))
      writeLeadership(readLeadership().filter((row) => row.group_id !== groupId))
      writeAssignments(readAssignments().filter((row) => row.group_id !== groupId))
      const nextOwning = { ...readOwning() }
      for (const [agentId, owningGroup] of Object.entries(nextOwning)) {
        if (owningGroup === groupId) {
          nextOwning[agentId] = null
        }
      }
      writeOwning(nextOwning)
      return { status: 204, body: undefined }
    })
  },

  listGroupMembers(
    groupId: string,
    cursor?: string,
  ): Promise<{ items: DirectoryUser[]; next_cursor: string | null }> {
    return respond('GET', `/groups/${groupId}/members${cursor ? `?cursor=${cursor}` : ''}`, () => {
      if (!canListGroups() || !canViewGroup(groupId)) {
        return deny()
      }
      if (!findGroup(groupId)) {
        return { status: 404, error: 'Group not found' }
      }
      const memberIds = new Set(
        readMemberships().filter((row) => row.group_id === groupId).map((row) => row.user_id),
      )
      const items = readUsers()
        .filter((user) => memberIds.has(user.id))
        .sort((a, b) => a.id.localeCompare(b.id))
      return { status: 200, body: page(items, cursor, MEMBER_PAGE) }
    })
  },

  addGroupMember(groupId: string, userId: string): Promise<DirectoryUser> {
    return respond('POST', `/groups/${groupId}/members`, () => {
      if (!canManageGroupMembers(groupId)) {
        return deny()
      }
      if (!findGroup(groupId)) {
        return { status: 404, error: 'Group not found' }
      }
      const user = findUser(userId)
      if (!user) {
        return { status: 404, error: 'User not found' }
      }
      if (!readMemberships().some((row) => row.group_id === groupId && row.user_id === userId)) {
        writeMemberships([...readMemberships(), { group_id: groupId, user_id: userId }])
        bumpGroup(groupId)
      }
      return { status: 200, body: user }
    })
  },

  removeGroupMember(groupId: string, userId: string): Promise<void> {
    return respond('DELETE', `/groups/${groupId}/members/${encodeURIComponent(userId)}`, () => {
      if (!canManageGroupMembers(groupId)) {
        return deny()
      }
      if (!findGroup(groupId)) {
        return { status: 404, error: 'Group not found' }
      }
      const before = readMemberships()
      const next = before.filter((row) => !(row.group_id === groupId && row.user_id === userId))
      if (next.length === before.length) {
        return { status: 404, error: 'Membership not found' }
      }
      writeMemberships(next)
      writeLeadership(readLeadership().filter((row) => !(row.group_id === groupId && row.user_id === userId)))
      bumpGroup(groupId)
      return { status: 204, body: undefined }
    })
  },

  setGroupLeader(groupId: string, userId: string): Promise<void> {
    return respond('PUT', `/groups/${groupId}/leaders/${encodeURIComponent(userId)}`, () => {
      if (!(has(AGENT_ACCESS_MANAGE) && callerIsGlobalAdmin())) {
        return deny()
      }
      if (!findGroup(groupId)) {
        return { status: 404, error: 'Group not found' }
      }
      if (!findUser(userId)) {
        return { status: 404, error: 'User not found' }
      }
      if (!readMemberships().some((row) => row.group_id === groupId && row.user_id === userId)) {
        return { status: 422, error: 'A leader must be a member of the group.' }
      }
      if (!readLeadership().some((row) => row.group_id === groupId && row.user_id === userId)) {
        writeLeadership([...readLeadership(), { group_id: groupId, user_id: userId }])
        bumpGroup(groupId)
      }
      return { status: 204, body: undefined }
    })
  },

  removeGroupLeader(groupId: string, userId: string): Promise<void> {
    return respond('DELETE', `/groups/${groupId}/leaders/${encodeURIComponent(userId)}`, () => {
      if (!(has(AGENT_ACCESS_MANAGE) && callerIsGlobalAdmin())) {
        return deny()
      }
      const before = readLeadership()
      const next = before.filter((row) => !(row.group_id === groupId && row.user_id === userId))
      if (next.length === before.length) {
        return { status: 404, error: 'Leadership not found' }
      }
      writeLeadership(next)
      bumpGroup(groupId)
      return { status: 204, body: undefined }
    })
  },

  listGroupAgents(
    groupId: string,
    cursor?: string,
  ): Promise<{
    items: Array<{ agent_id: string; agent_name: string | null; is_owning: boolean }>
    next_cursor: string | null
  }> {
    return respond('GET', `/groups/${groupId}/agents${cursor ? `?cursor=${cursor}` : ''}`, () => {
      if (!canListGroups() || !canViewGroup(groupId)) {
        return deny()
      }
      if (!findGroup(groupId)) {
        return { status: 404, error: 'Group not found' }
      }
      const owning = readOwning()
      const items = readAssignments()
        .filter((row) => row.group_id === groupId)
        .map((row) => ({
          agent_id: row.agent_id,
          agent_name: findAgent(row.agent_id)?.name ?? null,
          is_owning: owning[row.agent_id] === groupId,
        }))
        .sort((a, b) => a.agent_id.localeCompare(b.agent_id))
      return { status: 200, body: page(items, cursor, ASSIGNMENT_PAGE) }
    })
  },

  listAgentGroupAssignments(
    agentId: string,
  ): Promise<
    Array<{ group_id: string; group_name: string; member_count: number; is_owning: boolean }>
  > {
    return respond('GET', `/agents/${agentId}/group-assignments`, () => {
      if (!findAgent(agentId) && !(has(AGENT_ACCESS_MANAGE) && callerIsGlobalAdmin())) {
        return { status: 404, error: 'Agent not found' }
      }
      if (!has(USERS_READ) && !(has(AGENT_ACCESS_MANAGE) && callerIsGlobalAdmin())) {
        return deny()
      }
      const owningId = readOwning()[agentId] ?? null
      const rows = readAssignments()
        .filter((row) => row.agent_id === agentId)
        .map((row) => {
          const group = findGroup(row.group_id)
          return {
            group_id: row.group_id,
            group_name: group?.name ?? row.group_id,
            member_count: readMemberships().filter((m) => m.group_id === row.group_id).length,
            is_owning: owningId === row.group_id,
          }
        })
        .sort((a, b) => a.group_name.localeCompare(b.group_name))
      return { status: 200, body: rows }
    })
  },

  getAccessAudience(agentId: string): Promise<{ mode: AccessAudienceMode }> {
    return respond<{ mode: AccessAudienceMode }>('GET', `/agents/${agentId}/access-audience`, () => {
      if (!findAgent(agentId) && !(has(AGENT_ACCESS_MANAGE) && callerIsGlobalAdmin())) {
        return { status: 404, error: 'Agent not found' }
      }
      return { status: 200, body: { mode: readAccessAudience()[agentId] ?? 'groups' } }
    })
  },

  setAccessAudience(agentId: string, mode: AccessAudienceMode): Promise<{ mode: AccessAudienceMode }> {
    return respond<{ mode: AccessAudienceMode }>('PUT', `/agents/${agentId}/access-audience`, () => {
      if (!(has(AGENT_ACCESS_MANAGE) && callerIsGlobalAdmin())) {
        return deny()
      }
      if (!findAgent(agentId)) {
        return { status: 404, error: 'Agent not found' }
      }
      writeAccessAudience({ ...readAccessAudience(), [agentId]: mode })
      if (mode === 'groups') {
        const owningId = readOwning()[agentId] ?? null
        if (
          owningId &&
          !readAssignments().some((row) => row.group_id === owningId && row.agent_id === agentId)
        ) {
          writeAssignments([...readAssignments(), { group_id: owningId, agent_id: agentId }])
        }
      }
      return { status: 200, body: { mode } }
    })
  },

  assignGroupAgent(groupId: string, agentId: string): Promise<{ agent_id: string; agent_name: string | null }> {
    return respond('POST', `/groups/${groupId}/agents`, () => {
      if (!(has(AGENT_ACCESS_MANAGE) && callerIsGlobalAdmin())) {
        return deny()
      }
      if (!findGroup(groupId)) {
        return { status: 404, error: 'Group not found' }
      }
      const agent = findAgent(agentId)
      if (!agent) {
        return { status: 404, error: 'Agent not found' }
      }
      if (!readAssignments().some((row) => row.group_id === groupId && row.agent_id === agentId)) {
        writeAssignments([...readAssignments(), { group_id: groupId, agent_id: agentId }])
        bumpGroup(groupId)
      }
      return { status: 200, body: { agent_id: agentId, agent_name: agent.name } }
    })
  },

  unassignGroupAgent(groupId: string, agentId: string): Promise<void> {
    return respond('DELETE', `/groups/${groupId}/agents/${encodeURIComponent(agentId)}`, () => {
      if (!(has(AGENT_ACCESS_MANAGE) && callerIsGlobalAdmin())) {
        return deny()
      }
      if (!findGroup(groupId)) {
        return { status: 404, error: 'Group not found' }
      }
      const before = readAssignments()
      const next = before.filter((row) => !(row.group_id === groupId && row.agent_id === agentId))
      if (next.length === before.length) {
        return { status: 404, error: 'Assignment not found' }
      }
      writeAssignments(next)
      bumpGroup(groupId)
      return { status: 204, body: undefined }
    })
  },

  getOwningGroup(
    agentId: string,
  ): Promise<{
    group_id: string | null
    group_name: string | null
    leaders: Array<{ user_id: string; display_name: string | null }>
  }> {
    return respond<{
      group_id: string | null
      group_name: string | null
      leaders: Array<{ user_id: string; display_name: string | null }>
    }>('GET', `/agents/${agentId}/owning-group`, () => {
      if (!findAgent(agentId) && !(has(AGENT_ACCESS_MANAGE) && callerIsGlobalAdmin())) {
        return { status: 404, error: 'Agent not found' }
      }
      const groupId = readOwning()[agentId] ?? null
      const group = groupId ? findGroup(groupId) : null
      const leaders = groupId
        ? readLeadership()
            .filter((row) => row.group_id === groupId)
            .map((row) => ({
              user_id: row.user_id,
              display_name: findUser(row.user_id)?.display_name ?? null,
            }))
        : []
      return {
        status: 200,
        body: { group_id: groupId, group_name: group?.name ?? null, leaders },
      }
    })
  },

  /**
   * Set owning group. Does not remove the previous owning group’s access assignment.
   * When access is selected-groups, the new owning group is auto-included for use.
   */
  setOwningGroup(agentId: string, groupId: string | null): Promise<{ group_id: string | null }> {
    return respond<{ group_id: string | null }>('PUT', `/agents/${agentId}/owning-group`, () => {
      if (!(has(AGENT_ACCESS_MANAGE) && callerIsGlobalAdmin())) {
        return deny()
      }
      if (!findAgent(agentId)) {
        return { status: 404, error: 'Agent not found' }
      }
      if (groupId) {
        if (!findGroup(groupId)) {
          return { status: 404, error: 'Group not found' }
        }
        const mode = readAccessAudience()[agentId] ?? 'groups'
        if (
          mode === 'groups' &&
          !readAssignments().some((row) => row.group_id === groupId && row.agent_id === agentId)
        ) {
          writeAssignments([...readAssignments(), { group_id: groupId, agent_id: agentId }])
        }
      }
      writeOwning({ ...readOwning(), [agentId]: groupId })
      return { status: 200, body: { group_id: groupId } }
    })
  },

  inviteUser(input: {
    email: string
    role: 'super-admin' | 'admin' | 'user'
    groupIds: string[]
  }): Promise<DirectoryUser> {
    return respond('POST', '/users/invite', () => {
      if (!canAdminUsers()) {
        return deny()
      }
      const email = input.email.trim().toLowerCase()
      if (!email.includes('@')) {
        return { status: 400, error: 'Enter an email address.' }
      }
      if (input.role === 'super-admin' && !callerIsSuperAdmin()) {
        return { status: 403, error: 'Only a Super Admin can assign the Super Admin role.' }
      }
      if (readUsers().some((user) => user.email?.toLowerCase() === email)) {
        return { status: 409, error: 'That email is already in the directory.' }
      }
      const roleLabel =
        input.role === 'super-admin' ? 'Super Admin' : input.role === 'admin' ? 'Admin' : 'User'
      const user: DirectoryUser = {
        id: `auth0|invite-${readUsers().length + 1}`,
        display_name: email.split('@')[0] ?? email,
        email,
        avatar_initials: email.slice(0, 2).toUpperCase(),
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        role_label: roleLabel,
        status: 'pending',
      }
      writeUsers([user, ...readUsers()])
      const memberships = input.groupIds
        .filter((groupId) => findGroup(groupId))
        .map((groupId) => ({ group_id: groupId, user_id: user.id }))
      if (memberships.length > 0) {
        writeMemberships([...readMemberships(), ...memberships])
      }
      return { status: 201, body: user }
    })
  },

  updateUser(
    userId: string,
    patch: { role?: 'super-admin' | 'admin' | 'user'; status?: 'pending' | 'active' | 'disabled' },
  ): Promise<DirectoryUser> {
    return respond('PATCH', `/users/${encodeURIComponent(userId)}`, () => {
      if (!canAdminUsers()) {
        return deny()
      }
      const user = findUser(userId)
      if (!user || !canViewDirectoryUser(userId)) {
        return { status: 404, error: 'User not found' }
      }
      if (isSuperAdminUser(user) && !callerIsSuperAdmin()) {
        return { status: 403, error: 'An Admin cannot change a Super Admin account.' }
      }
      if (patch.role === 'super-admin' && !callerIsSuperAdmin()) {
        return { status: 403, error: 'Only a Super Admin can assign the Super Admin role.' }
      }
      const roleLabel = patch.role
        ? patch.role === 'super-admin'
          ? 'Super Admin'
          : patch.role === 'admin'
            ? 'Admin'
            : 'User'
        : user.role_label
      const next: DirectoryUser = {
        ...user,
        role_label: roleLabel,
        status: patch.status ?? user.status ?? 'active',
      }
      writeUsers(readUsers().map((row) => (row.id === userId ? next : row)))
      return { status: 200, body: next }
    })
  },
}
