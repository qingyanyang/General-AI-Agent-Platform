import type {
  AgentAccessConfig,
  AgentConfiguration,
  DirectoryUser,
  EffectiveAccess,
  ExecutionRecord,
  ExecutionSummary,
  GroupMembership,
  GroupRecord,
  LlmModel,
  SkillSummary,
  ToolCatalogItem,
} from '@/lib/management'

type Slot<T> = { value: T | null; inflight: Promise<T> | null }

function remember<T>(slot: Slot<T>, load: () => Promise<T>): Promise<T> {
  if (slot.value !== null) {
    return Promise.resolve(slot.value)
  }
  if (!slot.inflight) {
    slot.inflight = load()
      .then((value) => {
        slot.value = value
        return value
      })
      .finally(() => {
        slot.inflight = null
      })
  }
  return slot.inflight
}

const tools: Slot<ToolCatalogItem[]> = { value: null, inflight: null }
const models: Slot<LlmModel[]> = { value: null, inflight: null }
const skills: Slot<SkillSummary[]> = { value: null, inflight: null }
const groups: Slot<GroupRecord[]> = { value: null, inflight: null }
const configurations = new Map<string, AgentConfiguration>()
const accessConfigs = new Map<string, AgentAccessConfig>()
const groupRecords = new Map<string, GroupRecord>()
const memberships = new Map<string, CachedMemberships>()

type GroupDirectory = { items: GroupRecord[]; nextCursor: string | null }

export type CachedMemberships = {
  items: GroupMembership[]
  nextCursor: string | null
}

let directory: GroupDirectory | null = null
let groupsEpoch = 0

type UserDirectory = { items: DirectoryUser[]; nextCursor: string | null }

const usersDirectories = new Map<boolean, UserDirectory>()
let usersEpoch = 0

const userAccess = new Map<string, EffectiveAccess[]>()
let userAccessVersion = 0

export type CachedUserUsage = {
  items: ExecutionRecord[]
  summary: ExecutionSummary
}

const userUsage = new Map<string, CachedUserUsage>()
let userUsageVersion = 0

function rememberGroupRecords(items: GroupRecord[]) {
  for (const item of items) {
    groupRecords.set(item.id, item)
  }
}

export function cachedTools(load: () => Promise<ToolCatalogItem[]>): Promise<ToolCatalogItem[]> {
  return remember(tools, load)
}

export function cachedModels(load: () => Promise<LlmModel[]>): Promise<LlmModel[]> {
  return remember(models, load)
}

export function cachedSkills(load: () => Promise<SkillSummary[]>): Promise<SkillSummary[]> {
  return remember(skills, load)
}

export function readGroupDirectory(): GroupDirectory | null {
  return directory
}

export function writeGroupDirectory(items: GroupRecord[], nextCursor: string | null) {
  directory = { items, nextCursor }
  rememberGroupRecords(items)
  groups.value = nextCursor === null ? items : null
}

export function readCompleteGroups(): GroupRecord[] | null {
  if (groups.value) {
    return groups.value
  }
  if (directory && directory.nextCursor === null) {
    return directory.items
  }
  return null
}

export function cachedGroups(load: () => Promise<GroupRecord[]>): Promise<GroupRecord[]> {
  const ready = readCompleteGroups()
  if (ready) {
    groups.value = ready
    return Promise.resolve(ready)
  }
  if (!groups.inflight) {
    const epoch = groupsEpoch
    const pending = load()
      .then((items) => {
        if (epoch === groupsEpoch) {
          writeGroupDirectory(items, null)
        }
        return items
      })
      .finally(() => {
        if (groups.inflight === pending) {
          groups.inflight = null
        }
      })
    groups.inflight = pending
  }
  return groups.inflight
}

export function readUserDirectory(showSuperAdmins: boolean): UserDirectory | null {
  return usersDirectories.get(showSuperAdmins) ?? null
}

export function writeUserDirectory(
  showSuperAdmins: boolean,
  items: DirectoryUser[],
  nextCursor: string | null,
) {
  usersDirectories.set(showSuperAdmins, { items, nextCursor })
}

export function usersCacheEpoch(): number {
  return usersEpoch
}

export function clearUsersCache() {
  usersEpoch += 1
  usersDirectories.clear()
}

export function readCachedUserAccess(userId: string): EffectiveAccess[] | null {
  return userAccess.has(userId) ? (userAccess.get(userId) ?? null) : null
}

export function writeCachedUserAccess(userId: string, rows: EffectiveAccess[]) {
  userAccess.set(userId, rows)
}

export function userAccessEpoch(): number {
  return userAccessVersion
}

export function clearUserAccessCache() {
  userAccessVersion += 1
  userAccess.clear()
}

export function userUsageCacheKey(
  userId: string,
  query: { agentId: string; status: string; from: string; to: string },
): string {
  return `${userId}\n${query.agentId}\n${query.status}\n${query.from}\n${query.to}`
}

export function readCachedUserUsage(key: string): CachedUserUsage | null {
  return userUsage.get(key) ?? null
}

export function writeCachedUserUsage(key: string, value: CachedUserUsage) {
  userUsage.set(key, value)
}

export function userUsageEpoch(): number {
  return userUsageVersion
}

export function clearUserUsageCache() {
  userUsageVersion += 1
  userUsage.clear()
}

export function clearGroupsCache() {
  groupsEpoch += 1
  groups.value = null
  groups.inflight = null
  directory = null
  groupRecords.clear()
  clearUserAccessCache()
}

export function readCachedGroup(groupId: string): GroupRecord | null {
  return groupRecords.get(groupId) ?? null
}

export function writeCachedGroup(group: GroupRecord) {
  groupRecords.set(group.id, group)
}

export function readCachedMemberships(groupId: string): CachedMemberships | null {
  return memberships.get(groupId) ?? null
}

export function writeCachedMemberships(groupId: string, value: CachedMemberships) {
  memberships.set(groupId, value)
}

export function dropCachedMemberships(groupId: string) {
  memberships.delete(groupId)
}

export function readCachedAccess(agentId: string): AgentAccessConfig | null {
  return accessConfigs.get(agentId) ?? null
}

export function writeCachedAccess(agentId: string, value: AgentAccessConfig) {
  accessConfigs.set(agentId, value)
}

export function dropCachedAccess(agentId: string) {
  accessConfigs.delete(agentId)
}

export function readCachedConfiguration(agentId: string): AgentConfiguration | null {
  return configurations.get(agentId) ?? null
}

export function writeCachedConfiguration(agentId: string, value: AgentConfiguration) {
  configurations.set(agentId, value)
}

export function clearReadCache() {
  tools.value = null
  tools.inflight = null
  models.value = null
  models.inflight = null
  skills.value = null
  skills.inflight = null
  clearGroupsCache()
  clearUsersCache()
  clearUserUsageCache()
  configurations.clear()
  accessConfigs.clear()
  memberships.clear()
}
