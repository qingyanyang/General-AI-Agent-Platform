/** PROTOTYPE: access audience + group membership + leadership + owning group. */
import type {
  AccessAudienceMode,
  AccessSource,
  EffectiveAgentAccess,
  GroupAgentAssignment,
  GroupIdentity,
  GroupLeadership,
  GroupMembership,
  UserGroup,
} from './users-data'

export function groupsForUser(memberships: GroupMembership[], groups: UserGroup[], userId: string): UserGroup[] {
  const ids = new Set(memberships.filter((row) => row.user_id === userId).map((row) => row.group_id))
  return groups.filter((group) => ids.has(group.id))
}

export function ledGroupIds(leadership: GroupLeadership[], userId: string): Set<string> {
  return new Set(leadership.filter((row) => row.user_id === userId).map((row) => row.group_id))
}

export function isGroupLeader(leadership: GroupLeadership[], groupId: string, userId: string): boolean {
  return leadership.some((row) => row.group_id === groupId && row.user_id === userId)
}

export function memberGroupIds(memberships: GroupMembership[], userId: string): Set<string> {
  return new Set(memberships.filter((row) => row.user_id === userId).map((row) => row.group_id))
}

export function identityInGroup(
  memberships: GroupMembership[],
  leadership: GroupLeadership[],
  groupId: string,
  userId: string,
): GroupIdentity | null {
  if (!memberships.some((row) => row.group_id === groupId && row.user_id === userId)) {
    return null
  }
  return isGroupLeader(leadership, groupId, userId) ? 'Leader' : 'Member'
}

export function formatGroupIdentity(groupName: string, identity: GroupIdentity): string {
  return `${groupName} · ${identity}`
}

export function assignedAgentIds(
  memberships: GroupMembership[],
  assignments: GroupAgentAssignment[],
  userId: string,
): Set<string> {
  const groups = memberGroupIds(memberships, userId)
  return new Set(assignments.filter((row) => groups.has(row.group_id)).map((row) => row.agent_id))
}

export function audienceFor(
  accessAudience: Record<string, AccessAudienceMode>,
  agentId: string,
): AccessAudienceMode {
  return accessAudience[agentId] ?? 'groups'
}

export function canAccessAgent(
  memberships: GroupMembership[],
  assignments: GroupAgentAssignment[],
  accessAudience: Record<string, AccessAudienceMode>,
  userId: string,
  agentId: string,
): boolean {
  if (audienceFor(accessAudience, agentId) === 'company') {
    return true
  }
  return assignedAgentIds(memberships, assignments, userId).has(agentId)
}

/** Owning-group Leaders may edit the Prompt. No owning group / no Leader → not via this path. */
export function canEditPrompt(
  leadership: GroupLeadership[],
  owning: Record<string, string | null>,
  userId: string,
  agentId: string,
): boolean {
  const groupId = owning[agentId]
  if (!groupId) {
    return false
  }
  return isGroupLeader(leadership, groupId, userId)
}

export function effectiveAccessForUser(
  userId: string,
  memberships: GroupMembership[],
  assignments: GroupAgentAssignment[],
  groups: UserGroup[],
  leadership: GroupLeadership[],
  owning: Record<string, string | null>,
  accessAudience: Record<string, AccessAudienceMode>,
  agentIds: string[],
  agentNames: Map<string, string>,
): EffectiveAgentAccess[] {
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const usable = agentIds.filter((agentId) =>
    canAccessAgent(memberships, assignments, accessAudience, userId, agentId),
  )
  return usable
    .sort((a, b) => a.localeCompare(b))
    .map((agentId) => {
      const sources: AccessSource[] = []
      if (audienceFor(accessAudience, agentId) === 'company') {
        sources.push({ kind: 'company' })
      } else {
        for (const row of assignments.filter((item) => item.agent_id === agentId)) {
          if (!memberships.some((m) => m.group_id === row.group_id && m.user_id === userId)) {
            continue
          }
          const group = groupById.get(row.group_id)
          if (!group) {
            continue
          }
          sources.push({ kind: 'group', group_id: group.id, group_name: group.name })
        }
      }
      return {
        agent_id: agentId,
        agent_name: agentNames.get(agentId) ?? null,
        sources,
        can_use: sources.length > 0,
        can_edit_prompt: canEditPrompt(leadership, owning, userId, agentId),
      }
    })
}
