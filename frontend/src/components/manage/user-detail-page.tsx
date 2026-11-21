import { Activity, ArrowLeft, KeyRound } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { PageFrame } from '@/components/shell/app-shell'
import { useAppShell } from '@/components/shell/use-app-shell'
import { Button } from '@/components/ui/button'
import { Badge, CopyText, EmptyState, LoadingRows, Notice, TextField } from '@/components/ui/primitives'
import { isApiError } from '@/lib/errors'
import { displayExecutionStatus, EXECUTION_STATUSES } from '@/lib/execution-status'
import type {
  DirectoryRole,
  DirectoryUserDetail,
  EffectiveAccess,
  EstimatedModelCost,
  RunTokens,
  RunUsage,
  RunUsageDetail,
  ExecutionSummary,
} from '@/lib/management'
import { AGENT_ACCESS_MANAGE } from '@/lib/permissions'
import {
  readCachedUserAccess,
  userAccessEpoch,
  writeCachedUserAccess,
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
    setUser(null)
    setError(null)
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

  if (loading || (user && user.user_id !== decoded)) {
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
        {active === 'access' ? (
          <UserAccessSection userId={user.user_id} />
        ) : (
          <UserUsageSection key={user.user_id} user={user} />
        )}
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

function formatDuration(value: number | null) {
  if (value === null) {
    return '—'
  }
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value} ms`
}

function TokenTotals({ tokens }: { tokens: RunTokens }) {
  if (tokens.completeness === 'not_captured') {
    return <span className="text-muted-foreground">Usage not captured</span>
  }
  if (tokens.completeness === 'unknown') {
    return <span className="text-muted-foreground">Unknown</span>
  }
  return (
    <div className="grid grid-cols-3 gap-x-3 tabular-nums">
      {([
        ['Input', tokens.input_tokens], ['Output', tokens.output_tokens], ['Total', tokens.total_tokens],
      ] as const).map(([label, count]) => (
        <div key={label}>
          <div className="text-xs text-muted-foreground">{label}</div>
          {count === null ? 'Unknown' : count.toLocaleString()}
        </div>
      ))}
      {tokens.completeness === 'partial' ? (
        <span className="col-span-3 text-xs text-muted-foreground">Partial · known tokens</span>
      ) : null}
    </div>
  )
}

function ModelCosts({ cost }: { cost: EstimatedModelCost }) {
  if (cost.completeness === 'not_captured') {
    return <span className="text-muted-foreground">Usage not captured</span>
  }
  if (cost.completeness === 'unknown') {
    return <span className="text-muted-foreground">Unknown</span>
  }
  return (
    <div className="tabular-nums">
      {cost.totals.map(({ currency, amount }) => (
        <div key={currency} className="whitespace-nowrap">
          {currency} {amount.includes('.') ? amount.replace(/0+$/, '').replace(/\.$/, '') : amount}
        </div>
      ))}
      {cost.completeness === 'partial' ? (
        <span className="text-xs text-muted-foreground">Partial · known costs</span>
      ) : null}
    </div>
  )
}

function UsageRunDetail({ run }: { run: RunUsageDetail }) {
  return (
    <div className="space-y-5">
      <dl className="grid gap-4 rounded-xl bg-muted p-4 md:grid-cols-3">
        <div>
          <dt className="mb-1 text-xs font-medium text-muted-foreground">Execution ID</dt>
          <dd><CopyText value={run.id} label="execution ID" /></dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium text-muted-foreground">Run tokens</dt>
          <dd><TokenTotals tokens={run.tokens} /></dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium text-muted-foreground">Estimated model cost</dt>
          <dd><ModelCosts cost={run.estimated_model_cost} /></dd>
        </div>
      </dl>
      <section className="space-y-2">
        <h4 className="font-medium">Model calls</h4>
        {run.model_calls.length === 0 ? (
          <p className="text-sm text-muted-foreground">No model calls recorded.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {run.model_calls.map((call) => (
              <li key={call.id} className="grid gap-3 px-4 py-3 text-sm md:grid-cols-3">
                <div className="min-w-0 break-words">
                  <p className="font-medium">{call.reported_model ?? call.requested_model}</p>
                  <p className="text-xs text-muted-foreground">
                    {call.provider} · {displayExecutionStatus(call.status)} · {formatDuration(call.duration_ms)}
                  </p>
                </div>
                <div>
                  <TokenTotals tokens={call.tokens} />
                  {call.cached_input_tokens !== null ? (
                    <p className="text-xs text-muted-foreground">
                      Cached input {call.cached_input_tokens.toLocaleString()}
                    </p>
                  ) : null}
                  {call.cache_write_tokens !== null ? (
                    <p className="text-xs text-muted-foreground">
                      Cache writes {call.cache_write_tokens.toLocaleString()}
                    </p>
                  ) : null}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Estimated model cost</p>
                  <ModelCosts cost={call.estimated_model_cost} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-2">
        <h4 className="font-medium">Tool calls</h4>
        {run.tool_calls.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tool calls recorded.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {run.tool_calls.map((call) => (
              <li key={call.id} className="flex flex-wrap justify-between gap-2 px-4 py-3 text-sm">
                <span className="font-medium">{call.name}</span>
                <span className="text-muted-foreground">
                  {displayExecutionStatus(call.status)} · {formatDuration(call.duration_ms)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function UserUsageSection({ user }: { user: DirectoryUserDetail }) {
  const { managementClient, onUnauthorized } = useAppShell()
  const userId = user.user_id
  const userLabel = user.display_name || user.email || userId
  const [agentId, setAgentId] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [applied, setApplied] = useState({ agentId: '', status: '', from: '', to: '' })
  const [items, setItems] = useState<RunUsage[]>([])
  const [summary, setSummary] = useState<ExecutionSummary | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<string | null>(null)
  const [detail, setDetail] = useState<RunUsageDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const generation = useRef(0)
  const detailSection = useRef<HTMLElement>(null)
  const detailId = useId()

  useEffect(() => {
    const ticket = ++generation.current
    setItems([])
    setSummary(null)
    setCursor(null)
    setLoading(true)
    setLoadingMore(false)
    setError(null)
    setSelection(null)
    void managementClient.listUserExecutions(userId, applied).then(
      (page) => {
        if (ticket === generation.current) {
          setItems(page.items)
          setSummary(page.summary)
          setCursor(page.next_cursor)
          setLoading(false)
        }
      },
      (caught: unknown) => {
        if (ticket !== generation.current) {
          return
        }
        if (isApiError(caught) && caught.status === 401) {
          onUnauthorized()
        } else {
          setError(isApiError(caught) ? caught.message : 'Could not load usage.')
        }
        setLoading(false)
      },
    )
    return () => { generation.current += 1 }
  }, [applied, managementClient, onUnauthorized, userId])

  async function loadMore() {
    if (!cursor || loading || loadingMore) {
      return
    }
    const ticket = generation.current
    setLoadingMore(true)
    setError(null)
    try {
      const page = await managementClient.listUserExecutions(userId, { ...applied, cursor })
      if (ticket === generation.current) {
        setItems((current) => [...current, ...page.items])
        setSummary(page.summary)
        setCursor(page.next_cursor)
      }
    } catch (caught) {
      if (ticket !== generation.current) {
        return
      }
      if (isApiError(caught) && caught.status === 401) {
        onUnauthorized()
      } else {
        setError(isApiError(caught) ? caught.message : 'Could not load more executions.')
      }
    } finally {
      if (ticket === generation.current) {
        setLoadingMore(false)
      }
    }
  }

  useEffect(() => {
    if (!selection) {
      return
    }
    detailSection.current?.scrollIntoView?.({ block: 'nearest' })
    let cancelled = false
    void managementClient.getUserExecutionUsage(userId, selection).then(
      (next) => {
        if (!cancelled) {
          setDetail(next)
        }
      },
      (caught: unknown) => {
        if (cancelled) {
          return
        }
        if (isApiError(caught) && caught.status === 401) {
          onUnauthorized()
        } else {
          setDetailError(isApiError(caught) ? caught.message : 'Could not load execution details.')
        }
      },
    )
    return () => { cancelled = true }
  }, [managementClient, onUnauthorized, selection, userId])

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Estimated model cost covers captured provider usage. Provider invoices are authoritative.
      </p>
      <form
        className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault()
          setApplied({
            agentId: agentId.trim(),
            status,
            from: from ? new Date(`${from}T00:00:00`).toISOString() : '',
            to: to ? new Date(`${to}T23:59:59.999`).toISOString() : '',
          })
        }}
      >
        <TextField
          label="Agent"
          value={agentId}
          onChange={setAgentId}
          mono
          placeholder="Agent ID"
        />
        <label className="block space-y-1.5 text-sm">
          <span className="block font-medium">Status</span>
          <select
            aria-label="Status"
            className="h-10 w-full rounded-xl border border-border-strong bg-card px-3 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">Any status</option>
            {EXECUTION_STATUSES.map((value) => (
              <option key={value} value={value}>{displayExecutionStatus(value)}</option>
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
      {error ? <Notice tone="error" title="Could not load usage">{error}</Notice> : null}
      {loading ? (
        <LoadingRows label="Loading usage" rows={3} />
      ) : items.length === 0 ? (
        error ? null : <EmptyState title="No executions">Nothing matches these filters for this user.</EmptyState>
      ) : (
        <div className="max-w-full overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-border text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Started / User</th>
                <th scope="col" className="px-4 py-3 font-medium">Agent / Models</th>
                <th scope="col" className="px-4 py-3 font-medium">Tokens</th>
                <th scope="col" className="px-4 py-3 font-medium">Estimated model cost</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Active duration</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={cn(
                  'border-b border-border align-top last:border-0',
                  item.id === selection && 'bg-primary-soft',
                )}>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      aria-expanded={item.id === selection}
                      aria-controls={item.id === selection ? detailId : undefined}
                      className="text-left font-medium text-primary hover:underline"
                      onClick={() => {
                        setDetail(null)
                        setDetailError(null)
                        setSelection(item.id === selection ? null : item.id)
                      }}
                    >
                      {formatDateTime(item.started_at)}
                    </button>
                    <div className="text-xs text-muted-foreground">{userLabel}</div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs">{item.agent_id}</p>
                    <p className="mt-1 max-w-56 text-xs break-words text-muted-foreground">
                      {item.models.map(({ provider, model }) => `${provider}/${model}`).join(', ') || '—'}
                    </p>
                  </td>
                  <td className="px-4 py-3"><TokenTotals tokens={item.tokens} /></td>
                  <td className="px-4 py-3"><ModelCosts cost={item.estimated_model_cost} /></td>
                  <td className="px-4 py-3">{displayExecutionStatus(item.status)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDuration(item.duration_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cursor ? (
        <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
      {selection ? (
        <section
          id={detailId}
          ref={detailSection}
          aria-label="Execution details"
          className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-serif text-lg">Execution details</h3>
              {detail ? (
                <p className="text-xs text-muted-foreground">
                  {displayExecutionStatus(detail.status)} · {formatDuration(detail.duration_ms)} active
                </p>
              ) : null}
            </div>
            <Button size="sm" variant="outline" onClick={() => setSelection(null)}>Close</Button>
          </div>
          {detailError ? (
            <Notice tone="error" title="Could not load execution details">{detailError}</Notice>
          ) : detail ? <UsageRunDetail run={detail} /> : <LoadingRows label="Loading execution details" rows={2} />}
        </section>
      ) : null}
    </div>
  )
}
