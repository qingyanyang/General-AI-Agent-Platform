/** PROTOTYPE Agent Access: who can use this Agent (company-wide or selected groups). */
import { Search, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { isApiError } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { usePermissions } from '../hooks'
import type { AccessAudienceMode } from '../mock/users-data'
import { mockUsersApi } from '../mock/users-api'
import { groupPath } from '../routes'
import {
  AddButton,
  ConfirmDialog,
  FormDialog,
  IconButton,
  LoadingRows,
  Notice,
  SectionCard,
} from '../ui'

type GroupOption = { id: string; name: string }
type AssignmentRow = { group_id: string; group_name: string; member_count: number }

export function AccessPanel({ agentId }: { agentId: string }) {
  const { canAssignGroups } = usePermissions()
  const [mode, setMode] = useState<AccessAudienceMode>('groups')
  const [rows, setRows] = useState<AssignmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<AssignmentRow | null>(null)
  const [busy, setBusy] = useState(false)
  const ticket = useRef(0)
  const audienceName = useId()

  const reload = () => {
    const current = ++ticket.current
    setLoading(true)
    setError(null)
    Promise.all([mockUsersApi.getAccessAudience(agentId), mockUsersApi.listAgentGroupAssignments(agentId)])
      .then(([audience, assignments]) => {
        if (ticket.current === current) {
          setMode(audience.mode)
          setRows(assignments)
          setLoaded(true)
        }
      })
      .catch((caught: unknown) => {
        if (ticket.current === current) {
          setError(isApiError(caught) ? caught.message : 'Could not load agent access.')
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
    return () => { ticket.current += 1 }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when agent changes
  }, [agentId])

  const changeMode = async (next: AccessAudienceMode) => {
    if (!canAssignGroups || busy || next === mode) {
      return
    }
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      await mockUsersApi.setAccessAudience(agentId, next)
      setMode(next)
      setStatus(next === 'company' ? 'Everyone in the company can use this agent.' : 'Access is limited to selected groups.')
      reload()
    } catch (caught) {
      setError(isApiError(caught) ? caught.message : 'Could not update access audience.')
    } finally {
      setBusy(false)
    }
  }

  const removeGroup = async () => {
    if (!removing || busy) {
      return
    }
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      await mockUsersApi.unassignGroupAgent(removing.group_id, agentId)
      setStatus(`Removed ${removing.group_name} from access.`)
      reload()
    } catch (caught) {
      setError(isApiError(caught) ? caught.message : 'Could not remove the assignment.')
    } finally {
      setRemoving(null)
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <SectionCard title="Who can use this agent?" description={canAssignGroups ? 'Audience changes save immediately.' : undefined}>
        {loading && !loaded ? <LoadingRows label="Loading agent access" rows={2} /> : null}
        {loaded && !canAssignGroups ? (
          <p className="text-sm font-medium">{mode === 'company' ? 'Everyone in the company' : 'Selected groups'}</p>
        ) : null}
        {canAssignGroups && loaded ? (
          <fieldset className="grid gap-2 sm:grid-cols-2" disabled={busy || loading}>
            <legend className="sr-only">Access audience</legend>
            <AudienceOption name={audienceName} checked={mode === 'company'} onChange={() => void changeMode('company')}>
              Everyone in the company
            </AudienceOption>
            <AudienceOption name={audienceName} checked={mode === 'groups'} onChange={() => void changeMode('groups')}>
              Selected groups
            </AudienceOption>
          </fieldset>
        ) : null}
        {status ? <Notice tone="success" className="mt-4">{status}</Notice> : null}
        {error ? <Notice tone="error" className="mt-4">{error}</Notice> : null}
        {mode === 'groups' && loaded ? (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-medium">Assigned groups</h3>
              {canAssignGroups ? (
                <AddButton size="sm" disabled={busy || loading} onClick={() => setAdding(true)}>Add group</AddButton>
              ) : null}
            </div>
            {rows.length > 0 ? (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {rows.map((row) => (
                  <li key={row.group_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <Link to={groupPath(row.group_id)} className="text-sm font-medium hover:underline">{row.group_name}</Link>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {row.member_count} member{row.member_count === 1 ? '' : 's'}
                      </p>
                    </div>
                    {canAssignGroups ? (
                      <IconButton
                        label={`Remove ${row.group_name}`}
                        className="text-danger hover:bg-danger-soft"
                        disabled={busy || loading}
                        onClick={() => setRemoving(row)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </IconButton>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No groups assigned yet.</p>
            )}
          </div>
        ) : null}
      </SectionCard>

      <AddGroupDialog
        open={adding}
        agentId={agentId}
        rows={rows}
        onClose={() => setAdding(false)}
        onAssigned={(name) => {
          setAdding(false)
          setStatus(`Added ${name} to access.`)
          reload()
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        title="Remove group assignment?"
        confirmLabel={busy ? 'Removing…' : 'Remove assignment'}
        tone="danger"
        busy={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => void removeGroup()}
      >
        Remove {removing?.group_name} from this agent’s access list?
      </ConfirmDialog>
    </div>
  )
}

function AudienceOption({
  name,
  checked,
  onChange,
  children,
}: {
  name: string
  checked: boolean
  onChange: () => void
  children: string
}) {
  return (
    <label className={cn(
      'flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm has-disabled:cursor-default has-disabled:opacity-60',
      checked ? 'border-primary/40 bg-primary-soft/60' : 'border-border',
    )}>
      <input name={name} type="radio" checked={checked} onChange={onChange} className="size-4 shrink-0 accent-[var(--color-primary)]" />
      <span className="font-medium">{children}</span>
    </label>
  )
}

function AddGroupDialog({
  open,
  agentId,
  rows,
  onClose,
  onAssigned,
}: {
  open: boolean
  agentId: string
  rows: AssignmentRow[]
  onClose: () => void
  onAssigned: (name: string) => void
}) {
  const [query, setQuery] = useState('')
  const [groups, setGroups] = useState<GroupOption[]>([])
  const [selected, setSelected] = useState<GroupOption | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchId = useId()

  useEffect(() => {
    if (!open) {
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      void mockUsersApi.searchGroups(query)
        .then((results) => {
          if (active) {
            setGroups(results.filter((group) => !rows.some((row) => row.group_id === group.id)))
          }
        })
        .catch((caught: unknown) => {
          if (active) {
            setError(isApiError(caught) ? caught.message : 'Could not load groups.')
          }
        })
        .finally(() => {
          if (active) {
            setLoading(false)
          }
        })
    }, query.trim() ? 200 : 0)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [open, query, rows])

  const reset = () => {
    setQuery('')
    setGroups([])
    setSelected(null)
    setLoading(true)
    setError(null)
  }

  const assign = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected || busy) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await mockUsersApi.assignGroupAgent(selected.id, agentId)
      onAssigned(selected.name)
      reset()
    } catch (caught) {
      setError(isApiError(caught) ? caught.message : 'Could not assign the group.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormDialog
      open={open}
      title="Add group"
      description="Members of the selected group will be able to use this agent."
      submitLabel="Add group"
      pendingLabel="Adding…"
      busy={busy}
      error={error}
      disabled={selected === null}
      onClose={() => {
        reset()
        onClose()
      }}
      onSubmit={(event) => void assign(event)}
    >
      <div className="space-y-1.5">
        <label htmlFor={searchId} className="block text-sm font-medium">Find a group</label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setGroups([])
              setSelected(null)
              setLoading(true)
              setError(null)
            }}
            placeholder="Search by group name"
            className="w-full rounded-xl border border-border-strong py-2 pr-3 pl-9 text-sm"
          />
        </div>
      </div>
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">Loading groups…</p>
      ) : groups.length > 0 ? (
        <fieldset className="max-h-64 space-y-2 overflow-y-auto">
          <legend className="sr-only">Available groups</legend>
          {groups.map((group) => (
            <AudienceOption
              key={group.id}
              name={searchId}
              checked={selected?.id === group.id}
              onChange={() => setSelected(group)}
            >
              {group.name}
            </AudienceOption>
          ))}
        </fieldset>
      ) : !error ? (
        <p className="text-sm text-muted-foreground">No unassigned groups match. Try a different search.</p>
      ) : null}
    </FormDialog>
  )
}

