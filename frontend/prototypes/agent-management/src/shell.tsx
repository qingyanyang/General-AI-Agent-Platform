/** PROTOTYPE shell: Chat and combined Users / Groups directory. */
import { FlaskConical, LogOut, Menu, MessageSquare, UserRound, Users } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { cn } from '@/lib/utils'

import { ControlsPanel } from './controls-panel'
import { CreateAgentDialog } from './dialogs'
import { ShellActionsContext, useCatalog, useChat, usePermissions } from './hooks'
import { useDataKey } from './mock/options'
import { renameSignedInUser } from './mock/users-state'
import { CatalogProvider, ChatProvider, UnsavedProvider } from './providers'
import { DIRECTORY_PATH, GROUPS_PATH, USERS_PATH, settingsPath } from './routes'
import { Button, Dialog, IconButton, TextField } from './ui'

type NavItem = { to: string; label: string; icon: ReactNode; active: (pathname: string) => boolean }

function useNavItems(): NavItem[] {
  const { canBrowsePeople, canOpenUserDetails, canManageAccess } = usePermissions()
  const { lastChatPath } = useChat()
  const items: NavItem[] = [
    {
      to: lastChatPath,
      label: 'Chat',
      icon: <MessageSquare className="size-5" aria-hidden />,
      active: (pathname) => pathname.startsWith('/chat') || pathname.startsWith('/agents/'),
    },
  ]
  const canOpenDirectory = canBrowsePeople || canOpenUserDetails || canManageAccess
  if (canOpenDirectory) {
    items.push({
      to: canBrowsePeople || canOpenUserDetails ? USERS_PATH : GROUPS_PATH,
      label: 'Users',
      icon: <Users className="size-5" aria-hidden />,
      active: (pathname) =>
        pathname.startsWith(USERS_PATH) ||
        pathname.startsWith(GROUPS_PATH) ||
        pathname.startsWith(DIRECTORY_PATH),
    })
  }
  return items
}

