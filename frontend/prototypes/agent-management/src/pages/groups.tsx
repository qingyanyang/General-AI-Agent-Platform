/** PROTOTYPE groups: members view their groups, and admins manage memberships and assignments. */
import { ArrowLeft, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { isApiError } from '@/lib/errors'

import { formatDateTime } from '../format'
import { usePermissions, useUnsaved } from '../hooks'
import { mockClient } from '../mock/client'
import { formatGroupIdentity } from '../mock/effective-access'
import { mockUsersApi } from '../mock/users-api'
import type { DirectoryUser, GroupIdentity, UserGroup } from '../mock/users-data'
import { GROUPS_PATH, groupPath, settingsPath, userPath } from '../routes'
import { PageFrame } from '../shell'
import {
  AddButton,
  Badge,
  Button,
  ConfirmDialog,
  CopyText,
  DangerZone,
  EmptyState,
  FormDialog,
  IconButton,
  InlineFormActions,
  LoadingRows,
  Notice,
  SectionCard,
  TextArea,
  TextField,
  type SaveState,
} from '../ui'
import { userPrimaryLabel, userSecondaryLabel } from '../user-label'

function identityBadgeTone(identity: GroupIdentity | 'Admin'): 'primary' | 'info' | 'neutral' {
  switch (identity) {
    case 'Leader':
      return 'primary'
    case 'Admin':
      return 'info'
    case 'Member':
      return 'neutral'
    default: {
      const unreachable: never = identity
      return unreachable
    }
  }
}

function IdentityBadge({
  label,
  identity,
}: {
  label: string
  identity: GroupIdentity | 'Admin'
}) {
  return <Badge tone={identityBadgeTone(identity)}>{label}</Badge>
}

function groupInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  const letters = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '')
  return letters.join('') || 'G'
}

type GroupDraft = { name: string; description: string }
type GroupItemKind = 'member' | 'agent'
type GroupItemOption = { id: string; title: string; detail?: string }
type Page<T> = { items: T[]; next_cursor: string | null }

async function loadAllPages<T>(loadPage: (cursor?: string) => Promise<Page<T>>): Promise<T[]> {
  const items: T[] = []
  let cursor: string | undefined
  do {
    const page = await loadPage(cursor)
    items.push(...page.items)
    cursor = page.next_cursor ?? undefined
  } while (cursor)
  return items
}

function GroupFields({
  draft,
  onChange,
  disabled,
}: {
  draft: GroupDraft
  onChange: (draft: GroupDraft) => void
  disabled?: boolean
}) {
  return (
    <fieldset className="space-y-4" disabled={disabled}>
      <TextField
        label="Group name"
        value={draft.name}
        onChange={(name) => onChange({ ...draft, name })}
        required
      />
      <TextArea
        label="Description"
        value={draft.description}
        onChange={(description) => onChange({ ...draft, description })}
        rows={3}
      />
    </fieldset>
  )
}

function AddGroupDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (group: UserGroup) => void
}) {
  const [draft, setDraft] = useState<GroupDraft>({ name: '', description: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = draft.name.trim()
    if (busy || !name) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const group = await mockUsersApi.createGroup({ name, description: draft.description.trim() || null })
      onCreated(group)
    } catch (caught) {
      setError(isApiError(caught) ? caught.message : 'Could not add the group.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormDialog
      open
      title="Add group"
      onClose={onClose}
      onSubmit={(event) => void submit(event)}
      submitLabel="Add group"
      busy={busy}
      pendingLabel="Adding…"
      disabled={!draft.name.trim()}
      dirty={Boolean(draft.name || draft.description)}
      error={error}
    >
      <GroupFields draft={draft} onChange={setDraft} />
    </FormDialog>
  )
}

function AddGroupItemDialog({
  kind,
  groupId,
  existingIds,
  onClose,
  onAdded,
}: {
  kind: GroupItemKind
  groupId: string
  existingIds: ReadonlySet<string>
  onClose: () => void
  onAdded: () => Promise<void>
}) {
  const fieldName = useId()
  const isMember = kind === 'member'
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [options, setOptions] = useState<GroupItemOption[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const peopleQuery = isMember ? query.trim() : ''

  useEffect(() => {
    let active = true
    const getOptions = async (): Promise<GroupItemOption[]> => {
      if (isMember) {
        const people = await mockUsersApi.searchPeople(peopleQuery)
        return people.map((person) => ({
          id: person.id,
          title: userPrimaryLabel(person),
          detail: userSecondaryLabel(person) ?? undefined,
        }))
      }
      const agents = await loadAllPages((cursor) => mockClient.listAgents('all', cursor))
      return agents.map((agent) => ({ id: agent.id, title: agent.name, detail: agent.id }))
    }
    setLoading(true)
    setLoadError(null)
    const timer = window.setTimeout(() => {
      void getOptions()
        .then((results) => {
          if (active) {
            setOptions(results)
          }
        })
        .catch((caught: unknown) => {
          if (active) {
            setOptions([])
            setLoadError(isApiError(caught) ? caught.message : 'Could not load results.')
          }
        })
        .finally(() => {
          if (active) {
            setLoading(false)
          }
        })
    }, peopleQuery ? 200 : 0)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [isMember, peopleQuery])

  const needle = query.trim().toLowerCase()
  const results = options.filter(
    (option) =>
      !existingIds.has(option.id) &&
      (isMember ||
        !needle ||
        option.title.toLowerCase().includes(needle) ||
        option.id.toLowerCase().includes(needle)),
  )
  const canSubmit = !loading && results.some((option) => option.id === selected)
  const label = isMember ? 'Add member' : 'Add agent'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !canSubmit) {
      return
    }
    setBusy(true)
    setSubmitError(null)
    try {
      if (isMember) {
        await mockUsersApi.addGroupMember(groupId, selected)
      } else {
        await mockUsersApi.assignGroupAgent(groupId, selected)
      }
      await onAdded()
    } catch (caught) {
      setSubmitError(isApiError(caught) ? caught.message : `Could not add the ${kind}.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormDialog
      open
      title={label}
      onClose={onClose}
      onSubmit={(event) => void submit(event)}
      submitLabel={label}
      pendingLabel="Adding…"
      busy={busy}
      disabled={!canSubmit}
      error={submitError ?? loadError}
    >
      <TextField
        label={isMember ? 'Search people' : 'Search agents'}
        value={query}
        placeholder={isMember ? 'Name or email' : 'Name or agent ID'}
        onChange={(nextQuery) => {
          setQuery(nextQuery)
          setSelected('')
          setSubmitError(null)
        }}
      />
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">Loading results…</p>
      ) : results.length > 0 ? (
        <fieldset className="max-h-60 space-y-2 overflow-y-auto p-1">
          <legend className="sr-only">{isMember ? 'Choose a person' : 'Choose an agent'}</legend>
          {results.map((option) => (
            <label
              key={option.id}
              className="flex cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2.5 hover:bg-muted has-checked:border-primary/35 has-checked:bg-primary-soft"
            >
              <input
                type="radio"
                name={fieldName}
                checked={selected === option.id}
                onChange={() => {
                  setSelected(option.id)
                  setSubmitError(null)
                }}
                className="size-4 shrink-0 accent-primary"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium break-words">{option.title}</span>
                {option.detail ? (
                  <span className="block text-xs break-words text-muted-foreground">{option.detail}</span>
                ) : null}
              </span>
            </label>
          ))}
        </fieldset>
      ) : !loadError ? (
        <p role="status" className="rounded-xl bg-muted px-3 py-2.5 text-sm text-muted-foreground">
          {needle
            ? 'No available results match your search.'
            : isMember
              ? 'Search by name or email to find someone to add.'
              : 'There are no more agents to add.'}
        </p>
      ) : null}
    </FormDialog>
  )
}

type GroupLeader = { user_id: string; display_name: string | null; avatar_initials?: string }
type GroupRow = UserGroup & {
  member_count: number
  agent_count: number
  leaders: GroupLeader[]
  owned_agents: Array<{ agent_id: string; agent_name: string | null }>
  viewer_identity: GroupIdentity | null
}

export function GroupsPage() {
  const { canManageAccess, canBrowsePeople } = usePermissions()
  const navigate = useNavigate()
  const [items, setItems] = useState<GroupRow[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const ticket = useRef(0)

  const reload = () => {
    const current = ++ticket.current
    setLoading(true)
    setError(null)
    mockUsersApi
      .listGroups()
      .then((page) => {
        if (ticket.current !== current) {
          return
        }
        setItems(page.items)
        setCursor(page.next_cursor)
      })
      .catch((caught: unknown) => {
        if (ticket.current === current) {
          setError(isApiError(caught) ? caught.message : 'Could not load groups.')
        }
      })
      .finally(() => {
        if (ticket.current === current) {
          setLoading(false)
        }
      })
  }

  useEffect(() => {
    if (canManageAccess || canBrowsePeople) {
      reload()
    }
  }, [canManageAccess, canBrowsePeople])

  if (!canManageAccess && !canBrowsePeople) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
        <Notice tone="warning" title="Groups aren’t available">
          Groups aren’t available for this role.
        </Notice>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-8 sm:py-8">
      {canManageAccess ? (
        <div className="flex justify-end">
          <AddButton className="w-full sm:w-auto" onClick={() => setCreating(true)}>
            Add group
          </AddButton>
        </div>
      ) : null}

      {creating && canManageAccess ? (
        <AddGroupDialog
          onClose={() => setCreating(false)}
          onCreated={(group) => {
            setCreating(false)
            navigate(groupPath(group.id), { state: { skipUnsavedGuard: true } })
          }}
        />
      ) : null}

      {error ? (
        <Notice tone="error" title="Could not load groups">
          {error}
        </Notice>
      ) : null}

      {loading && items.length === 0 ? (
        <LoadingRows label="Loading" rows={3} />
      ) : items.length === 0 ? (
        <EmptyState title="No groups">
          {canManageAccess ? 'Add a group to organize people and agent access.' : 'You aren’t a member of any group yet.'}
        </EmptyState>
      ) : (
        <div className="max-w-full overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-max min-w-full text-left text-sm whitespace-nowrap">
            <thead className="border-b border-border text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Group</th>
                <th className="px-4 py-3 font-medium">Your identity</th>
                <th className="px-4 py-3 font-medium">Members</th>
                <th className="px-4 py-3 font-medium">Agents</th>
              </tr>
            </thead>
            <tbody>
              {items.map((group) => (
                <tr key={group.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <Link to={groupPath(group.id)} className="font-medium hover:underline">
                      {group.name}
                    </Link>
                    {group.description ? (
                      <p className="mt-0.5 max-w-sm text-xs whitespace-normal text-muted-foreground">
                        {group.description}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {group.viewer_identity ? (
                      <IdentityBadge
                        label={formatGroupIdentity(group.name, group.viewer_identity)}
                        identity={group.viewer_identity}
                      />
                    ) : canManageAccess ? (
                      <IdentityBadge label="Admin" identity="Admin" />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{group.member_count}</td>
                  <td className="px-4 py-3 text-muted-foreground">{group.agent_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cursor ? (
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => {
            void mockUsersApi.listGroups(cursor).then((page) => {
              setItems((current) => [...current, ...page.items])
              setCursor(page.next_cursor)
            })
          }}
        >
          {loading ? 'Loading…' : 'Load more groups'}
        </Button>
      ) : null}
    </div>
  )
}

export function GroupDetailPage() {
  const { groupId = '' } = useParams<{ groupId: string }>()
  const decoded = decodeURIComponent(groupId)
  return <GroupDetail key={decoded} decoded={decoded} />
}

function GroupDetail({ decoded }: { decoded: string }) {
  const {
    persona,
    canManageAccess,
    canBrowsePeople,
    canOpenUserDetails,
  } = usePermissions()
  const navigate = useNavigate()
  const [group, setGroup] = useState<GroupRow | null>(null)
  const [members, setMembers] = useState<DirectoryUser[]>([])
  const [agents, setAgents] = useState<
    Array<{ agent_id: string; agent_name: string | null; is_owning: boolean }>
  >([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detailsDraft, setDetailsDraft] = useState<GroupDraft | null>(null)
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' })
  const [adding, setAdding] = useState<GroupItemKind | null>(null)
  const [memberError, setMemberError] = useState<string | null>(null)
  const [pendingLeader, setPendingLeader] = useState<null | { kind: 'demote' | 'remove'; userId: string; name: string }>(null)
  const [agentError, setAgentError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const ticket = useRef(0)
  const draft = detailsDraft ?? { name: group?.name ?? '', description: group?.description ?? '' }
  const dirty = group !== null && (draft.name !== group.name || draft.description !== (group.description ?? ''))
  const saveBusy = saveState.kind === 'saving'
  useUnsaved('Group details', canManageAccess && dirty)

  const reload = () => {
    const current = ++ticket.current
    setError(null)
    return Promise.all([
      mockUsersApi.getGroup(decoded),
      loadAllPages((cursor) => mockUsersApi.listGroupMembers(decoded, cursor)),
      loadAllPages((cursor) => mockUsersApi.listGroupAgents(decoded, cursor)),
    ])
      .then(([nextGroup, nextMembers, nextAgents]) => {
        if (ticket.current !== current) {
          return
        }
        setGroup(nextGroup)
        setMembers(nextMembers)
        setAgents(nextAgents)
      })
      .catch((caught: unknown) => {
        if (ticket.current === current) {
          setError(isApiError(caught) ? caught.message : 'Could not load this group.')
        }
      })
      .finally(() => {
        if (ticket.current === current) {
          setLoading(false)
        }
      })
  }

  useEffect(() => {
    if (canManageAccess || canBrowsePeople) {
      void reload()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoded, canManageAccess, canBrowsePeople, persona.userId])

  if (!canManageAccess && !canBrowsePeople) {
    return (
      <PageFrame mobileTitle="Group">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
          <Notice tone="warning" title="Groups aren’t available">
            Groups aren’t available for this role.
          </Notice>
        </div>
      </PageFrame>
    )
  }

  if (loading) {
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
          <Link to={GROUPS_PATH} className="text-sm text-muted-foreground hover:text-foreground">
            ← Groups
          </Link>
          <Notice tone="error" title="Group not available">
            {error ?? 'Group not found'}
          </Notice>
        </div>
      </PageFrame>
    )
  }

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = draft.name.trim()
    if (!canManageAccess || !dirty || saveBusy || !name) {
      return
    }
    setSaveState({ kind: 'saving' })
    try {
      const updated = await mockUsersApi.updateGroup(decoded, { name, description: draft.description.trim() || null })
      setGroup((current) => (current ? { ...current, ...updated } : current))
      setDetailsDraft(null)
      setSaveState({ kind: 'saved' })
      void reload()
    } catch (caught) {
      setSaveState({ kind: 'error', message: isApiError(caught) ? caught.message : 'Could not save the group.' })
    }
  }

  const memberName = (member: DirectoryUser) => {
    const label = userPrimaryLabel(member)
    if (canOpenUserDetails) {
      return (
        <Link to={userPath(member.id, 'access')} className="font-medium hover:underline">
          {label}
        </Link>
      )
    }
    return <span className="font-medium">{label}</span>
  }

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
                {group.viewer_identity ? (
                  <IdentityBadge
                    label={formatGroupIdentity(group.name, group.viewer_identity)}
                    identity={group.viewer_identity}
                  />
                ) : canManageAccess ? (
                  <IdentityBadge label="Admin" identity="Admin" />
                ) : null}
              </div>
              {!canManageAccess && group.description ? (
                <p className="mt-1 text-sm text-muted-foreground">{group.description}</p>
              ) : null}
            </div>
          </div>
          <dl className="mt-5 grid gap-4 sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Group ID</dt>
              <dd className="mt-1.5 max-w-sm">
                <CopyText value={group.id} label="group ID" />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Updated</dt>
              <dd className="mt-1.5 text-sm">{formatDateTime(group.updated_at)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Size</dt>
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

        {canManageAccess ? (
          <SectionCard title="Group details">
            <form className="space-y-4" onSubmit={(event) => void saveDetails(event)}>
              <GroupFields
                draft={draft}
                disabled={saveBusy}
                onChange={(nextDraft) => {
                  setDetailsDraft(nextDraft)
                  setSaveState({ kind: 'idle' })
                }}
              />
              <InlineFormActions
                dirty={dirty}
                state={saveState}
                disabled={!draft.name.trim()}
                onCancel={() => {
                  setDetailsDraft(null)
                  setSaveState({ kind: 'idle' })
                }}
              />
            </form>
          </SectionCard>
        ) : null}

        <SectionCard
          title="Group members"
          description="Leaders can edit Instruction Skills for agents this group manages."
          aside={
            canManageAccess ? (
              <AddButton
                size="sm"
                onClick={() => {
                  setMemberError(null)
                  setAdding('member')
                }}
              >
                Add member
              </AddButton>
            ) : null
          }
        >
          {memberError ? (
            <Notice tone="error" title="Member not updated">
              {memberError}
            </Notice>
          ) : null}
          {members.length === 0 ? (
            <EmptyState title="No members">
              {canManageAccess ? 'Add people from the company directory.' : undefined}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {members.map((member) => {
                const email = member.email ?? userSecondaryLabel(member)
                const memberIsLeader = group.leaders.some((leader) => leader.user_id === member.id)
                const onlyLeader = memberIsLeader && group.leaders.length === 1
                const label = userPrimaryLabel(member)
                const changeRole = (next: 'member' | 'leader') => {
                  if (next === 'leader' && !memberIsLeader) {
                    setMemberError(null)
                    void mockUsersApi
                      .setGroupLeader(decoded, member.id)
                      .then(reload)
                      .catch((caught: unknown) => {
                        setMemberError(isApiError(caught) ? caught.message : 'Could not update the group role.')
                      })
                    return
                  }
                  if (next === 'member' && memberIsLeader) {
                    if (onlyLeader) {
                      setPendingLeader({ kind: 'demote', userId: member.id, name: label })
                      return
                    }
                    setMemberError(null)
                    void mockUsersApi
                      .removeGroupLeader(decoded, member.id)
                      .then(reload)
                      .catch((caught: unknown) => {
                        setMemberError(isApiError(caught) ? caught.message : 'Could not update the group role.')
                      })
                  }
                }
                const removeMember = () => {
                  if (onlyLeader) {
                    setPendingLeader({ kind: 'remove', userId: member.id, name: label })
                    return
                  }
                  setMemberError(null)
                  void mockUsersApi
                    .removeGroupMember(decoded, member.id)
                    .then(reload)
                    .catch((caught: unknown) => {
                      setMemberError(isApiError(caught) ? caught.message : 'Could not remove the member.')
                    })
                }
                return (
                  <li key={member.id} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {member.avatar_initials}
                    </span>
                    <div className="min-w-0 flex-1">
                      {memberName(member)}
                      {email ? <p className="truncate text-xs text-muted-foreground">{email}</p> : null}
                    </div>
                    {canManageAccess ? (
                      <select
                        aria-label={`Group role for ${label}`}
                        className="h-8 rounded-lg border border-border-strong bg-card px-2 text-sm"
                        value={memberIsLeader ? 'leader' : 'member'}
                        onChange={(event) => changeRole(event.target.value === 'leader' ? 'leader' : 'member')}
                      >
                        <option value="member">Member</option>
                        <option value="leader">Leader</option>
                      </select>
                    ) : (
                      <IdentityBadge
                        label={memberIsLeader ? 'Leader' : 'Member'}
                        identity={memberIsLeader ? 'Leader' : 'Member'}
                      />
                    )}
                    {canManageAccess ? (
                      <IconButton label={`Remove ${label}`} onClick={removeMember}>
                        <Trash2 className="size-4" aria-hidden />
                      </IconButton>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
          <ConfirmDialog
            open={pendingLeader !== null}
            title={pendingLeader?.kind === 'remove' ? 'Remove the only Leader?' : 'Change the only Leader to Member?'}
            confirmLabel={pendingLeader?.kind === 'remove' ? 'Remove' : 'Make Member'}
            tone="danger"
            onCancel={() => setPendingLeader(null)}
            onConfirm={() => {
              if (!pendingLeader) {
                return
              }
              const action =
                pendingLeader.kind === 'remove'
                  ? mockUsersApi.removeGroupMember(decoded, pendingLeader.userId)
                  : mockUsersApi.removeGroupLeader(decoded, pendingLeader.userId)
              setMemberError(null)
              void action
                .then(() => {
                  setPendingLeader(null)
                  reload()
                })
                .catch((caught: unknown) => {
                  setPendingLeader(null)
                  setMemberError(isApiError(caught) ? caught.message : 'Could not update the member.')
                })
            }}
          >
            {pendingLeader?.name} is the only Leader in this group. The group can continue with no Leader. Other groups are unchanged.
          </ConfirmDialog>
        </SectionCard>

        <SectionCard
          title="Assigned agents"
          description="Members can use the agents assigned to this group."
          aside={
            canManageAccess ? (
              <AddButton
                size="sm"
                onClick={() => {
                  setAgentError(null)
                  setAdding('agent')
                }}
              >
                Add agent
              </AddButton>
            ) : null
          }
        >
          {agentError ? (
            <Notice tone="error" title="Agent not updated">
              {agentError}
            </Notice>
          ) : null}
          {agents.length === 0 ? (
            <EmptyState title="No agents assigned">
              {canManageAccess ? 'Add an agent to give members access.' : undefined}
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
                  {canManageAccess ? (
                    <>
                      <Link
                        to={settingsPath(agent.agent_id, 'access')}
                        className="inline-flex h-8 items-center rounded-full border border-border-strong px-3 text-xs font-medium hover:bg-muted"
                      >
                        Access
                      </Link>
                      <IconButton
                        label={`Unassign ${agent.agent_id}`}
                        onClick={() => {
                          void mockUsersApi
                            .unassignGroupAgent(decoded, agent.agent_id)
                            .then(reload)
                            .catch((caught: unknown) => {
                              setAgentError(isApiError(caught) ? caught.message : 'Could not unassign the agent.')
                            })
                        }}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </IconButton>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {canManageAccess && adding ? (
          <AddGroupItemDialog
            kind={adding}
            groupId={decoded}
            existingIds={new Set(
              adding === 'member' ? members.map((member) => member.id) : agents.map((agent) => agent.agent_id),
            )}
            onClose={() => setAdding(null)}
            onAdded={async () => {
              await reload()
              setAdding(null)
            }}
          />
        ) : null}

        {canManageAccess ? (
          <DangerZone
            title="Delete this group"
            description="Deleting this group removes memberships, leadership, and Agent assignments."
            action={
              <Button variant="danger-outline" onClick={() => setDeleting(true)}>
                Delete group…
              </Button>
            }
          />
        ) : null}

        <ConfirmDialog
          open={deleting}
          title="Delete this group?"
          confirmLabel="Delete group"
          tone="danger"
          busy={deleteBusy}
          onCancel={() => setDeleting(false)}
          onConfirm={() => {
            setDeleteBusy(true)
            void mockUsersApi
              .deleteGroup(decoded)
              .then(() => {
                setDeleting(false)
                setDetailsDraft(null)
                navigate(GROUPS_PATH, { state: { skipUnsavedGuard: true } })
              })
              .catch((caught: unknown) => {
                setError(isApiError(caught) ? caught.message : 'Could not delete the group.')
                setDeleting(false)
              })
              .finally(() => setDeleteBusy(false))
          }}
        >
          Memberships and assignments for <span className="font-medium">{group.name}</span> will be removed.
        </ConfirmDialog>
      </div>
    </PageFrame>
  )
}
