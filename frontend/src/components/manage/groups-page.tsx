import { Plus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAppShell } from '@/components/shell/use-app-shell'
import { Button } from '@/components/ui/button'
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  LoadingRows,
  Notice,
  TextArea,
  TextField,
} from '@/components/ui/primitives'
import { isApiError } from '@/lib/errors'
import type { GroupDesignation, GroupRecord } from '@/lib/management'
import { clearGroupsCache, readGroupDirectory, writeGroupDirectory } from '@/lib/read-cache'
import { AGENT_ACCESS_MANAGE } from '@/lib/permissions'
import { groupPath } from '@/lib/routes'

function designationTone(
  designation: GroupDesignation | 'admin',
): 'primary' | 'info' | 'neutral' {
  switch (designation) {
    case 'leader':
      return 'primary'
    case 'admin':
      return 'info'
    case 'member':
      return 'neutral'
    default: {
      const unreachable: never = designation
      return unreachable
    }
  }
}

function designationLabel(designation: GroupDesignation | null): string | null {
  switch (designation) {
    case 'leader':
      return 'Leader'
    case 'member':
      return 'Member'
    case null:
      return null
    default: {
      const unreachable: never = designation
      return unreachable
    }
  }
}

export function GroupsPage() {
  const { managementClient, permissions, onUnauthorized } = useAppShell()
  const canManage = permissions.has(AGENT_ACCESS_MANAGE)
  const navigate = useNavigate()
  const initialDirectory = readGroupDirectory()
  const [groups, setGroups] = useState<GroupRecord[]>(initialDirectory?.items ?? [])
  const [cursor, setCursor] = useState<string | null>(initialDirectory?.nextCursor ?? null)
  const [loading, setLoading] = useState(initialDirectory === null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const generation = useRef(0)
  const groupsRef = useRef(groups)
  groupsRef.current = groups

  const load = useCallback(
    async (nextCursor?: string, force = false) => {
      if (!nextCursor && !force) {
        const cached = readGroupDirectory()
        if (cached) {
          setGroups(cached.items)
          setCursor(cached.nextCursor)
          setLoading(false)
          setError(null)
          return
        }
      }
      if (force) {
        clearGroupsCache()
      }
      const ticket = generation.current + 1
      generation.current = ticket
      setLoading(true)
      setError(null)
      try {
        const page = await managementClient.listGroups(nextCursor)
        if (generation.current !== ticket) {
          return
        }
        const items = nextCursor ? [...groupsRef.current, ...page.items] : page.items
        writeGroupDirectory(items, page.next_cursor)
        setGroups(items)
        setCursor(page.next_cursor)
      } catch (caught) {
        if (generation.current !== ticket) {
          return
        }
        if (isApiError(caught) && caught.status === 401) {
          onUnauthorized()
          return
        }
        setError(isApiError(caught) ? caught.message : 'Could not load groups.')
      } finally {
        if (generation.current === ticket) {
          setLoading(false)
        }
      }
    },
    [managementClient, onUnauthorized],
  )

  useEffect(() => {
    void load()
  }, [load])

  async function createGroup() {
    const trimmed = name.trim()
    if (!trimmed || creating) {
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const created = await managementClient.createGroup({
        name: trimmed,
        description: description.trim() === '' ? null : description.trim(),
      })
      clearGroupsCache()
      setName('')
      setDescription('')
      setAddOpen(false)
      void navigate(groupPath(created.id))
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        onUnauthorized()
        return
      }
      setCreateError(isApiError(caught) ? caught.message : 'Could not create the group.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-8 sm:py-8">
        {canManage ? (
          <div className="flex justify-end">
            <Button type="button" className="w-full sm:w-auto" onClick={() => setAddOpen(true)}>
              <Plus className="size-4" aria-hidden />
              Add group
            </Button>
          </div>
        ) : null}

        <ConfirmDialog
          open={addOpen}
          title="Add group"
          confirmLabel={creating ? 'Creating…' : 'Add group'}
          busy={creating}
          onCancel={() => {
            if (!creating) {
              setAddOpen(false)
              setCreateError(null)
            }
          }}
          onConfirm={() => void createGroup()}
        >
          <div className="space-y-3">
            {createError ? <Notice tone="error">{createError}</Notice> : null}
            <TextField label="Group name" value={name} onChange={setName} required />
            <TextArea label="Description" value={description} onChange={setDescription} rows={2} />
          </div>
        </ConfirmDialog>

        {error ? (
          <Notice tone="error" title="Could not load groups">
            {error}
          </Notice>
        ) : null}

        {loading && groups.length === 0 ? (
          <LoadingRows label="Loading" rows={3} />
        ) : groups.length === 0 && !error ? (
          <EmptyState title="No groups">
            {canManage ? 'Add a group to organize people and agent access.' : undefined}
          </EmptyState>
        ) : groups.length > 0 ? (
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
                {groups.map((group) => {
                  const label = designationLabel(group.designation)
                  return (
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
                        {label ? (
                          <Badge tone={designationTone(group.designation ?? 'member')}>{label}</Badge>
                        ) : canManage ? (
                          <Badge tone="info">Admin</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{group.member_count}</td>
                      <td className="px-4 py-3 text-muted-foreground">{group.agent_count}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {cursor ? (
          <Button type="button" variant="outline" disabled={loading} onClick={() => void load(cursor)}>
            {loading ? 'Loading…' : 'Load more groups'}
          </Button>
        ) : null}
    </div>
  )
}
