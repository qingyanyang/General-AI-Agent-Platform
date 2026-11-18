/** PROTOTYPE in-memory user directory / group / access-audience / owning-group state. */
import {
  seedAccessAudience,
  seedDirectoryUsers,
  seedGroupAssignments,
  seedGroups,
  seedLeadership,
  seedMemberships,
  seedOwningGroups,
  type AccessAudienceMode,
  type DirectoryUser,
  type GroupAgentAssignment,
  type GroupLeadership,
  type GroupMembership,
  type UserGroup,
} from './users-data'

const displayNames = new Map<string, string>()
const displayNameListeners = new Set<() => void>()
let displayNameVersion = 0

function notifyDisplayNames() {
  displayNameVersion += 1
  for (const listener of displayNameListeners) {
    listener()
  }
}

export function subscribeDisplayNames(listener: () => void): () => void {
  displayNameListeners.add(listener)
  return () => {
    displayNameListeners.delete(listener)
  }
}

export function readDisplayNameVersion(): number {
  return displayNameVersion
}

export function signedInDisplayName(userId: string, fallback: string): string {
  return displayNames.get(userId) ?? fallback
}

export function renameSignedInUser(userId: string, name: string) {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Enter a name.')
  }
  const initials = trimmed
    .split(' ')
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
  displayNames.set(userId, trimmed)
  users = users.map((user) =>
    user.id === userId ? { ...user, display_name: trimmed, avatar_initials: initials || user.avatar_initials } : user,
  )
  notifyDisplayNames()
}

let users = seedDirectoryUsers()
let groups = seedGroups()
let memberships = seedMemberships()
let leadership = seedLeadership()
let assignments = seedGroupAssignments()
let owning = seedOwningGroups()
let accessAudience = seedAccessAudience()
let groupSeq = groups.length

export function resetUsersState() {
  displayNames.clear()
  notifyDisplayNames()
  users = seedDirectoryUsers()
  groups = seedGroups()
  memberships = seedMemberships()
  leadership = seedLeadership()
  assignments = seedGroupAssignments()
  owning = seedOwningGroups()
  accessAudience = seedAccessAudience()
  groupSeq = groups.length
}

export function readUsers(): DirectoryUser[] {
  return users
}

export function writeUsers(next: DirectoryUser[]) {
  users = next
}

export function readGroups(): UserGroup[] {
  return groups
}

export function writeGroups(next: UserGroup[]) {
  groups = next
}

export function readMemberships(): GroupMembership[] {
  return memberships
}

export function writeMemberships(next: GroupMembership[]) {
  memberships = next
}

export function readLeadership(): GroupLeadership[] {
  return leadership
}

export function writeLeadership(next: GroupLeadership[]) {
  leadership = next
}

export function readAssignments(): GroupAgentAssignment[] {
  return assignments
}

export function writeAssignments(next: GroupAgentAssignment[]) {
  assignments = next
}

export function readOwning(): Record<string, string | null> {
  return owning
}

export function writeOwning(next: Record<string, string | null>) {
  owning = next
}

export function readAccessAudience(): Record<string, AccessAudienceMode> {
  return accessAudience
}

export function writeAccessAudience(next: Record<string, AccessAudienceMode>) {
  accessAudience = next
}

export function nextGroupSeq(): number {
  groupSeq += 1
  return groupSeq
}