function Logo() {
  return (
    <span className="flex size-9 items-center justify-center rounded-full bg-primary font-serif text-sm text-primary-foreground">
      E
    </span>
  )
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function Rail({ onSignOut }: { onSignOut: () => void }) {
  const items = useNavItems()
  const { pathname } = useLocation()
  return (
    <nav
      aria-label="Primary"
      className="relative z-30 hidden w-16 shrink-0 flex-col items-center gap-1 border-r border-border bg-card py-4 md:flex"
    >
      <Link to={items[0].to} aria-label="Home: Chat" className="mb-4">
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
      <AccountMenu onSignOut={onSignOut} />
    </nav>
  )
}

function AccountMenu({ onSignOut }: { onSignOut: () => void }) {
  const { persona } = usePermissions()
  const [open, setOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [name, setName] = useState(persona.displayName)
  const [nameError, setNameError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!profileOpen) {
      return
    }
    document.querySelector<HTMLInputElement>('dialog[open] input')?.focus()
  }, [profileOpen])

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
        title={persona.displayName}
        onClick={() => setOpen((current) => !current)}
        className="flex size-9 items-center justify-center rounded-full border border-border bg-muted text-xs font-medium hover:bg-muted/70"
      >
        {initials(persona.displayName)}
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
          className="absolute bottom-0 left-full z-30 ml-2 w-60 rounded-2xl border border-border bg-card p-1 shadow-lg"
        >
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-xs font-medium"
            >
              {initials(persona.displayName)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{persona.displayName}</span>
              <span className="block truncate text-xs text-muted-foreground">{persona.label}</span>
            </span>
          </div>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm hover:bg-muted"
            onClick={() => {
              setName(persona.displayName)
              setNameError(null)
              setOpen(false)
              setProfileOpen(true)
            }}
          >
            <UserRound className="size-4 text-muted-foreground" aria-hidden />
            Profile
          </button>
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
      <Dialog
        open={profileOpen}
        onRequestClose={() => setProfileOpen(false)}
        title="Profile"
        description={persona.label}
        footer={
          <>
            <Button variant="outline" onClick={() => setProfileOpen(false)}>Cancel</Button>
            <Button
              disabled={!name.trim() || name.trim() === persona.displayName}
              onClick={() => {
                try {
                  renameSignedInUser(persona.userId, name)
                  setProfileOpen(false)
                } catch (caught) {
                  setNameError(caught instanceof Error ? caught.message : 'Could not update the name.')
                }
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <TextField label="Name" value={name} onChange={setName} required autoFocus />
        {nameError ? <p className="text-sm text-danger">{nameError}</p> : null}
      </Dialog>
    </div>
  )
}

function SignedOut({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card px-6 py-8 text-center">
        <h1 className="font-serif text-2xl">Signed out</h1>
        <p className="mt-2 text-sm text-muted-foreground">This prototype session is cleared until you sign in again.</p>
        <Button className="mt-5" onClick={onSignIn}>Sign in</Button>
      </div>
    </div>
  )
}

function DrawerNav({ onNavigate }: { onNavigate: () => void }) {
  const items = useNavItems()
  const { pathname } = useLocation()
  return (
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
  )
}

/**
 * Mobile-only top bar. The drawer holds primary navigation and, on chat
 * screens, the agent picker and conversation list.
 */
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
  const [open, setOpen] = useState(false)
  const { persona } = usePermissions()
  const location = useLocation()

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

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
      <Dialog open={open} onRequestClose={() => setOpen(false)} title="Menu" variant="nav">
        <DrawerNav onNavigate={() => setOpen(false)} />
        <div className="min-h-0 flex-1 overflow-y-auto">{drawerContent}</div>
        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          Signed in as {persona.displayName} ({persona.label})
        </p>
      </Dialog>
    </div>
  )
}

/** Scrollable page body for non-chat screens, with the mobile bar on top. */
export function PageFrame({ mobileTitle, children }: { mobileTitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <MobileTopBar title={mobileTitle} />
      <div className="@container min-h-0 min-w-0 flex-1 scroll-pt-4 scroll-pb-28 overflow-y-auto">{children}</div>
    </div>
  )
}

function PrototypeBanner() {
  const [open, setOpen] = useState(false)
  const { persona } = usePermissions()
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-foreground px-4 py-1.5 text-xs text-background">
      <p className="flex min-w-0 items-center gap-2">
        <FlaskConical className="size-3.5 shrink-0" aria-hidden />
        <span className="font-semibold tracking-wide">PROTOTYPE</span>
        <span className="hidden sm:inline">
          Three-role auth · group leadership · mock data · no API calls
        </span>
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-background/30 px-3 py-0.5 font-medium hover:bg-background/10"
      >
        {persona.displayName} · {persona.label} · Demo controls
      </button>
      <ControlsPanel open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

/** Remounts the whole shell when the persona, scenario, or mock data reset changes. */
export function PrototypeRoot() {
  const dataKey = useDataKey()
  return <Shell key={dataKey} />
}

function Shell() {
  const [creating, setCreating] = useState(false)
  return (
    <UnsavedProvider>
      <CatalogProvider>
        <ChatProvider>
          <ShellActionsContext.Provider value={{ openCreateAgent: () => setCreating(true) }}>
            <ShellBody />
            <CreateAgentFlow open={creating} onClose={() => setCreating(false)} />
          </ShellActionsContext.Provider>
        </ChatProvider>
      </CatalogProvider>
    </UnsavedProvider>
  )
}

function CreateAgentFlow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const catalog = useCatalog()
  const navigate = useNavigate()
  return (
    <CreateAgentDialog
      open={open}
      onClose={onClose}
      onCreated={(agent) => {
        catalog.upsert(agent)
        onClose()
        navigate(settingsPath(agent.id, 'configuration'), {
          state: { skipUnsavedGuard: true, created: true },
        })
      }}
    />
  )
}

function ShellBody() {
  const [signedOut, setSignedOut] = useState(false)
  return (
    <div className="flex h-svh flex-col">
      <PrototypeBanner />
      <div className="flex min-h-0 flex-1">
        <Rail onSignOut={() => setSignedOut(true)} />
        <main className="flex min-w-0 flex-1 flex-col">
          {signedOut ? <SignedOut onSignIn={() => setSignedOut(false)} /> : <Outlet />}
        </main>
      </div>
    </div>
  )
}
