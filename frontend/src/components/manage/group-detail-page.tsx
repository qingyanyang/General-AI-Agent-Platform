import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { PageFrame } from '@/components/shell/app-shell'
import { useAppShell } from '@/components/shell/use-app-shell'
import { Button } from '@/components/ui/button'
import {
  Badge,
  ConfirmDialog,
  CopyText,
  DangerZone,
  EmptyState,
  IconButton,
  LoadingRows,
  Notice,
  SaveStatus,
  type SaveState,
  SectionCard,
  TextArea,
  TextField,
} from '@/components/ui/primitives'
import { isApiError } from '@/lib/errors'
import type { AgentRecord, DirectoryUser, GroupAgent, GroupDesignation, GroupMembership, GroupRecord } from '@/lib/management'
import {
  clearGroupsCache,
  dropCachedAccess,
  dropCachedMemberships,
  readCachedGroup,
  readCachedMemberships,
  writeCachedGroup,
  writeCachedMemberships,
} from '@/lib/read-cache'
import { AGENT_ACCESS_MANAGE } from '@/lib/permissions'
import { GROUPS_PATH, settingsPath, userPath } from '@/lib/routes'

function designationTone(designation: GroupDesignation): 'primary' | 'neutral' {
  switch (designation) {
    case 'leader':
      return 'primary'
    case 'member':
      return 'neutral'
    default: {
      const unreachable: never = designation
      return unreachable
    }
  }
}

function formatDateTime(value: string | undefined): string {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function personInitials(member: GroupMembership): string {
  const source = member.display_name || member.email || member.user_id
  const parts = source.split(/[\s@.]+/).filter(Boolean)
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?'
}

function groupInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  const letters = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '')
  return letters.join('') || 'G'
}

