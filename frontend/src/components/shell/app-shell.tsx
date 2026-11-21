import { LogOut, Menu, MessageSquare, Plus, Users, X } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { ChatProvider, useChat } from '@/components/chat/chat-provider'
import { useAppShell } from '@/components/shell/use-app-shell'

import { Button } from '@/components/ui/button'
import { IconButton, Notice, TextArea, TextField } from '@/components/ui/primitives'
import type { ChatClient } from '@/lib/types'
import { isApiError } from '@/lib/errors'
import type { AgentRecord, ManagementClient } from '@/lib/management'
import { AGENT_ACCESS_MANAGE, AGENTS_CONFIGURE, hasAppAccess } from '@/lib/permissions'
import { GROUPS_PATH, USERS_PATH, settingsPath } from '@/lib/routes'
import { cn } from '@/lib/utils'

export type AppShellContext = {
  client: ChatClient
  managementClient: ManagementClient
  permissions: ReadonlySet<string>
  accountLabel: string | null
  accountName: string | null
  accountEmail: string | null
  accountRole: string | null
  onUnauthorized: () => void
  onSignOut: () => void
  projectUrl?: string | null
  canCreateAgent: boolean
  openCreateAgent: () => void
}

type AppShellProps = {
  client: ChatClient
  managementClient: ManagementClient
  permissions: ReadonlySet<string>
  accountLabel: string | null
  accountName: string | null
  accountEmail: string | null
  accountRole: string | null
  onUnauthorized: () => void
  onSignOut: () => void
  projectUrl?: string | null
}

function Logo() {
  return (
    <span className="flex size-9 items-center justify-center rounded-full bg-primary font-serif text-sm text-primary-foreground">
      E
    </span>
  )
}

function initials(label: string | null): string {
  if (!label) {
    return '?'
  }
  return label
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

type NavItem = {
  to: string
  label: string
  icon: ReactNode
  active: (pathname: string) => boolean
}

function useNavItems(canManageDirectory: boolean): NavItem[] {
  const { lastChatPath } = useChat()
  return [
    {
      to: lastChatPath,
      label: 'Chat',
      icon: <MessageSquare className="size-5" aria-hidden />,
      active: (pathname) => pathname.startsWith('/chat') || pathname.startsWith('/agents/'),
    },
    {
      to: canManageDirectory ? USERS_PATH : GROUPS_PATH,
      label: 'Users',
      icon: <Users className="size-5" aria-hidden />,
      active: (pathname) =>
        pathname.startsWith(USERS_PATH) ||
        pathname.startsWith(GROUPS_PATH) ||
        pathname.startsWith('/directory'),
    },
  ]
}

function AccountIdentity({
  accountName,
  accountEmail,
  accountRole,
}: {
  accountName: string | null
  accountEmail: string | null
  accountRole: string | null
}) {
  const name = accountName ?? accountEmail ?? 'Signed in'
  return (
    <div className="min-w-0 px-2.5 py-2">
      <p className="truncate text-sm font-medium">{name}</p>
      {accountEmail ? (
        <p className="truncate text-xs text-muted-foreground">{accountEmail}</p>
      ) : null}
      {accountRole ? <p className="truncate text-xs text-muted-foreground">{accountRole}</p> : null}
    </div>
  )
}

function AccountMenu({
  accountLabel,
  accountName,
  accountEmail,
  accountRole,
  onSignOut,
}: {
  accountLabel: string | null
  accountName: string | null
  accountEmail: string | null
  accountRole: string | null
  onSignOut: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const label = accountLabel ?? 'Signed in'

  useEffect(() => {
    if (!open) {
      return
    }
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div ref={rootRef} className="relative mt-auto">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={label}
        onClick={() => setOpen((current) => !current)}
        className="flex size-9 items-center justify-center rounded-full border border-border bg-muted text-xs font-medium hover:bg-muted/70"
      >
        {initials(accountLabel)}
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              setOpen(false)
              buttonRef.current?.focus()
            }
          }}
          className="absolute bottom-0 left-full z-30 ml-2 w-72 rounded-2xl border border-border bg-card p-1 shadow-lg"
        >
          <AccountIdentity
            accountName={accountName}
            accountEmail={accountEmail}
            accountRole={accountRole}
          />
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm hover:bg-muted"
            onClick={() => {
              setOpen(false)
              onSignOut()
            }}
          >
            <LogOut className="size-4 text-muted-foreground" aria-hidden />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  )
}

