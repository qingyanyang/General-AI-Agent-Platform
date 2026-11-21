import { Plus, Search } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { useAppShell } from '@/components/shell/use-app-shell'
import { Button } from '@/components/ui/button'
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  LoadingRows,
  Notice,
  TextField,
} from '@/components/ui/primitives'
import { isApiError } from '@/lib/errors'
import type { DirectoryRole, DirectoryStatus, DirectoryUser, GroupRecord } from '@/lib/management'
import { AGENT_ACCESS_MANAGE, PLATFORM_TECHNICAL } from '@/lib/permissions'
import { clearUsersCache, readUserDirectory, usersCacheEpoch, writeUserDirectory } from '@/lib/read-cache'
import { userPath } from '@/lib/routes'

function roleLabel(role: DirectoryRole | null): string {
  switch (role) {
    case 'super-admin':
      return 'Super Admin'
    case 'admin':
      return 'Admin'
    case 'user':
      return 'User'
    case null:
      return '—'
    default: {
      const unreachable: never = role
      return unreachable
    }
  }
}

function statusLabel(status: DirectoryStatus): string {
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

export function UsersPage() {
  const { managementClient, permissions, onUnauthorized } = useAppShell()
  const canManage = permissions.has(AGENT_ACCESS_MANAGE)
  const superAdmin = permissions.has(PLATFORM_TECHNICAL)
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const initialDirectory = readUserDirectory(superAdmin)
  const [items, setItems] = useState<DirectoryUser[]>(initialDirectory?.items ?? [])
  const [cursor, setCursor] = useState<string | null>(initialDirectory?.nextCursor ?? null)
  const [loading, setLoading] = useState(initialDirectory === null)
  const [error, setError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [invitedUser, setInvitedUser] = useState<DirectoryUser | null>(null)
  const generation = useRef(0)
  const itemsRef = useRef(items)
  itemsRef.current = items

  const load = useCallback(
    async (nextCursor?: string) => {
      if (!query && !nextCursor) {
        const cached = readUserDirectory(superAdmin)
        const hasProfiles =
          cached !== null &&
          cached.items.every((user) => Boolean(user.display_name?.trim() || user.email))
        if (cached && hasProfiles) {
          setItems(cached.items)
          setCursor(cached.nextCursor)
          setLoading(false)
          setError(null)
          return
        }
        if (cached && !hasProfiles) {
          clearUsersCache()
        }
      }
      const epoch = usersCacheEpoch()
      const ticket = generation.current + 1
      generation.current = ticket
      setLoading(true)
      setError(null)
      try {
        const page = await managementClient.listUsers(query || undefined, nextCursor)
        if (generation.current !== ticket || epoch !== usersCacheEpoch()) {
          return
        }
        const nextItems = nextCursor ? [...itemsRef.current, ...page.items] : page.items
        if (!query) {
          writeUserDirectory(superAdmin, nextItems, page.next_cursor)
        }
        setItems(nextItems)
        setCursor(page.next_cursor)
      } catch (caught) {
        if (generation.current !== ticket) {
          return
        }
        if (isApiError(caught) && caught.status === 401) {
          onUnauthorized()
          return
        }
        setError(isApiError(caught) ? caught.message : 'Could not load users.')
      } finally {
        if (generation.current === ticket) {
          setLoading(false)
        }
      }
    },
    [managementClient, onUnauthorized, query, superAdmin],
  )

  useEffect(() => {
    if (!canManage) {
      return
    }
    void load()
  }, [canManage, load])

  const search = (event: FormEvent) => {
    event.preventDefault()
    setQuery(draft.trim())
  }

  if (!canManage) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Notice tone="warning" title="Users aren’t available">
          Directory listing isn’t available for this role.
        </Notice>
      </div>
    )
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
          <Button type="button" className="w-full sm:w-auto" onClick={() => setInviting(true)}>
            <Plus className="size-4" aria-hidden />
            Add user
          </Button>
        </div>
        {invitedUser ? (
          <Notice tone="success" title="Invitation created">
            {invitedUser.email ?? 'That person'} was added as{' '}
            {invitedUser.status === 'pending' ? 'Pending' : 'Active'}.{' '}
            <Link
              to={userPath(invitedUser.user_id, 'access')}
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
        {loading && items.length === 0 ? <LoadingRows label="Loading users" rows={4} /> : null}
        {!loading && items.length === 0 && !error ? (
          <EmptyState title="No users match">Try another search, or add someone by email.</EmptyState>
        ) : null}
        {items.length > 0 ? (
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
                  const name = user.display_name?.trim() || user.user_id
                  const secondary = user.display_name?.trim() ? user.email || user.user_id : user.email
                  return (
                    <tr key={user.user_id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <Link to={userPath(user.user_id, 'access')} className="font-medium hover:underline">
                          {name}
                        </Link>
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
                        <Badge tone={user.role === 'super-admin' ? 'primary' : user.role === 'admin' ? 'info' : 'neutral'}>
                          {roleLabel(user.role)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          tone={
                            user.status === 'disabled' ? 'danger' : user.status === 'pending' ? 'warning' : 'success'
                          }
                        >
                          {statusLabel(user.status)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {user.last_seen_at
                          ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
                              new Date(user.last_seen_at),
                            )
                          : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {cursor ? (
          <Button type="button" variant="outline" disabled={loading} onClick={() => void load(cursor)}>
            {loading ? 'Loading…' : 'Load more users'}
          </Button>
        ) : null}
      <InviteUser
        open={inviting}
        superAdmin={superAdmin}
        onClose={() => setInviting(false)}
        onInvited={(user) => {
          setInviting(false)
          setInvitedUser(user)
          clearUsersCache()
          void load()
        }}
      />
    </div>
  )
}

function InviteUser({
  open,
  superAdmin,
  onClose,
  onInvited,
}: {
  open: boolean
  superAdmin: boolean
  onClose: () => void
  onInvited: (user: DirectoryUser) => void
}) {
  const { managementClient, onUnauthorized } = useAppShell()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<DirectoryRole>('user')
  const [groups, setGroups] = useState<GroupRecord[]>([])
  const [groupId, setGroupId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }
    let cancelled = false
    void managementClient.listAllGroups().then(
      (items) => {
        if (!cancelled) {
          setGroups(items)
        }
      },
      () => {
        if (!cancelled) {
          setGroups([])
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [managementClient, open])

  const reset = () => {
    setEmail('')
    setRole('user')
    setGroupId('')
    setError(null)
  }

  return (
    <ConfirmDialog
      open={open}
      title="Add user"
      confirmLabel={busy ? 'Creating invitation…' : 'Create invitation'}
      busy={busy}
      onCancel={() => {
        if (busy) {
          return
        }
        reset()
        onClose()
      }}
      onConfirm={() => {
        if (busy || !email.trim()) {
          setError('Enter an email address.')
          return
        }
        setBusy(true)
        setError(null)
        void managementClient
          .inviteUser({
            email: email.trim(),
            role,
            group_id: groupId || null,
          })
          .then((user) => {
            reset()
            onInvited(user)
          })
          .catch((caught: unknown) => {
            if (isApiError(caught) && caught.status === 401) {
              onUnauthorized()
              return
            }
            setError(isApiError(caught) ? caught.message : 'Could not invite the user.')
          })
          .finally(() => setBusy(false))
      }}
    >
      <div className="space-y-3">
        <p>Invite someone by email and choose their global role. Auth0 sends the verification message.</p>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <TextField label="Email" value={email} onChange={setEmail} placeholder="name@example.com" required />
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Global role</span>
          <select
            aria-label="Global role"
            className="h-10 w-full rounded-xl border border-border-strong bg-card px-3 text-sm"
            value={role}
            onChange={(event) => {
              const value = event.target.value
              if (value === 'user' || value === 'admin' || (superAdmin && value === 'super-admin')) {
                setRole(value)
              }
            }}
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
            {superAdmin ? <option value="super-admin">Super Admin</option> : null}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Group (optional)</span>
          <select
            aria-label="Group"
            className="h-10 w-full rounded-xl border border-border-strong bg-card px-3 text-sm"
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
          >
            <option value="">No group</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </ConfirmDialog>
  )
}