export function GroupDetailPage() {
  const { groupId = '' } = useParams()
  const navigate = useNavigate()
  const { managementClient, permissions, onUnauthorized } = useAppShell()
  const canManage = permissions.has(AGENT_ACCESS_MANAGE)

  const cachedGroup = readCachedGroup(groupId)
  const cachedMembers = readCachedMemberships(groupId)
  const [group, setGroup] = useState<GroupRecord | null>(cachedGroup)
  const [members, setMembers] = useState<GroupMembership[]>(cachedMembers?.items ?? [])
  const [cursor, setCursor] = useState<string | null>(cachedMembers?.nextCursor ?? null)
  const [loading, setLoading] = useState(cachedGroup === null)
  const [membersLoading, setMembersLoading] = useState(cachedMembers === null)
  const [seenGroupId, setSeenGroupId] = useState(groupId)
  const [error, setError] = useState<string | null>(null)
  const [memberError, setMemberError] = useState<string | null>(null)
  const [personQuery, setPersonQuery] = useState('')
  const [memberChoices, setMemberChoices] = useState<DirectoryUser[] | null>(null)
  const [memberPickerError, setMemberPickerError] = useState<string | null>(null)
  const [selectedPerson, setSelectedPerson] = useState<DirectoryUser | null>(null)
  const [designation, setDesignation] = useState<GroupDesignation>('member')
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addingAgent, setAddingAgent] = useState(false)
  const [agentQuery, setAgentQuery] = useState('')
  const [agentChoices, setAgentChoices] = useState<AgentRecord[] | null>(null)
  const [agentPickerError, setAgentPickerError] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [agentError, setAgentError] = useState<string | null>(null)
  const [draftName, setDraftName] = useState<string | null>(null)
  const [draftDescription, setDraftDescription] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' })
  const [deleting, setDeleting] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [agents, setAgents] = useState<GroupAgent[] | null>(null)
  const [assignedAgentsError, setAssignedAgentsError] = useState<string | null>(null)
  const [pendingRemove, setPendingRemove] = useState<GroupMembership | null>(null)
  const generation = useRef(0)

  if (seenGroupId !== groupId) {
    const nextGroup = readCachedGroup(groupId)
    const nextMembers = readCachedMemberships(groupId)
    setSeenGroupId(groupId)
    setGroup(nextGroup)
    setMembers(nextMembers?.items ?? [])
    setCursor(nextMembers?.nextCursor ?? null)
    setLoading(nextGroup === null)
    setMembersLoading(nextMembers === null)
    setError(null)
    setMemberError(null)
    setAgents(null)
    setAssignedAgentsError(null)
    setAdding(false)
    setAddingAgent(false)
  }

  const loadGroup = useCallback(async () => {
    const ticket = generation.current + 1
    generation.current = ticket
    setLoading(true)
    setError(null)
    try {
      const next = await managementClient.getGroup(groupId)
      if (generation.current !== ticket) {
        return
      }
      writeCachedGroup(next)
      setGroup(next)
    } catch (caught) {
      if (generation.current !== ticket) {
        return
      }
      if (isApiError(caught) && caught.status === 401) {
        onUnauthorized()
        return
      }
      setError(isApiError(caught) ? caught.message : 'Could not load this group.')
      setGroup(null)
    } finally {
      if (generation.current === ticket) {
        setLoading(false)
      }
    }
  }, [groupId, managementClient, onUnauthorized])

  const loadMembers = useCallback(
    async (nextCursor?: string) => {
      const ticket = generation.current
      setMembersLoading(true)
      setMemberError(null)
      try {
        const page = await managementClient.listMemberships(groupId, nextCursor)
        if (generation.current !== ticket) {
          return
        }
        const previous = nextCursor ? (readCachedMemberships(groupId)?.items ?? []) : []
        const items = [...previous, ...page.items]
        writeCachedMemberships(groupId, { items, nextCursor: page.next_cursor })
        setMembers(items)
        setCursor(page.next_cursor)
      } catch (caught) {
        if (generation.current !== ticket) {
          return
        }
        if (isApiError(caught) && caught.status === 401) {
          onUnauthorized()
          return
        }
        setMemberError(isApiError(caught) ? caught.message : 'Could not load memberships.')
      } finally {
        if (generation.current === ticket) {
          setMembersLoading(false)
        }
      }
    },
    [groupId, managementClient, onUnauthorized],
  )

  const canReadRoster = canManage || Boolean(group?.designation)

  useEffect(() => {
    if (!canReadRoster) {
      return
    }
    setAgents(null)
    setAssignedAgentsError(null)
    let cancelled = false
    void managementClient.listGroupAgents(groupId).then(
      (items) => {
        if (!cancelled) {
          setAgents(items)
        }
      },
      (caught: unknown) => {
        if (cancelled) {
          return
        }
        if (isApiError(caught) && caught.status === 401) {
          onUnauthorized()
          return
        }
        setAssignedAgentsError(isApiError(caught) ? caught.message : 'Could not load assigned agents.')
      },
    )
    return () => {
      cancelled = true
    }
  }, [canReadRoster, groupId, managementClient, onUnauthorized])

  useEffect(() => {
    if (readCachedGroup(groupId)) {
      setLoading(false)
    } else {
      void loadGroup()
    }
  }, [groupId, loadGroup])

  useEffect(() => {
    if (!canReadRoster) {
      return
    }
    if (readCachedMemberships(groupId)) {
      setMembersLoading(false)
    } else {
      void loadMembers()
    }
  }, [canReadRoster, groupId, loadMembers])

  useEffect(() => {
    if (!adding || !canManage) {
      return
    }
    let cancelled = false
    void (async () => {
      const items: DirectoryUser[] = []
      let cursor: string | undefined
      try {
        while (!cancelled) {
          const page = await managementClient.listUsers(undefined, cursor, {
            role: 'user',
            excludeGroupId: groupId,
          })
          items.push(...page.items)
          if (!page.next_cursor) {
            if (!cancelled) {
              setMemberChoices(items)
            }
            return
          }
          cursor = page.next_cursor
        }
      } catch (caught) {
        if (cancelled) {
          return
        }
        if (isApiError(caught) && caught.status === 401) {
          onUnauthorized()
          return
        }
        setMemberPickerError(isApiError(caught) ? caught.message : 'Could not load users.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [adding, canManage, groupId, managementClient, onUnauthorized])

  useEffect(() => {
    if (!addingAgent) {
      return
    }
    let cancelled = false
    void (async () => {
      const items: AgentRecord[] = []
      let cursor: string | undefined
      try {
        while (!cancelled) {
          const page = await managementClient.listAgents(cursor)
          items.push(...page.items)
          if (!page.next_cursor) {
            break
          }
          cursor = page.next_cursor
        }
        if (!cancelled) {
          setAgentChoices(items)
        }
      } catch (caught) {
        if (cancelled) {
          return
        }
        if (isApiError(caught) && caught.status === 401) {
          onUnauthorized()
          return
        }
        setAgentPickerError(isApiError(caught) ? caught.message : 'Could not load agents.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [addingAgent, managementClient, onUnauthorized])

  async function addMember() {
    if (!selectedPerson || saving || !canManage) {
      return
    }
    setSaving(true)
    setMemberPickerError(null)
    try {
      await managementClient.upsertMembership(groupId, {
        user_id: selectedPerson.user_id,
        designation,
      })
      setAdding(false)
      dropCachedMemberships(groupId)
      clearGroupsCache()
      await loadMembers()
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        onUnauthorized()
        return
      }
      setMemberPickerError(isApiError(caught) ? caught.message : 'Could not save membership.')
    } finally {
      setSaving(false)
    }
  }

  async function changeRole(member: GroupMembership, next: GroupDesignation) {
    if (!canManage || member.designation === next || saving) {
      return
    }
    setSaving(true)
    setMemberError(null)
    try {
      await managementClient.upsertMembership(groupId, {
        user_id: member.user_id,
        designation: next,
      })
      dropCachedMemberships(groupId)
      clearGroupsCache()
      await loadMembers()
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        onUnauthorized()
        return
      }
      setMemberError(isApiError(caught) ? caught.message : 'Could not update the group role.')
    } finally {
      setSaving(false)
    }
  }

  async function saveDetails() {
    if (!group || !canManage || saveState.kind === 'saving') {
      return
    }
    const name = (draftName ?? group.name).trim()
    const description = (draftDescription ?? group.description ?? '').trim()
    if (!name) {
      return
    }
    setSaveState({ kind: 'saving' })
    try {
      const updated = await managementClient.updateGroup(groupId, {
        name,
        description: description === '' ? null : description,
      })
      writeCachedGroup(updated)
      clearGroupsCache()
      setGroup(updated)
      setDraftName(null)
      setDraftDescription(null)
      setSaveState({ kind: 'saved' })
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        onUnauthorized()
        return
      }
      setSaveState({
        kind: 'error',
        message: isApiError(caught) ? caught.message : 'Could not save the group.',
      })
    }
  }

  async function addAgent() {
    if (!selectedAgentId || saving || !canManage) {
      return
    }
    setSaving(true)
    setAgentError(null)
    setAgentPickerError(null)
    let assigned = false
    try {
      await managementClient.assignGroupAgent(groupId, selectedAgentId)
      assigned = true
      dropCachedAccess(selectedAgentId)
      clearGroupsCache()
      setAddingAgent(false)
      setSelectedAgentId('')
      setAgentQuery('')
      const items = await managementClient.listGroupAgents(groupId)
      setAgents(items)
      await loadGroup()
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        onUnauthorized()
        return
      }
      const message = isApiError(caught) ? caught.message : 'Could not add the agent.'
      if (assigned) {
        setAgentError(message)
      } else {
        setAgentPickerError(message)
      }
    } finally {
      setSaving(false)
    }
  }

  async function unassignAgent(agentId: string) {
    if (!canManage || saving) {
      return
    }
    setSaving(true)
    setAgentError(null)
    try {
      await managementClient.unassignGroupAgent(groupId, agentId)
      dropCachedAccess(agentId)
      clearGroupsCache()
      setAgents(await managementClient.listGroupAgents(groupId))
      await loadGroup()
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        onUnauthorized()
        return
      }
      setAgentError(isApiError(caught) ? caught.message : 'Could not unassign the agent.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteGroup() {
    if (!canManage || deleteBusy) {
      return
    }
    setDeleteBusy(true)
    try {
      await managementClient.deleteGroup(groupId)
      clearGroupsCache()
      dropCachedMemberships(groupId)
      void navigate(GROUPS_PATH)
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        onUnauthorized()
        return
      }
      setError(isApiError(caught) ? caught.message : 'Could not delete the group.')
      setDeleting(false)
    } finally {
      setDeleteBusy(false)
    }
  }

  async function removeMember() {
    if (!pendingRemove || !canManage) {
      return
    }
    setSaving(true)
    setMemberError(null)
    try {
      await managementClient.deleteMembership(groupId, pendingRemove.user_id)
      setPendingRemove(null)
      dropCachedMemberships(groupId)
      clearGroupsCache()
      await loadMembers()
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        onUnauthorized()
        return
      }
      setMemberError(isApiError(caught) ? caught.message : 'Could not remove membership.')
    } finally {
      setSaving(false)
    }
  }

  if (loading && !group) {
    return (
      <PageFrame mobileTitle="Group">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
          <LoadingRows label="Loading" rows={4} />
        </div>
      </PageFrame>
    )
  }

  if (!group) {
    return (
      <PageFrame mobileTitle="Group">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-8 sm:px-8">
          <Link
            to={GROUPS_PATH}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Groups
          </Link>
          <Notice
            tone="error"
            title="Group not available"
            action={
              <Button type="button" size="sm" variant="outline" onClick={() => void loadGroup()}>
                Retry
              </Button>
            }
          >
            {error ?? 'Group not found'}
          </Notice>
        </div>
      </PageFrame>
    )
  }

  const personNeedle = personQuery.trim().toLowerCase()
  const memberIds = new Set(members.map((member) => member.user_id))
  const availableMembers = memberChoices?.filter(
    (person) =>
      person.role === 'user' &&
      !memberIds.has(person.user_id) &&
      [person.display_name, person.email, person.user_id].some(
        (value) => value?.toLowerCase().includes(personNeedle),
      ),
  )

  return (
    <PageFrame mobileTitle={group.name}>
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-5xl px-4 pt-5 pb-6 sm:px-8 sm:pt-6">
          <Link
            to={GROUPS_PATH}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Groups
          </Link>
          <div className="mt-4 flex items-start gap-4">
            <div
              className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary font-serif text-xl text-primary-foreground"
              aria-hidden
            >
              {groupInitials(group.name)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="font-serif text-3xl break-words sm:text-4xl">{group.name}</h1>
                {group.designation ? (
                  <Badge tone={designationTone(group.designation)}>
                    {group.designation === 'leader' ? 'Leader' : 'Member'}
                  </Badge>
                ) : canManage ? (
                  <Badge tone="info">Admin</Badge>
                ) : null}
              </div>
              {!canManage && group.description ? (
                <p className="mt-1 text-sm text-muted-foreground">{group.description}</p>
              ) : null}
            </div>
          </div>
          <dl className="mt-5 grid gap-4 sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Group ID
              </dt>
              <dd className="mt-1.5 max-w-sm">
                <CopyText value={group.id} label="group ID" />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Updated
              </dt>
              <dd className="mt-1.5 text-sm">{formatDateTime(group.updated_at)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Size
              </dt>
              <dd className="mt-1.5 text-sm">
                {group.member_count} member{group.member_count === 1 ? '' : 's'} · {group.agent_count} agent
                {group.agent_count === 1 ? '' : 's'}
              </dd>
            </div>
          </dl>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-8">
        {error ? <Notice tone="error">{error}</Notice> : null}

        {canManage ? (
          <SectionCard title="Group details">
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void saveDetails()
              }}
            >
              <TextField
                label="Group name"
                value={draftName ?? group.name}
                required
                disabled={saveState.kind === 'saving'}
                onChange={(value) => {
                  setDraftName(value)
                  setSaveState({ kind: 'idle' })
                }}
              />
              <TextArea
                label="Description"
                value={draftDescription ?? group.description ?? ''}
                rows={3}
                disabled={saveState.kind === 'saving'}
                onChange={(value) => {
                  setDraftDescription(value)
                  setSaveState({ kind: 'idle' })
                }}
              />
              {saveState.kind === 'error' ? <Notice tone="error">{saveState.message}</Notice> : null}
              <div className="flex items-center justify-end gap-3">
                <SaveStatus
                  state={saveState}
                  dirty={
                    (draftName ?? group.name) !== group.name ||
                    (draftDescription ?? group.description ?? '') !== (group.description ?? '')
                  }
                />
                <Button
                  type="submit"
                  disabled={
                    saveState.kind === 'saving' ||
                    !(draftName ?? group.name).trim() ||
                    ((draftName ?? group.name) === group.name &&
                      (draftDescription ?? group.description ?? '') === (group.description ?? ''))
                  }
                >
                  Save changes
                </Button>
              </div>
            </form>
          </SectionCard>
        ) : null}

        {canReadRoster ? (<>
        <SectionCard
          title="Group members"
          description="Leaders can edit Instruction Skills and knowledge references for agents they can access."
          aside={
            canManage ? (
              <Button type="button" size="sm" onClick={() => {
                setPersonQuery('')
                setSelectedPerson(null)
                setDesignation('member')
                setMemberChoices(null)
                setMemberPickerError(null)
                setAdding(true)
              }}>
                <Plus className="size-4" aria-hidden />
                Add member
              </Button>
            ) : null
          }
        >
          {memberError ? (
            <Notice tone="error" title="Member not updated">
              {memberError}
            </Notice>
          ) : null}

          {membersLoading && members.length === 0 ? (
            <LoadingRows label="Loading" rows={3} />
          ) : members.length === 0 && !memberError ? (
            <EmptyState title="No members">
              {canManage ? 'Add people from the company directory.' : undefined}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {members.map((member) => {
                const label = member.display_name || member.email || member.user_id
                return (
                  <li key={`${member.group_id}:${member.user_id}`} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {personInitials(member)}
                    </span>
                    <div className="min-w-0 flex-1">
                      {canManage ? (
                        <Link to={userPath(member.user_id, 'access')} className="font-medium hover:underline">
                          {label}
                        </Link>
                      ) : (
                        <span className="font-medium">{label}</span>
                      )}
                      {member.email ? (
                        <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                      ) : null}
                    </div>
                    {canManage ? (
                      <select
                        aria-label={`Group role for ${label}`}
                        className="h-8 rounded-lg border border-border-strong bg-card px-2 text-sm"
                        value={member.designation}
                        disabled={saving}
                        onChange={(event) => {
                          const value = event.target.value
                          if (value === 'member' || value === 'leader') {
                            void changeRole(member, value)
                          }
                        }}
                      >
                        <option value="member">Member</option>
                        <option value="leader">Leader</option>
                      </select>
                    ) : (
                      <Badge tone={designationTone(member.designation)}>
                        {member.designation === 'leader' ? 'Leader' : 'Member'}
                      </Badge>
                    )}
                    {canManage ? (
                      <IconButton label={`Remove ${label}`} onClick={() => setPendingRemove(member)}>
                        <Trash2 className="size-4" aria-hidden />
                      </IconButton>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
          {cursor ? (
            <Button type="button" variant="outline" className="mt-3" onClick={() => void loadMembers(cursor)}>
              Load more members
            </Button>
          ) : null}
        </SectionCard>

        <SectionCard
          title="Assigned agents"
          description="Members can use the agents assigned to this group."
          aside={
            canManage ? (
              <Button
                type="button"
                size="sm"
                disabled={agents === null}
                onClick={() => {
                  setAgentError(null)
                  setAgentPickerError(null)
                  setAgentChoices(null)
                  setAgentQuery('')
                  setAddingAgent(true)
                }}
              >
                <Plus className="size-4" aria-hidden />
                Add agent
              </Button>
            ) : null
          }
        >
          {agentError ? (
            <Notice tone="error" title="Agent not updated">
              {agentError}
            </Notice>
          ) : null}
          {assignedAgentsError ? (
            <Notice tone="error" title="Could not load assigned agents">
              {assignedAgentsError}
            </Notice>
          ) : agents === null ? (
            <LoadingRows label="Loading assigned agents" rows={2} />
          ) : agents.length === 0 ? (
            <EmptyState title="No agents assigned">
              {canManage ? 'Add an agent to give members access.' : undefined}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {agents.map((agent) => (
                <li key={agent.agent_id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{agent.agent_name ?? agent.agent_id}</p>
                    <p className="font-mono text-xs text-muted-foreground">{agent.agent_id}</p>
                    <p className="mt-1">
                      <Badge tone={agent.is_owning ? 'primary' : 'neutral'}>
                        {agent.is_owning ? 'Managing group' : 'Access only'}
                      </Badge>
                    </p>
                  </div>
                  {canManage || group.designation === 'leader' ? (
                    <Link
                      to={settingsPath(agent.agent_id, 'configuration')}
                      className="inline-flex h-8 items-center rounded-full border border-border-strong px-3 text-xs font-medium hover:bg-muted"
                    >
                      Configuration
                    </Link>
                  ) : null}
                  {canManage ? (
                    <>
                      <Link
                        to={settingsPath(agent.agent_id, 'access')}
                        className="inline-flex h-8 items-center rounded-full border border-border-strong px-3 text-xs font-medium hover:bg-muted"
                      >
                        Access
                      </Link>
                      <IconButton label={`Unassign ${agent.agent_id}`} onClick={() => void unassignAgent(agent.agent_id)}>
                        <Trash2 className="size-4" aria-hidden />
                      </IconButton>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        </>) : null}

        {canManage ? (
          <DangerZone
            title="Delete this group"
            description="Deleting this group removes memberships, leadership, and Agent assignments."
            action={
              <Button type="button" variant="danger-outline" onClick={() => setDeleting(true)}>
                Delete group…
              </Button>
            }
          />
        ) : null}

        <ConfirmDialog
          open={adding}
          title="Add member"
          confirmLabel={saving ? 'Adding…' : 'Add member'}
          busy={saving}
          confirmDisabled={!selectedPerson}
          onCancel={() => {
            if (!saving) {
              setAdding(false)
            }
          }}
          onConfirm={() => void addMember()}
        >
          <div className="space-y-3">
            <TextField
              label="Search people"
              value={personQuery}
              placeholder="Name or email"
              onChange={(value) => {
                setPersonQuery(value)
                setSelectedPerson(null)
              }}
            />
            {memberPickerError ? <Notice tone="error">{memberPickerError}</Notice> : null}
            {availableMembers === undefined ? (
              memberPickerError ? null : <LoadingRows label="Loading users" rows={2} />
            ) : availableMembers.length > 0 ? (
              <fieldset className="max-h-60 space-y-2 overflow-y-auto">
                <legend className="sr-only">Choose a person</legend>
                {availableMembers.map((person) => (
                  <label
                    key={person.user_id}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2.5 hover:bg-muted"
                  >
                    <input
                      type="radio"
                      name="add-member"
                      checked={selectedPerson?.user_id === person.user_id}
                      onChange={() => setSelectedPerson(person)}
                      className="size-4 shrink-0 accent-primary"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        {person.display_name || person.email || person.user_id}
                      </span>
                      {person.email && person.display_name ? (
                        <span className="block text-xs text-muted-foreground">{person.email}</span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : (
              <p className="rounded-xl bg-muted px-3 py-2.5 text-sm text-muted-foreground">
                {personNeedle ? 'No available users match your search.' : 'There are no more users to add.'}
              </p>
            )}
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Group role</span>
              <select
                aria-label="Group role"
                className="h-10 w-full rounded-xl border border-border-strong bg-card px-3 text-sm"
                value={designation}
                onChange={(event) => {
                  const value = event.target.value
                  if (value === 'member' || value === 'leader') {
                    setDesignation(value)
                  }
                }}
              >
                <option value="member">Member</option>
                <option value="leader">Leader</option>
              </select>
            </label>
          </div>
        </ConfirmDialog>
      </div>

      <ConfirmDialog
        open={addingAgent}
        title="Add agent"
        confirmLabel={saving ? 'Adding…' : 'Add agent'}
        busy={saving}
        confirmDisabled={!selectedAgentId}
        onCancel={() => {
          if (!saving) {
            setAddingAgent(false)
            setSelectedAgentId('')
          }
        }}
        onConfirm={() => void addAgent()}
      >
        <div className="space-y-3">
          <TextField
            label="Search agents"
            value={agentQuery}
            placeholder="Name or agent ID"
            onChange={(value) => {
              setAgentQuery(value)
              setSelectedAgentId('')
            }}
          />
          {agentPickerError ? <Notice tone="error">{agentPickerError}</Notice> : null}
          {agentChoices === null ? (
            agentPickerError ? null : <LoadingRows label="Loading agents" rows={2} />
          ) : (() => {
            const needle = agentQuery.trim().toLowerCase()
            const taken = new Set(agents?.map((agent) => agent.agent_id))
            const results = agentChoices.filter(
              (agent) =>
                !taken.has(agent.id) &&
                (!needle ||
                  agent.name.toLowerCase().includes(needle) ||
                  agent.id.toLowerCase().includes(needle)),
            )
            if (results.length === 0) {
              return (
                <p className="rounded-xl bg-muted px-3 py-2.5 text-sm text-muted-foreground">
                  {needle ? 'No available results match your search.' : 'There are no more agents to add.'}
                </p>
              )
            }
            return (
              <fieldset className="max-h-60 space-y-2 overflow-y-auto">
                <legend className="sr-only">Choose an agent</legend>
                {results.map((agent) => (
                  <label
                    key={agent.id}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2.5 hover:bg-muted"
                  >
                    <input
                      type="radio"
                      name="add-agent"
                      checked={selectedAgentId === agent.id}
                      onChange={() => setSelectedAgentId(agent.id)}
                      className="size-4 shrink-0 accent-primary"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{agent.name}</span>
                      <span className="block font-mono text-xs text-muted-foreground">{agent.id}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )
          })()}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={deleting}
        title="Delete this group?"
        confirmLabel="Delete group"
        tone="danger"
        busy={deleteBusy}
        onCancel={() => setDeleting(false)}
        onConfirm={() => void deleteGroup()}
      >
        Memberships and assignments for <span className="font-medium">{group.name}</span> will be removed.
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingRemove !== null}
        title="Remove member?"
        confirmLabel="Remove"
        tone="danger"
        busy={saving}
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => void removeMember()}
      >
        Remove {pendingRemove?.display_name || pendingRemove?.email || pendingRemove?.user_id} from this group?
      </ConfirmDialog>
    </PageFrame>
  )
}