function DesktopRail({
  accountLabel,
  accountName,
  accountEmail,
  accountRole,
  onSignOut,
  canCreateAgent,
  onCreateAgent,
  canManageDirectory,
}: {
  accountLabel: string | null
  accountName: string | null
  accountEmail: string | null
  accountRole: string | null
  onSignOut: () => void
  canCreateAgent: boolean
  onCreateAgent: () => void
  canManageDirectory: boolean
}) {
  const items = useNavItems(canManageDirectory)
  const { lastChatPath } = useChat()
  const { pathname } = useLocation()
  return (
    <nav
      aria-label="Primary"
      className="relative z-30 hidden w-16 shrink-0 flex-col items-center gap-1 border-r border-border bg-card py-4 md:flex"
    >
      <Link to={lastChatPath} aria-label="Home: Chat" className="mb-4">
        <Logo />
      </Link>
      {items.map((item) => {
        const active = item.active(pathname)
        return (
          <Link
            key={item.label}
            to={item.to}
            aria-label={item.label}
            title={item.label}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex size-10 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground',
              active && 'bg-primary-soft text-primary',
            )}
          >
            {item.icon}
          </Link>
        )
      })}
      {canCreateAgent ? (
        <IconButton label="Create agent" className="mt-2" onClick={onCreateAgent}>
          <Plus className="size-4" aria-hidden />
        </IconButton>
      ) : null}
      <AccountMenu
        accountLabel={accountLabel}
        accountName={accountName}
        accountEmail={accountEmail}
        accountRole={accountRole}
        onSignOut={onSignOut}
      />
    </nav>
  )
}

function MobileDrawerNav({
  onNavigate,
  accountName,
  accountEmail,
  accountRole,
  onSignOut,
  canCreateAgent,
  onCreateAgent,
  canManageDirectory,
}: {
  onNavigate: () => void
  accountName: string | null
  accountEmail: string | null
  accountRole: string | null
  onSignOut: () => void
  canCreateAgent: boolean
  onCreateAgent: () => void
  canManageDirectory: boolean
}) {
  const items = useNavItems(canManageDirectory)
  const { pathname } = useLocation()
  return (
    <div className="flex h-full flex-col">
      <nav aria-label="Primary" className="flex gap-1 border-b border-border px-3 py-2">
        {items.map((item) => {
          const active = item.active(pathname)
          return (
            <Link
              key={item.label}
              to={item.to}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2 text-xs font-medium text-muted-foreground hover:bg-muted',
                active && 'bg-primary-soft text-primary',
              )}
            >
              {item.icon}
              {item.label}
            </Link>
          )
        })}
      </nav>
      {canCreateAgent ? (
        <div className="border-b border-border px-3 py-2">
          <Button
            type="button"
            size="sm"
            className="w-full"
            onClick={() => {
              onNavigate()
              onCreateAgent()
            }}
          >
            <Plus className="size-4" aria-hidden />
            Create agent
          </Button>
        </div>
      ) : null}
      <div className="mt-auto border-t border-border px-4 py-3">
        <AccountIdentity
          accountName={accountName}
          accountEmail={accountEmail}
          accountRole={accountRole}
        />
        <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </div>
  )
}

export function MobileTopBar({
  title,
  subtitle,
  actions,
  drawerContent,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  drawerContent?: ReactNode
}) {
  const {
    accountName,
    accountEmail,
    accountRole,
    onSignOut,
    canCreateAgent,
    openCreateAgent,
    permissions,
  } = useAppShell()
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const titleId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const node = dialogRef.current
    if (!node) {
      return
    }
    if (open && !node.open) {
      node.showModal()
    } else if (!open && node.open) {
      node.close()
    }
  }, [open])

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2 md:hidden">
      <IconButton
        label={drawerContent ? 'Open conversations and navigation' : 'Open navigation'}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="border-transparent"
      >
        <Menu className="size-5" aria-hidden />
      </IconButton>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        {subtitle ? <div className="truncate text-xs text-muted-foreground">{subtitle}</div> : null}
      </div>
      {actions}
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="m-0 h-svh max-h-svh w-[min(100%,20rem)] max-w-none rounded-none border-0 bg-card p-0 text-foreground shadow-2xl open:fixed open:inset-y-0 open:left-0 open:flex open:flex-col"
        onCancel={(event) => {
          event.preventDefault()
          setOpen(false)
        }}
      >
        {open ? (
          <>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 id={titleId} className="font-serif text-lg">
                Menu
              </h2>
              <IconButton label="Close menu" onClick={() => setOpen(false)}>
                <X className="size-4" aria-hidden />
              </IconButton>
            </div>
            <MobileDrawerNav
              onNavigate={() => setOpen(false)}
              accountName={accountName}
              accountEmail={accountEmail}
              accountRole={accountRole}
              onSignOut={onSignOut}
              canCreateAgent={canCreateAgent}
              onCreateAgent={openCreateAgent}
              canManageDirectory={permissions.has(AGENT_ACCESS_MANAGE)}
            />
            <div className="min-h-0 flex-1 overflow-y-auto">{drawerContent}</div>
          </>
        ) : null}
      </dialog>
    </div>
  )
}

