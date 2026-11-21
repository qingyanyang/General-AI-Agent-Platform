import { Plus, Search, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { ConfirmDialog, IconButton, LoadingRows, Notice, SectionCard } from '@/components/ui/primitives'
import { isApiError } from '@/lib/errors'
import {
  cachedGroups,
  clearUserAccessCache,
  readCachedAccess,
  readCachedMemberships,
  readCompleteGroups,
  writeCachedAccess,
  writeCachedMemberships,
} from '@/lib/read-cache'
import type {
  AccessAudienceMode,
  AgentAccessConfig,
  GroupRecord,
  ManagementClient,
} from '@/lib/management'
import { groupPath } from '@/lib/routes'
import { cn } from '@/lib/utils'

type AccessPanelProps = {
  agentId: string
  client: ManagementClient
  onUnauthorized: () => void
  onAudienceEffectiveChange?: (agentId: string, effective: boolean) => void
}

type AssignmentRow = {
  group_id: string
  group_name: string
  member_count: number
}

function errorMessage(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback
}

function rowsFrom(config: AgentAccessConfig): AssignmentRow[] {
  return config.groups.map((group) => ({
    group_id: group.group_id,
    group_name: group.name,
    member_count: readCachedMemberships(group.group_id)?.items.length ?? 0,
  }))
}

export function AccessPanel({
  agentId,
  client,
  onUnauthorized,
  onAudienceEffectiveChange,
}: AccessPanelProps) {
  const audienceName = useId()
  const ticket = useRef(0)
  const initialConfig = readCachedAccess(agentId)
  const initialCatalog = readCompleteGroups()
  const hasInitial = initialConfig !== null && initialCatalog !== null
  const [mode, setMode] = useState<AccessAudienceMode>(initialConfig?.audience_mode ?? 'groups')
  const [saved, setSaved] = useState<AgentAccessConfig | null>(initialConfig)
  const [rows, setRows] = useState<AssignmentRow[]>(initialConfig ? rowsFrom(initialConfig) : [])
  const [groups, setGroups] = useState<GroupRecord[]>(initialCatalog ?? [])
  const [loading, setLoading] = useState(!hasInitial)
  const [loaded, setLoaded] = useState(hasInitial)
  const [seenAgentId, setSeenAgentId] = useState(agentId)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<AssignmentRow | null>(null)
  const [busy, setBusy] = useState(false)

  const memberCount = async (groupId: string) => {
    const cached = readCachedMemberships(groupId)
    if (cached) {
      return cached.items.length
    }
    try {
      const page = await client.listMemberships(groupId)
      writeCachedMemberships(groupId, { items: page.items, nextCursor: page.next_cursor })
      return page.items.length
    } catch {
      return 0
    }
  }

  const applyConfig = async (config: AgentAccessConfig, catalog: GroupRecord[]) => {
    const assigned = config.groups.map((group) => ({
      group_id: group.group_id,
      group_name: group.name,
    }))
    const counts = await Promise.all(assigned.map((row) => memberCount(row.group_id)))
    setSaved(config)
    setMode(config.audience_mode ?? 'groups')
    setRows(
      assigned.map((row, index) => ({
        ...row,
        member_count: counts[index] ?? 0,
      })),
    )
    setGroups(catalog)
    onAudienceEffectiveChange?.(agentId, config.audience_effective)
  }

  if (seenAgentId !== agentId) {
    const config = readCachedAccess(agentId)
    const catalog = readCompleteGroups()
    const ready = config !== null && catalog !== null
    setSeenAgentId(agentId)
    setSaved(config)
    setMode(config?.audience_mode ?? 'groups')
    setGroups(catalog ?? [])
    setRows(config ? rowsFrom(config) : [])
    setLoaded(ready)
    setLoading(!ready)
    setError(null)
    setStatus(null)
  }

  const reload = async () => {
    const current = ++ticket.current
    setError(null)
    try {
      const cachedConfig = readCachedAccess(agentId)
      const cachedCatalog = readCompleteGroups()
      if (!(cachedConfig && cachedCatalog)) {
        setLoading(true)
      }
      const catalog = cachedCatalog ?? (await cachedGroups(() => client.listAllGroups()))
      if (ticket.current !== current) {
        return
      }
      let config = cachedConfig
      if (!config) {
        config = await client.getAccessConfig(agentId)
        if (ticket.current !== current) {
          return
        }
        writeCachedAccess(agentId, config)
      }
      await applyConfig(config, catalog)
      if (ticket.current === current) {
        setLoaded(true)
      }
    } catch (caught) {
      if (ticket.current !== current) {
        return
      }
      onAudienceEffectiveChange?.(agentId, false)
      if (isApiError(caught) && caught.status === 401) {
        onUnauthorized()
        return
      }
      setError(errorMessage(caught, 'Could not load agent access.'))
    } finally {
      if (ticket.current === current) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    void reload()
    return () => {
      ticket.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when agent changes
  }, [agentId])

  const persist = async (
    nextMode: AccessAudienceMode,
    groupIds: string[],
  ): Promise<AgentAccessConfig> => {
    const updated = await client.putAccessConfig(agentId, {
      audience_mode: nextMode,
      owning_group_id: saved?.owning_group_id ?? null,
      group_ids: groupIds,
    })
    if (!updated.audience_effective) {
      const activated = await client.activateAccessConfig(agentId)
      writeCachedAccess(agentId, activated)
      clearUserAccessCache()
      return activated
    }
    writeCachedAccess(agentId, updated)
    clearUserAccessCache()
    return updated
  }

  const changeMode = async (next: AccessAudienceMode) => {
    if (busy || next === mode || !saved) {
      return
    }
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const updated = await persist(next, saved.group_ids)
      await applyConfig(updated, groups)
      setStatus(
        next === 'company'
          ? 'Everyone in the company can use this agent.'
          : 'Access is limited to selected groups.',
      )
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        onUnauthorized()
        return
      }
      setError(errorMessage(caught, 'Could not update access audience.'))
    } finally {
      setBusy(false)
    }
  }

  const removeGroup = async () => {
    if (!removing || busy || !saved) {
      return
    }
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const updated = await persist(
        mode,
        saved.group_ids.filter((id) => id !== removing.group_id),
      )
      await applyConfig(updated, groups)
      setStatus(`Removed ${removing.group_name} from access.`)
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        onUnauthorized()
        return
      }
      setError(errorMessage(caught, 'Could not remove the assignment.'))
    } finally {
      setRemoving(null)
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <SectionCard title="Who can use this agent?" description="Audience changes save immediately.">
        {loading && !loaded ? (
          <LoadingRows label="Loading agent access" rows={2} />
        ) : null}
        {loaded ? (
          <fieldset className="grid gap-2 sm:grid-cols-2" disabled={busy || loading}>
            <legend className="sr-only">Access audience</legend>
            <AudienceOption
              name={audienceName}
              checked={mode === 'company'}
              onChange={() => void changeMode('company')}
            >
              Everyone in the company
            </AudienceOption>
            <AudienceOption
              name={audienceName}
              checked={mode === 'groups'}
              onChange={() => void changeMode('groups')}
            >
              Selected groups
            </AudienceOption>
          </fieldset>
        ) : null}
        {status ? (
          <Notice tone="success" className="mt-4">
            {status}
          </Notice>
        ) : null}
        {error ? (
          <Notice tone="error" className="mt-4">
            {error}
          </Notice>
        ) : null}
        {mode === 'groups' && loaded ? (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-medium">Assigned groups</h3>
              <Button type="button" size="sm" disabled={busy || loading} onClick={() => setAdding(true)}>
                <Plus className="size-4" aria-hidden />
                Add group
              </Button>
            </div>
            {rows.length > 0 ? (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {rows.map((row) => (
                  <li key={row.group_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <Link to={groupPath(row.group_id)} className="text-sm font-medium hover:underline">
                        {row.group_name}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {row.member_count} member{row.member_count === 1 ? '' : 's'}
                      </p>
                    </div>
                    <IconButton
                      label={`Remove ${row.group_name}`}
                      className="text-danger hover:bg-danger-soft"
                      disabled={busy || loading}
                      onClick={() => setRemoving(row)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </IconButton>
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
        groups={groups.filter((group) => !rows.some((row) => row.group_id === group.id))}
        busy={busy}
        onClose={() => setAdding(false)}
        onAssign={async (group) => {
          if (!saved) {
            return
          }
          setBusy(true)
          setError(null)
          setStatus(null)
          try {
            const updated = await persist(mode, [...saved.group_ids, group.id])
            await applyConfig(updated, groups)
            setStatus(`Added ${group.name} to access.`)
            setAdding(false)
          } catch (caught) {
            if (isApiError(caught) && caught.status === 401) {
              onUnauthorized()
              return
            }
            throw caught
          } finally {
            setBusy(false)
          }
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
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm has-disabled:cursor-default has-disabled:opacity-60',
        checked ? 'border-primary/40 bg-primary-soft/60' : 'border-border',
      )}
    >
      <input
        name={name}
        type="radio"
        checked={checked}
        onChange={onChange}
        className="size-4 shrink-0 accent-[var(--color-primary)]"
      />
      <span className="font-medium">{children}</span>
    </label>
  )
}

function AddGroupDialog({
  open,
  groups,
  busy,
  onClose,
  onAssign,
}: {
  open: boolean
  groups: GroupRecord[]
  busy: boolean
  onClose: () => void
  onAssign: (group: GroupRecord) => Promise<void>
}) {
  const searchId = useId()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<GroupRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const normalized = query.trim().toLowerCase()
  const visible = groups.filter((group) => group.name.toLowerCase().includes(normalized))

  useEffect(() => {
    if (!open) {
      setQuery('')
      setSelected(null)
      setError(null)
    }
  }, [open])

  const assign = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected || busy) {
      return
    }
    setError(null)
    try {
      await onAssign(selected)
    } catch (caught) {
      setError(errorMessage(caught, 'Could not assign the group.'))
    }
  }

  if (!open) {
    return null
  }

  return (
    <ConfirmDialog
      open={open}
      title="Add group"
      confirmLabel={busy ? 'Adding…' : 'Add group'}
      busy={busy}
      onCancel={onClose}
      onConfirm={() => {
        if (selected) {
          void onAssign(selected).catch((caught: unknown) => {
            setError(errorMessage(caught, 'Could not assign the group.'))
          })
        }
      }}
    >
      <form className="space-y-3" onSubmit={(event) => void assign(event)}>
        <p className="text-sm text-muted-foreground">
          Members of the selected group will be able to use this agent.
        </p>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="space-y-1.5">
          <label htmlFor={searchId} className="block text-sm font-medium">
            Find a group
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground"
              aria-hidden
            />
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setSelected(null)
                setError(null)
              }}
              placeholder="Search by group name"
              className="w-full rounded-xl border border-border-strong py-2 pr-3 pl-9 text-sm"
            />
          </div>
        </div>
        {visible.length > 0 ? (
          <fieldset className="max-h-64 space-y-2 overflow-y-auto">
            <legend className="sr-only">Available groups</legend>
            {visible.map((group) => (
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
        ) : (
          <p className="text-sm text-muted-foreground">
            No unassigned groups match. Try a different search.
          </p>
        )}
      </form>
    </ConfirmDialog>
  )
}
