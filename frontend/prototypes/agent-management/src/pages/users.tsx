/** PROTOTYPE user directory (#54): list, Access with sources, Usage with filters. */
import { Activity, ArrowLeft, Check, KeyRound, Minus, Search } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, NavLink, Navigate, useParams } from 'react-router-dom'

import { isApiError } from '@/lib/errors'
import { executionStatusLabel, isExecutionStatus } from '@/lib/execution-status'
import type { ExecutionRecord } from '@/lib/management'
import { cn } from '@/lib/utils'

import { formatDateTime, formatDuration } from '../format'
import { usePermissions, useUnsaved } from '../hooks'
import { mockUsersApi } from '../mock/users-api'
import type { RoleId } from '../mock/roles'
import type { DirectoryUser, EffectiveAgentAccess, UsageSummary, UserGroup } from '../mock/users-data'
import { USERS_PATH, groupPath, settingsPath, userPath, type UserSection } from '../routes'
import { PageFrame } from '../shell'
import { userPrimaryLabel, userSecondaryLabel } from '../user-label'
import {
  AddButton,
  Badge,
  Button,
  CopyText,
  EmptyState,
  ExecutionStatusBadge,
  FormDialog,
  LoadingRows,
  Notice,
  SelectField,
  TextField,
} from '../ui'

type AccountStatus = NonNullable<DirectoryUser['status']>

const ROLE_OPTIONS = [
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
  { value: 'super-admin', label: 'Super Admin' },
] as const

function RoleOptions({ superAdmin }: { superAdmin: boolean }) {
  return ROLE_OPTIONS.filter(({ value }) => superAdmin || value !== 'super-admin').map(({ value, label }) => (
    <option key={value} value={value}>
      {label}
    </option>
  ))
}

function accountStatus(user: DirectoryUser): AccountStatus {
  return user.status ?? 'active'
}

function statusLabel(status: AccountStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending'
    case 'active':
      return 'Active'
    case 'disabled':
      return 'Disabled'
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}
function roleBadgeTone(roleLabel: string): 'primary' | 'info' | 'neutral' {
  switch (roleLabel) {
    case 'Super Admin':
      return 'primary'
    case 'Admin':
      return 'info'
    default:
      return 'neutral'
  }
}

function RoleBadge({ label }: { label: string | null | undefined }) {
  if (!label) {
    return <span className="text-muted-foreground">—</span>
  }
  return <Badge tone={roleBadgeTone(label)}>{label}</Badge>
}

function Capability({ enabled, label }: { enabled: boolean; label: string }) {
  return enabled ? (
    <Badge tone="success">
      <Check className="size-3" aria-hidden />
      Yes
      <span className="sr-only"> {label}</span>
    </Badge>
  ) : (
    <Badge tone="neutral">
      <Minus className="size-3" aria-hidden />
      No
      <span className="sr-only"> {label}</span>
    </Badge>
  )
}

function sectionTab(section: UserSection): { label: string; icon: ReactNode } {
  switch (section) {
    case 'access':
      return { label: 'Access', icon: <KeyRound className="size-4" aria-hidden /> }
    case 'usage':
      return { label: 'Usage', icon: <Activity className="size-4" aria-hidden /> }
    default: {
      const unreachable: never = section
      return unreachable
    }
  }
}

function localDayBound(date: string, bound: 'start' | 'end'): string {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) {
    return ''
  }
  const value =
    bound === 'start'
      ? new Date(year, month - 1, day, 0, 0, 0, 0)
      : new Date(year, month - 1, day, 23, 59, 59, 999)
  return value.toISOString()
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-xl border border-border-strong bg-card px-3 text-sm text-foreground"
      />
    </div>
  )
}

function Sources({ sources }: { sources: EffectiveAgentAccess['sources'] }) {
  if (sources.length === 0) {
    return <span className="text-muted-foreground">—</span>
  }
  return (
    <ul className="space-y-1 text-sm text-muted-foreground">
      {sources.map((source) =>
        source.kind === 'company' ? (
          <li key="company">Everyone in the company</li>
        ) : (
          <li key={`group-${source.group_id}`}>
            <Link
              to={groupPath(source.group_id)}
              className="font-medium text-foreground underline-offset-2 hover:underline"
            >
              {source.group_name}
            </Link>
          </li>
        ),
      )}
    </ul>
  )
}

