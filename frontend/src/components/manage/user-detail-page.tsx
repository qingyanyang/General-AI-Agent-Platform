import { Activity, ArrowLeft, KeyRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { PageFrame } from '@/components/shell/app-shell'
import { useAppShell } from '@/components/shell/use-app-shell'
import { Button } from '@/components/ui/button'
import { Badge, CopyText, EmptyState, LoadingRows, Notice, TextField } from '@/components/ui/primitives'
import { isApiError } from '@/lib/errors'
import type {
  DirectoryRole,
  DirectoryUserDetail,
  EffectiveAccess,
  ExecutionRecord,
  ExecutionSummary,
} from '@/lib/management'
import { AGENT_ACCESS_MANAGE } from '@/lib/permissions'
import {
  readCachedUserAccess,
  readCachedUserUsage,
  userAccessEpoch,
  userUsageCacheKey,
  userUsageEpoch,
  writeCachedUserAccess,
  writeCachedUserUsage,
} from '@/lib/read-cache'
import { USERS_PATH, groupPath, settingsPath, userPath } from '@/lib/routes'
import { cn } from '@/lib/utils'

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

function roleLabel(role: DirectoryRole | null): string {
  switch (role) {
    case 'super-admin':
      return 'Super Admin'
    case 'admin':
      return 'Admin'
    case 'user':
      return 'User'
    case null:
      return 'No role'
    default: {
      const unreachable: never = role
      return unreachable
    }
  }
}

export function UserDetailPage() {
  const { userId = '', section } = useParams()
  const decoded = decodeURIComponent(userId)
  const active = section === 'usage' ? 'usage' : 'access'
  const { managementClient, permissions, onUnauthorized } = useAppShell()
  const canManage = permissions.has(AGENT_ACCESS_MANAGE)
  const [user, setUser] = useState<DirectoryUserDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!canManage) {
      return
    }
    let cancelled = false
    setLoading(true)
    void managementClient.getUser(decoded).then(
      (next) => {
        if (cancelled) {
          return
        }
        setUser(next)
        setLoading(false)
      },
      (caught: unknown) => {
        if (cancelled) {
          return
        }
        if (isApiError(caught) && caught.status === 401) {
          onUnauthorized()
          return
        }
        setError(isApiError(caught) ? caught.message : 'Could not load this user.')
        setLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [canManage, decoded, managementClient, onUnauthorized])

  if (!canManage) {
    return (
      <PageFrame mobileTitle="Users">
        <div className="mx-auto max-w-3xl px-4 py-8">
          <Notice tone="warning">Directory listing isn’t available for this role.</Notice>
        </div>
      </PageFrame>
    )
  }

  if (loading) {
    return (
      <PageFrame mobileTitle="User">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
          <LoadingRows label="Loading" rows={3} />
        </div>
      </PageFrame>
    )
  }

  if (!user) {
    return (
      <PageFrame mobileTitle="User">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-8 sm:px-8">
          <Link to={USERS_PATH} className="text-sm text-muted-foreground hover:text-foreground">
            ← Users
          </Link>
          <Notice tone="error" title="User not available">
            {error ?? 'User not found'}
          </Notice>
        </div>
      </PageFrame>
    )
  }

  const name = user.display_name?.trim() || user.user_id
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <PageFrame mobileTitle="User">
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
              {initials || '?'}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="font-serif text-3xl break-words sm:text-4xl">{name}</h1>
                <Badge tone={user.role === 'super-admin' ? 'primary' : user.role === 'admin' ? 'info' : 'neutral'}>
                  {roleLabel(user.role)}
                </Badge>
                <Badge tone={user.status === 'disabled' ? 'danger' : user.status === 'pending' ? 'warning' : 'success'}>
                  {user.status === 'pending' ? 'Pending' : user.status === 'disabled' ? 'Disabled' : 'Active'}
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
                <CopyText value={user.user_id} label="user ID" />
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
            {user.memberships.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {user.memberships.map((membership) => (
                  <li key={membership.group_id}>
                    <Link
                      to={groupPath(membership.group_id)}
                      className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1 text-sm font-medium hover:border-primary/40 hover:bg-primary-soft hover:text-primary"
                    >
                      {membership.group_name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-sm text-muted-foreground">Not a member of any group.</p>
            )}
          </div>
          <nav aria-label="User sections" className="-mb-px mt-5 flex gap-1">
            {(
              [
                ['access', 'Access', <KeyRound key="access" className="size-4" aria-hidden />],
                ['usage', 'Usage', <Activity key="usage" className="size-4" aria-hidden />],
              ] as const
            ).map(([tab, label, icon]) => (
              <Link
                key={tab}
                to={userPath(user.user_id, tab)}
                aria-current={active === tab ? 'page' : undefined}
                className={cn(
                  'inline-flex shrink-0 items-center gap-2 border-b-2 px-3 pt-2 pb-3 text-sm font-medium',
                  active === tab
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {icon}
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-8">
        {active === 'access' ? <UserAccessSection userId={user.user_id} /> : <UserUsageSection userId={user.user_id} />}
      </div>
    </PageFrame>
  )
}

function UserAccessSection({ userId }: { userId: string }) {
  const { managementClient, onUnauthorized } = useAppShell()
  const cachedAccess = readCachedUserAccess(userId)
  const [rows, setRows] = useState<EffectiveAccess[]>(cachedAccess ?? [])
  const [loading, setLoading] = useState(cachedAccess === null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const cached = readCachedUserAccess(userId)
    if (cached) {
      setRows(cached)
      setLoading(false)
      setError(null)
      return
    }
    const epoch = userAccessEpoch()
    let cancelled = false
    setLoading(true)
    void managementClient.listUserAccess(userId).then(
      (items) => {
        if (cancelled || epoch !== userAccessEpoch()) {
          return
        }
        writeCachedUserAccess(userId, items)
        setRows(items)
        setLoading(false)
      },
      (caught: unknown) => {
        if (cancelled) {
          return
        }
        if (isApiError(caught) && caught.status === 401) {
          onUnauthorized()
          return
        }
        setError(isApiError(caught) ? caught.message : 'Could not load access.')
        setLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [managementClient, onUnauthorized, userId])

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Use comes from company-wide availability or group membership. Instruction Skills can be edited by a Leader of
        the agent’s managing group, and by Admin or Super Admin.
      </p>
      {error ? (
        <Notice tone="error" title="Could not load access">
          {error}
        </Notice>
      ) : null}
      {loading ? (
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
                <Link
                  to={settingsPath(row.agent_id, 'access')}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border-strong bg-card px-3 text-xs font-medium hover:bg-muted"
                >
                  <KeyRound className="size-3.5" aria-hidden />
                  Manage groups
                </Link>
              </div>
              <dl className="grid border-t border-border sm:grid-cols-2">
                <div className="px-4 py-3 sm:px-5 sm:py-4">
                  <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Can use</dt>
                  <dd className="mt-2 text-sm">{row.can_use ? 'Yes' : 'No'}</dd>
                  {row.sources.length > 0 ? (
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {row.sources.map((source) => (
                        <li key={`${source.kind}:${source.group_id ?? 'company'}`}>
                          <Badge tone={source.kind === 'company' ? 'primary' : 'neutral'}>
                            {source.kind === 'company' ? 'Company' : source.kind === 'grant' ? 'Grant' : source.name ?? 'Group'}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <div className="border-t border-border px-4 py-3 sm:border-t-0 sm:border-l sm:px-5 sm:py-4">
                  <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Edit skills</dt>
                  <dd className="mt-2 text-sm">{row.can_edit_prompt ? 'Yes' : 'No'}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

const USAGE_STATUSES = ['', 'succeeded', 'failed', 'cancelled', 'running', 'awaiting_approval'] as const

function UserUsageSection({ userId }: { userId: string }) {
  const { managementClient, onUnauthorized } = useAppShell()
  const [agentId, setAgentId] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [applied, setApplied] = useState({ agentId: '', status: '', from: '', to: '' })
  const initialUsage = readCachedUserUsage(userUsageCacheKey(userId, applied))
  const [items, setItems] = useState<ExecutionRecord[]>(initialUsage?.items ?? [])
  const [summary, setSummary] = useState<ExecutionSummary | null>(initialUsage?.summary ?? null)
  const [loading, setLoading] = useState(initialUsage === null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const key = userUsageCacheKey(userId, applied)
    const cached = readCachedUserUsage(key)
    if (cached) {
      setItems(cached.items)
      setSummary(cached.summary)
      setLoading(false)
      setError(null)
      return
    }
    const epoch = userUsageEpoch()
    let cancelled = false
    setItems([])
    setSummary(null)
    setLoading(true)
    setError(null)
    void managementClient
      .listUserExecutions(userId, {
        agentId: applied.agentId || undefined,
        status: applied.status || undefined,
        from: applied.from || undefined,
        to: applied.to || undefined,
      })
      .then(
        (page) => {
          if (cancelled || epoch !== userUsageEpoch()) {
            return
          }
          writeCachedUserUsage(key, { items: page.items, summary: page.summary })
          setItems(page.items)
          setSummary(page.summary)
          setLoading(false)
        },
        (caught: unknown) => {
          if (cancelled) {
            return
          }
          if (isApiError(caught) && caught.status === 401) {
            onUnauthorized()
            return
          }
          setError(isApiError(caught) ? caught.message : 'Could not load usage.')
          setLoading(false)
        },
      )
    return () => {
      cancelled = true
    }
  }, [applied, managementClient, onUnauthorized, userId])

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Execution metadata only. Conversation messages, prompts, and tool payloads are never returned.
      </p>
      <form
        className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault()
          setApplied({
            agentId: agentId.trim(),
            status,
            from: from ? new Date(`${from}T00:00:00`).toISOString() : '',
            to: to ? new Date(`${to}T23:59:59`).toISOString() : '',
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
        <label className="block space-y-1.5 text-sm">
          <span className="block font-medium">Status</span>
          <select
            aria-label="Status"
            className="h-10 w-full rounded-xl border border-border-strong bg-card px-3 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {USAGE_STATUSES.map((value) => (
              <option key={value || 'all'} value={value}>
                {value === '' ? 'Any status' : value.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <TextField label="From" type="date" value={from} onChange={setFrom} />
        <TextField label="To" type="date" value={to} onChange={setTo} />
        <div className="sm:col-span-2 lg:col-span-4">
          <Button type="submit">Apply filters</Button>
        </div>
      </form>
      {summary ? (
        <p className="text-sm text-muted-foreground">
          {summary.total} {summary.total === 1 ? 'execution' : 'executions'}
        </p>
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
                <tr key={item.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">{formatDateTime(item.started_at)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{item.agent_id}</td>
                  <td className="px-4 py-3">{item.status}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {item.duration_ms === null ? '—' : `${item.duration_ms} ms`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