export function PageFrame({
  mobileTitle,
  children,
}: {
  mobileTitle: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <MobileTopBar title={mobileTitle} />
      <div className="@container min-h-0 min-w-0 flex-1 overflow-y-auto scroll-pt-4">
        {children}
      </div>
    </div>
  )
}

function CreateAgentDialog({
  open,
  managementClient,
  onUnauthorized,
  onClose,
  onCreated,
}: {
  open: boolean
  managementClient: ManagementClient
  onUnauthorized: () => void
  onClose: () => void
  onCreated: (agent: AgentRecord) => void
}) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const node = dialogRef.current
    if (!node) {
      return
    }
    if (open && !node.open) {
      node.showModal()
    } else if (!open && node.open) {
      node.close()
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setId('')
      setName('')
      setDescription('')
      setError(null)
      setCreating(false)
    }
  }, [open])

  async function submit() {
    if (creating) {
      return
    }
    const trimmedId = id.trim()
    if (!trimmedId || !name.trim()) {
      setError('Agent ID and name are required.')
      return
    }
    setCreating(true)
    setError(null)
    try {
      const created = await managementClient.createAgent({
        id: trimmedId,
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
      })
      onCreated(created)
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        onUnauthorized()
        return
      }
      setError(isApiError(caught) ? caught.message : 'Could not create the agent.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="m-auto max-h-[calc(100svh-2rem)] w-[calc(100%-1.5rem)] max-w-lg rounded-3xl border border-border bg-card p-0 text-foreground shadow-2xl"
      onCancel={(event) => {
        event.preventDefault()
        if (!creating) {
          onClose()
        }
      }}
    >
      {open ? (
        <div className="flex max-h-[inherit] flex-col">
          <div className="border-b border-border px-6 pt-6 pb-4">
            <h2 id={titleId} className="font-serif text-2xl">
              Create agent
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              You receive view, configure, and execute access for the new agent.
            </p>
          </div>
          <div className="space-y-4 px-6 py-5">
            {error ? <Notice tone="error">{error}</Notice> : null}
            <TextField label="Agent ID" value={id} onChange={setId} mono required autoFocus />
            <TextField label="Name" value={name} onChange={setName} required />
            <TextArea
              label="Description"
              value={description}
              onChange={setDescription}
              rows={3}
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-border px-6 py-4">
            <Button type="button" variant="outline" disabled={creating} onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" disabled={creating} onClick={() => void submit()}>
              {creating ? 'Creating…' : 'Create agent'}
            </Button>
          </div>
        </div>
      ) : null}
    </dialog>
  )
}

export function AppShell({
  client,
  managementClient,
  permissions,
  accountLabel,
  accountName,
  accountEmail,
  accountRole,
  onUnauthorized,
  onSignOut,
  projectUrl,
}: AppShellProps) {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const canCreateAgent =
    permissions.has(AGENTS_CONFIGURE) && permissions.has(AGENT_ACCESS_MANAGE)
  const openCreateAgent = () => setCreating(true)

  const context: AppShellContext = {
    client,
    managementClient,
    permissions,
    accountLabel,
    accountName,
    accountEmail,
    accountRole,
    onUnauthorized,
    onSignOut,
    projectUrl,
    canCreateAgent,
    openCreateAgent,
  }

  return (
    <ChatProvider client={client} onUnauthorized={onUnauthorized}>
      <div className="flex h-svh flex-col">
        <div className="flex min-h-0 flex-1">
          {hasAppAccess(permissions) ? (
            <DesktopRail
              accountLabel={accountLabel}
              accountName={accountName}
              accountEmail={accountEmail}
              accountRole={accountRole}
              onSignOut={onSignOut}
              canCreateAgent={canCreateAgent}
              onCreateAgent={openCreateAgent}
              canManageDirectory={permissions.has(AGENT_ACCESS_MANAGE)}
            />
          ) : null}
          <main className="flex min-w-0 flex-1 flex-col">
            <Outlet context={context} />
          </main>
        </div>
        <CreateAgentDialog
          open={creating}
          managementClient={managementClient}
          onUnauthorized={onUnauthorized}
          onClose={() => setCreating(false)}
          onCreated={(agent) => {
            setCreating(false)
            void navigate(settingsPath(agent.id, 'configuration'))
          }}
        />
      </div>
    </ChatProvider>
  )
}