export function UsersPage() {
  const { canBrowsePeople, canOpenUserDetails, canManageAccess, role } = usePermissions()
  const canBrowseUsers = canBrowsePeople || canOpenUserDetails
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [items, setItems] = useState<DirectoryUser[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [invitedUser, setInvitedUser] = useState<DirectoryUser | null>(null)
  const [listVersion, setListVersion] = useState(0)
  const ticket = useRef(0)

  useEffect(() => {
    if (!canBrowseUsers) {
      return
    }
    const current = ++ticket.current
    setLoading(true)
    setError(null)
    mockUsersApi
      .listUsers(query)
      .then((page) => {
        if (ticket.current !== current) {
          return
        }
        setItems(page.items)
        setCursor(page.next_cursor)
      })
      .catch((caught: unknown) => {
        if (ticket.current === current) {
          setError(isApiError(caught) ? caught.message : 'Could not load users.')
        }
      })
      .finally(() => {
        if (ticket.current === current) {
          setLoading(false)
        }
      })
  }, [canBrowseUsers, query, listVersion])

  if (!canBrowseUsers) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
        <Notice tone="warning" title="Users aren’t available">
          Directory listing isn’t available for this role.
        </Notice>
      </div>
    )
  }

  const search = (event: FormEvent) => {
    event.preventDefault()
    setQuery(draft.trim())
  }

  const loadMore = async () => {
    if (!cursor || loading) {
      return
    }
    const current = ++ticket.current
    setLoading(true)
    try {
      const page = await mockUsersApi.listUsers(query, cursor)
      if (ticket.current === current) {
        setItems((previous) => [...previous, ...page.items])
        setCursor(page.next_cursor)
      }
    } catch (caught) {
      if (ticket.current === current) {
        setError(isApiError(caught) ? caught.message : 'Could not load more users.')
      }
    } finally {
      if (ticket.current === current) {
        setLoading(false)
      }
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-8 sm:py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <form onSubmit={search} className="flex items-end gap-2 sm:w-full sm:max-w-md">
          <div className="min-w-0 flex-1">
            <TextField
              label="Search users"
              value={draft}
              onChange={setDraft}
              placeholder="Name, email, or user ID"
            />
          </div>
          <Button type="submit" variant="outline">
            <Search className="size-4" aria-hidden />
            Search
          </Button>
        </form>
        {canManageAccess ? (
          <AddButton className="w-full sm:w-auto" aria-haspopup="dialog" onClick={() => setInviting(true)}>
            Add user
          </AddButton>
        ) : null}
      </div>
      {canManageAccess ? (
        <InviteUser
          open={inviting}
          role={role}
          onClose={() => setInviting(false)}
          onInvited={(user) => {
            setInviting(false)
            setInvitedUser(user)
            setListVersion((value) => value + 1)
          }}
        />
      ) : null}
      {invitedUser ? (
        <Notice tone="success" title="Invitation created">
          {invitedUser.email} was added as Pending.{' '}
          <Link
            to={userPath(invitedUser.id, 'access')}
            className="font-medium text-primary underline underline-offset-2"
          >
            View user
          </Link>
        </Notice>
      ) : null}

      {error ? (
        <Notice tone="error" title="Could not load users">
          {error}
        </Notice>
      ) : null}

      {loading && items.length === 0 ? (
        <LoadingRows label="Loading" rows={4} />
      ) : items.length === 0 ? (
        <EmptyState title="No users match">Try another search, or reset the mock data.</EmptyState>
      ) : (
        <div className="max-w-full overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-max min-w-full text-left text-sm whitespace-nowrap">
            <thead className="border-b border-border text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {items.map((user) => {
                const secondary = userSecondaryLabel(user)
                const name = userPrimaryLabel(user)
                return (
                  <tr key={user.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      {canOpenUserDetails ? (
                        <Link to={userPath(user.id, 'access')} className="font-medium text-foreground hover:underline">
                          {name}
                        </Link>
                      ) : (
                        <span className="font-medium text-foreground">{name}</span>
                      )}
                      {secondary ? (
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">{secondary}</p>
                      ) : null}
                      {!user.display_name && !user.email ? (
                        <p className="mt-1 text-xs whitespace-normal text-muted-foreground">
                          No verified name or email on file.
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge label={user.role_label} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={accountStatus(user) === 'disabled' ? 'danger' : accountStatus(user) === 'pending' ? 'warning' : 'success'}>
                        {statusLabel(accountStatus(user))}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDateTime(user.last_seen_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {cursor ? (
        <Button variant="outline" onClick={() => void loadMore()} disabled={loading}>
          {loading ? 'Loading…' : 'Load more users'}
        </Button>
      ) : null}
    </div>
  )
}

export function UserDetailPage() {
  const { userId = '', section } = useParams<{ userId: string; section?: string }>()
  const decoded = decodeURIComponent(userId)
  const { canOpenUserDetails, canReadAnyUsage } = usePermissions()
  const active: UserSection =
    section === 'usage' ? 'usage' : section === 'access' || !section ? 'access' : 'access'

  if (!canOpenUserDetails) {
    return <Navigate replace to={USERS_PATH} />
  }

  if (section === 'usage' && !canReadAnyUsage) {
    return (
      <PageFrame mobileTitle="Users">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
          <Notice tone="warning" title="Usage isn’t available">
            Cross-user usage inspection isn’t available for this role.
          </Notice>
          <p className="mt-4">
            <Link to={userPath(decoded, 'access')} className="text-sm font-medium underline-offset-2 hover:underline">
              Back to access
            </Link>
          </p>
        </div>
      </PageFrame>
    )
  }

  if (!section || (section !== 'access' && section !== 'usage')) {
    return <Navigate replace to={userPath(decoded, 'access')} />
  }

  return (
    <PageFrame mobileTitle="User">
      <UserDetailBody key={decoded} userId={decoded} section={active} />
    </PageFrame>
  )
}

function UserDetailBody({ userId, section }: { userId: string; section: UserSection }) {
  const { canReadAnyUsage, canManageAccess } = usePermissions()
  const canInspectUsage = canReadAnyUsage
  const [user, setUser] = useState<DirectoryUser | null>(null)
  const [groups, setGroups] = useState<UserGroup[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const ticket = useRef(0)

  useEffect(() => {
    const current = ++ticket.current
    setLoading(true)
    setError(null)
    Promise.all([mockUsersApi.getUser(userId), mockUsersApi.listUserGroups(userId).catch(() => [])])
      .then(([nextUser, nextGroups]) => {
        if (ticket.current !== current) {
          return
        }
        setUser(nextUser)
        setGroups(nextGroups)
      })
      .catch((caught: unknown) => {
        if (ticket.current === current) {
          setUser(null)
          setError(isApiError(caught) ? caught.message : 'Could not load this user.')
        }
      })
      .finally(() => {
        if (ticket.current === current) {
          setLoading(false)
        }
      })
  }, [userId])

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
        <LoadingRows label="Loading" rows={3} />
      </div>
    )
  }

  if (error || !user) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-8 sm:px-8">
        <Link to={USERS_PATH} className="text-sm text-muted-foreground hover:text-foreground">
          ← Users
        </Link>
        <Notice tone="error" title="User not available">
          {error ?? 'User not found'}
        </Notice>
      </div>
    )
  }

  const tabs: UserSection[] = canInspectUsage ? ['access', 'usage'] : ['access']

  return (
    <>
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-5xl px-4 pt-5 sm:px-8 sm:pt-6">
          <Link
            to={USERS_PATH}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Users
          </Link>
          <div className="mt-4 flex items-start gap-4">
            <div
              className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary font-serif text-xl text-primary-foreground"
              aria-hidden
            >
              {user.avatar_initials}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="font-serif text-3xl break-words sm:text-4xl">{userPrimaryLabel(user)}</h1>
                {user.role_label ? <RoleBadge label={user.role_label} /> : null}
                <Badge tone={accountStatus(user) === 'disabled' ? 'danger' : accountStatus(user) === 'pending' ? 'warning' : 'success'}>
                  {statusLabel(accountStatus(user))}
                </Badge>
              </div>
              {user.email ? <p className="mt-1 text-sm text-muted-foreground">{user.email}</p> : null}
            </div>
          </div>

          {!user.display_name && !user.email ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No verified name or email. The Auth0 user ID is shown as the fallback.
            </p>
          ) : null}

          <dl className="mt-5 grid gap-4 sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">User ID</dt>
              <dd className="mt-1.5 max-w-sm">
                <CopyText value={user.id} label="user ID" />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">First seen</dt>
              <dd className="mt-1.5 text-sm">{formatDateTime(user.first_seen_at)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Last seen</dt>
              <dd className="mt-1.5 text-sm">{formatDateTime(user.last_seen_at)}</dd>
            </div>
          </dl>

          <div className="mt-5">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Groups</p>
            {groups.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {groups.map((group) => (
                  <li key={group.id}>
                    <Link
                      to={groupPath(group.id)}
                      className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1 text-sm font-medium hover:border-primary/40 hover:bg-primary-soft hover:text-primary"
                    >
                      {group.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-sm text-muted-foreground">Not a member of any group.</p>
            )}
          </div>

          <nav aria-label="User sections" className="-mb-px mt-5 flex gap-1 overflow-x-auto">
            {tabs.map((tab) => {
              const meta = sectionTab(tab)
              return (
                <NavLink
                  key={tab}
                  to={userPath(userId, tab)}
                  aria-current={section === tab ? 'page' : undefined}
                  className={() =>
                    cn(
                      'inline-flex shrink-0 items-center gap-2 border-b-2 px-2.5 pt-2 pb-3 text-sm font-medium whitespace-nowrap sm:px-3',
                      section === tab
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )
                  }
                >
                  {meta.icon}
                  {meta.label}
                </NavLink>
              )
            })}
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-8">
        {section === 'access' ? (
          <UserAccessSection userId={userId} canManage={canManageAccess} />
        ) : (
          <UserUsageSection userId={userId} />
        )}
      </div>
    </>
  )
}

function UserAccessSection({ userId, canManage }: { userId: string; canManage: boolean }) {
  const [rows, setRows] = useState<EffectiveAgentAccess[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const ticket = useRef(0)

  const reload = () => {
    const current = ++ticket.current
    setLoading(true)
    setError(null)
    mockUsersApi
      .listUserEffectiveAccess(userId)
      .then((next) => {
        if (ticket.current !== current) {
          return
        }
        setRows(next)
      })
      .catch((caught: unknown) => {
        if (ticket.current === current) {
          setError(isApiError(caught) ? caught.message : 'Could not load access.')
        }
      })
      .finally(() => {
        if (ticket.current === current) {
          setLoading(false)
        }
      })
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when user changes
  }, [userId])

  return (
    <div className="space-y-4">
      <div>
        <h2 className="sr-only">Agent access</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Use comes from company-wide availability or group membership. Instruction Skills can be edited by a Leader of
          the agent’s managing group, and by Admin or Super Admin.
        </p>
      </div>
      {error ? (
        <Notice tone="error" title="Could not load access">
          {error}
        </Notice>
      ) : null}
      {loading && rows.length === 0 ? (
        <LoadingRows label="Loading access" rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState title="No Agent access">This user isn’t in any group assigned to an agent.</EmptyState>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <article key={row.agent_id} className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
                <div className="min-w-0">
                  <h3 className="font-medium">{row.agent_name ?? row.agent_id}</h3>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">{row.agent_id}</p>
                </div>
                {canManage ? (
                  <Link
                    to={settingsPath(row.agent_id, 'access')}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border-strong bg-card px-3 text-xs font-medium hover:bg-muted"
                  >
                    <KeyRound className="size-3.5" aria-hidden />
                    Manage groups
                  </Link>
                ) : null}
              </div>
              <dl className="grid border-t border-border sm:grid-cols-2">
                <div className="px-4 py-3 sm:px-5 sm:py-4">
                  <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Can use</dt>
                  <dd className="mt-2 space-y-2">
                    <Capability enabled={row.can_use} label="use" />
                    <Sources sources={row.sources} />
                  </dd>
                </div>
                <div className="border-t border-border px-4 py-3 sm:border-t-0 sm:border-l sm:px-5 sm:py-4">
                  <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Edit skills</dt>
                  <dd className="mt-2">
                    <Capability enabled={row.can_edit_prompt} label="edit skills" />
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

const USAGE_STATUSES = [
  '',
  'succeeded',
  'failed',
  'cancelled',
  'running',
  'awaiting_approval',
] as const

function UserUsageSection({ userId }: { userId: string }) {
  const [agentId, setAgentId] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [applied, setApplied] = useState({ agentId: '', status: '', from: '', to: '' })
  const [items, setItems] = useState<ExecutionRecord[]>([])
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ExecutionRecord | null>(null)
  const ticket = useRef(0)

  useEffect(() => {
    const current = ++ticket.current
    setLoading(true)
    setError(null)
    setSelected(null)
    mockUsersApi
      .listUserUsage(userId, {
        agentId: applied.agentId || undefined,
        status: applied.status || undefined,
        from: applied.from || undefined,
        to: applied.to || undefined,
      })
      .then((page) => {
        if (ticket.current !== current) {
          return
        }
        setItems(page.items)
        setCursor(page.next_cursor)
        setSummary(page.summary)
      })
      .catch((caught: unknown) => {
        if (ticket.current === current) {
          setError(isApiError(caught) ? caught.message : 'Could not load usage.')
        }
      })
      .finally(() => {
        if (ticket.current === current) {
          setLoading(false)
        }
      })
  }, [userId, applied])

  const loadMore = async () => {
    if (!cursor || loading) {
      return
    }
    setLoading(true)
    try {
      const page = await mockUsersApi.listUserUsage(userId, {
        agentId: applied.agentId || undefined,
        status: applied.status || undefined,
        from: applied.from || undefined,
        to: applied.to || undefined,
        cursor,
      })
      setItems((current) => [...current, ...page.items])
      setCursor(page.next_cursor)
      setSummary(page.summary)
    } catch (caught) {
      setError(isApiError(caught) ? caught.message : 'Could not load more usage.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="sr-only">Usage</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Execution metadata only. Conversation messages, prompts, and tool payloads are never returned.
        </p>
      </div>

      <form
        className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:p-5 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault()
          setApplied({
            agentId: agentId.trim(),
            status,
            from: from ? localDayBound(from, 'start') : '',
            to: to ? localDayBound(to, 'end') : '',
          })
        }}
      >
        <TextField
          label="Agent"
          value={agentId}
          onChange={setAgentId}
          mono
          placeholder="Agent ID"
          hint="Leave blank for every agent."
        />
        <SelectField label="Status" value={status} onChange={setStatus}>
          {USAGE_STATUSES.map((value) => (
            <option key={value || 'all'} value={value}>
              {value && isExecutionStatus(value) ? executionStatusLabel(value) : 'Any status'}
            </option>
          ))}
        </SelectField>
        <DateField label="From" value={from} onChange={setFrom} />
        <DateField label="To" value={to} onChange={setTo} />
        <div className="sm:col-span-2 lg:col-span-4">
          <Button type="submit">Apply filters</Button>
        </div>
      </form>

      {summary ? (
        <div className="flex flex-wrap items-center gap-2" role="status">
          <span className="text-sm text-muted-foreground">
            {summary.total} {summary.total === 1 ? 'execution' : 'executions'}
          </span>
          {Object.entries(summary.by_status).map(([key, count]) => (
            <ExecutionStatusBadge key={key} status={key} count={count} />
          ))}
        </div>
      ) : null}

      {error ? (
        <Notice tone="error" title="Could not load usage">
          {error}
        </Notice>
      ) : null}

      {loading && items.length === 0 ? (
        <LoadingRows label="Loading" rows={3} />
      ) : items.length === 0 ? (
        <EmptyState title="No executions">Nothing matches these filters for this user.</EmptyState>
      ) : (
        <div className="max-w-full overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-max min-w-full text-left text-sm whitespace-nowrap">
            <thead className="border-b border-border text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Started</th>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className={cn(
                    'border-b border-border last:border-0',
                    selected?.id === item.id && 'bg-primary-soft/60',
                  )}
                >
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="text-left font-medium hover:underline"
                      aria-pressed={selected?.id === item.id}
                      onClick={() => setSelected(item)}
                    >
                      {formatDateTime(item.started_at)}
                    </button>
                    <p className="font-mono text-[11px] text-muted-foreground">{item.id}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{item.agent_id}</td>
                  <td className="px-4 py-3">
                    <ExecutionStatusBadge status={item.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDuration(item.duration_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cursor ? (
        <Button variant="outline" onClick={() => void loadMore()} disabled={loading}>
          {loading ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}

      {selected ? (
        <section className="overflow-hidden rounded-2xl border border-border bg-card" aria-label="Execution detail">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">Execution</h3>
              <ExecutionStatusBadge status={selected.status} />
            </div>
            <Button variant="outline" size="sm" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>
          <dl className="grid gap-4 px-4 py-4 text-sm sm:grid-cols-2 sm:px-5">
            <div className="min-w-0 sm:col-span-2">
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Execution ID</dt>
              <dd className="mt-1.5 max-w-md">
                <CopyText value={selected.id} label="execution ID" />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Agent</dt>
              <dd className="mt-1.5 font-mono text-xs">{selected.agent_id}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Duration</dt>
              <dd className="mt-1.5">{formatDuration(selected.duration_ms)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Started</dt>
              <dd className="mt-1.5">{formatDateTime(selected.started_at)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Completed</dt>
              <dd className="mt-1.5">{formatDateTime(selected.completed_at)}</dd>
            </div>
            <div className="min-w-0 sm:col-span-2">
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">LangSmith correlation ID</dt>
              <dd className="mt-1.5 max-w-md">
                <CopyText value={selected.langsmith_run_id} label="LangSmith correlation ID" />
              </dd>
            </div>
            {selected.error_summary ? (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Error summary</dt>
                <dd className="mt-1.5">{selected.error_summary}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}
    </div>
  )
}

type InvitationGroups =
  | { kind: 'loading' }
  | { kind: 'ready'; items: UserGroup[] }
  | { kind: 'error' }

function InviteUser({
  open,
  role,
  onClose,
  onInvited,
}: {
  open: boolean
  role: RoleId
  onClose: () => void
  onInvited: (user: DirectoryUser) => void
}) {
  const [email, setEmail] = useState('')
  const [assigned, setAssigned] = useState<RoleId>('user')
  const [groups, setGroups] = useState<InvitationGroups>({ kind: 'loading' })
  const [groupId, setGroupId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dirty = email !== '' || assigned !== 'user' || groupId !== ''
  useUnsaved('New user invitation', open && dirty)

  useEffect(() => {
    if (!open) {
      return
    }
    let active = true
    const loadGroups = async () => {
      const items: UserGroup[] = []
      let cursor: string | undefined
      try {
        do {
          const page = await mockUsersApi.listGroups(cursor)
          if (!active) {
            return
          }
          items.push(...page.items)
          cursor = page.next_cursor ?? undefined
        } while (cursor)
        setGroups({ kind: 'ready', items })
      } catch {
        if (active) {
          setGroups({ kind: 'error' })
        }
      }
    }
    void loadGroups()
    return () => {
      active = false
    }
  }, [open])

  const reset = () => {
    setEmail('')
    setAssigned('user')
    setGroupId('')
    setGroups({ kind: 'loading' })
    setError(null)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const user = await mockUsersApi.inviteUser({
        email,
        role: assigned,
        groupIds: groupId ? [groupId] : [],
      })
      reset()
      onInvited(user)
    } catch (caught) {
      setError(isApiError(caught) ? caught.message : 'Could not invite the user.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormDialog
      open={open}
      title="Add user"
      description="Invite someone by email and choose their global role."
      onClose={() => {
        reset()
        onClose()
      }}
      onSubmit={(event) => void submit(event)}
      submitLabel="Create invitation"
      pendingLabel="Creating invitation…"
      busy={busy}
      dirty={dirty}
      disabled={!email.trim()}
      error={error}
    >
      <TextField
        label="Email"
        type="email"
        value={email}
        onChange={(value) => {
          setEmail(value)
          setError(null)
        }}
        placeholder="name@example.com"
        required
      />
      <SelectField
        label="Global role"
        value={assigned}
        onChange={(value) => {
          const option = ROLE_OPTIONS.find((item) => item.value === value)
          if (option) {
            setAssigned(option.value)
          }
        }}
      >
        <RoleOptions superAdmin={role === 'super-admin'} />
      </SelectField>
      <SelectField
        label="Group (optional)"
        value={groupId}
        onChange={setGroupId}
        disabled={groups.kind !== 'ready'}
        hint={groups.kind === 'error' ? 'Groups are unavailable. You can add the user to a group later.' : undefined}
      >
        <option value="">{groups.kind === 'loading' ? 'Loading groups…' : 'No group'}</option>
        {groups.kind === 'ready' ? groups.items.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        )) : null}
      </SelectField>
    </FormDialog>
  )
}

