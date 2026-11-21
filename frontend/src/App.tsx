import { useAuth0 } from '@auth0/auth0-react'
import { ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { Workspace } from '@/components/chat/workspace'
import { AgentSettingsPage } from '@/components/manage/agent-settings-page'
import { AgentsListPage } from '@/components/manage/agents-list-page'
import { GroupDetailPage } from '@/components/manage/group-detail-page'
import { DirectoryIndex, DirectoryLayout } from '@/components/manage/directory-layout'
import { GroupsPage } from '@/components/manage/groups-page'
import { UserDetailPage } from '@/components/manage/user-detail-page'
import { UsersPage } from '@/components/manage/users-page'
import { AppShell } from '@/components/shell/app-shell'
import { useAppShell } from '@/components/shell/use-app-shell'
import { Button } from '@/components/ui/button'
import { EmptyState, LoadingRows } from '@/components/ui/primitives'
import { createChatClient, apiBaseUrl, apiUrl } from '@/lib/api'
import { readAuthConfig } from '@/lib/auth-config'
import { ApiError } from '@/lib/errors'
import { createManagementClient } from '@/lib/management'
import { accountRole, hasAppAccess, permissionsFromToken } from '@/lib/permissions'

type HealthState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; detail: string }
  | { status: 'error'; detail: string }

function ConfigurationScreen() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium tracking-[0.18em] text-primary uppercase">
        Enterprise AI Agent Platform
      </p>
      <h1 className="mt-4 font-serif text-3xl tracking-tight">Auth0 is not configured</h1>
      <p className="mt-4 text-muted-foreground">
        Set <code>VITE_AUTH0_DOMAIN</code> (hostname only), <code>VITE_AUTH0_CLIENT_ID</code>,
        and <code>VITE_AUTH0_AUDIENCE</code> before using protected routes.
      </p>
    </main>
  )
}

function HealthStatus() {
  const [health, setHealth] = useState<HealthState>({ status: 'idle' })

  useEffect(() => {
    if (!apiBaseUrl) {
      return
    }
    const controller = new AbortController()
    async function checkHealth() {
      setHealth({ status: 'loading' })
      try {
        const response = await fetch(apiUrl('/health'), { signal: controller.signal })
        if (!response.ok) {
          setHealth({ status: 'error', detail: `HTTP ${response.status}` })
          return
        }
        const body = (await response.json().catch(() => null)) as { status?: string } | null
        setHealth({ status: 'ok', detail: body?.status ?? 'reachable' })
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }
        setHealth({
          status: 'error',
          detail: error instanceof Error ? error.message : 'Request failed',
        })
      }
    }
    void checkHealth()
    return () => controller.abort()
  }, [])

  const detail =
    health.status === 'idle'
      ? 'skipped (no API URL)'
      : health.status === 'loading'
        ? 'checking…'
        : health.status === 'ok'
          ? `ok · ${health.detail}`
          : `error · ${health.detail}`

  return <p className="mt-8 font-mono text-sm text-muted-foreground">/health · {detail}</p>
}

function SignInScreen() {
  const { loginWithRedirect, isLoading, error } = useAuth0()

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium tracking-[0.18em] text-primary uppercase">
        Enterprise AI Agent Platform
      </p>
      <h1 className="mt-4 font-serif text-4xl tracking-tight">Sign in to chat with your agents</h1>
      <p className="mt-4 text-muted-foreground">
        Use your organization account. The app requests an access token for the platform API.
      </p>
      {error ? (
        <p className="mt-4 text-sm" role="alert">
          {error.message}
        </p>
      ) : null}
      <div className="mt-8">
        <Button type="button" disabled={isLoading} onClick={() => void loginWithRedirect()}>
          Sign in
        </Button>
      </div>
      <HealthStatus />
    </main>
  )
}

function VerifyEmailScreen({ email, onSignOut }: { email?: string; onSignOut: () => void }) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium tracking-[0.18em] text-primary uppercase">
        Enterprise AI Agent Platform
      </p>
      <h1 className="mt-4 font-serif text-4xl tracking-tight">Verify your email</h1>
      <p className="mt-4 text-muted-foreground">
        {email ? `${email} is not verified.` : 'This account’s email is not verified.'} Open the
        message from Auth0, then sign in again. Unverified addresses cannot use the app.
      </p>
      <div className="mt-8">
        <Button type="button" variant="outline" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </main>
  )
}

function NoAccessScreen() {
  const { accountEmail, onSignOut } = useAppShell()
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <EmptyState
          icon={<ShieldAlert className="size-6" aria-hidden />}
          title="You don't have access yet"
          action={
            <Button type="button" variant="outline" onClick={onSignOut}>
              Sign out
            </Button>
          }
        >
          <span className="block">
            {accountEmail ? `${accountEmail} is signed in` : 'This account is signed in'}, but it
            is not assigned to this app.
          </span>
          <span className="mt-2 block">Ask an admin to give you access, then sign in again.</span>
        </EmptyState>
      </div>
    </div>
  )
}

function AuthenticatedApp() {
  const auth = readAuthConfig()
  const { isLoading, isAuthenticated, logout, getAccessTokenSilently, user } = useAuth0()
  const audience = auth?.audience ?? ''

  const getAccessToken = useCallback(async (cacheMode?: 'off') => {
    try {
      const token = await getAccessTokenSilently({
        authorizationParams: { audience },
        cacheMode: cacheMode ?? 'on',
      })
      if (!token) {
        throw new ApiError(401, 'Sign in again.')
      }
      return token
    } catch (error) {
      if (error instanceof ApiError) {
        throw error
      }
      throw new ApiError(401, 'Sign in again.')
    }
  }, [audience, getAccessTokenSilently])

  const client = useMemo(() => createChatClient(getAccessToken), [getAccessToken])
  const managementClient = useMemo(
    () => createManagementClient(getAccessToken),
    [getAccessToken],
  )
  const [access, setAccess] = useState<{
    ready: boolean
    permissions: ReadonlySet<string>
  }>({ ready: false, permissions: new Set() })

  useEffect(() => {
    if (!isAuthenticated) {
      return
    }
    let cancelled = false
    setAccess((current) => ({ ...current, ready: false }))
    void getAccessToken()
      .then((token) => {
        if (!cancelled) {
          setAccess({ ready: true, permissions: permissionsFromToken(token) })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAccess({ ready: true, permissions: new Set() })
        }
      })
    return () => {
      cancelled = true
    }
  }, [getAccessToken, isAuthenticated])

  if (isLoading || (isAuthenticated && !access.ready)) {
    return (
      <main className="flex min-h-svh items-center justify-center px-6">
        <div className="w-full max-w-md">
          <LoadingRows label="Checking your session" rows={3} />
        </div>
      </main>
    )
  }

  if (!isAuthenticated || !auth) {
    return <SignInScreen />
  }

  if (!user) {
    return (
      <main className="flex min-h-svh items-center justify-center px-6">
        <div className="w-full max-w-md">
          <LoadingRows label="Checking your session" rows={3} />
        </div>
      </main>
    )
  }

  if (user.email_verified !== true) {
    return (
      <VerifyEmailScreen
        email={user.email}
        onSignOut={() => {
          void logout({ logoutParams: { returnTo: window.location.origin } })
        }}
      />
    )
  }

  const accountEmail = user?.email?.trim() || null
  const givenName = [user?.given_name, user?.family_name]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(' ')
  const profileName = user?.name?.trim() || null
  const emailName = accountEmail?.split('@')[0]?.trim() || null
  const accountName =
    givenName ||
    (profileName && profileName.toLowerCase() !== accountEmail?.toLowerCase() ? profileName : null) ||
    emailName
  const accountLabel = accountName ?? accountEmail
  const onUnauthorized = () => {
    void logout({ logoutParams: { returnTo: window.location.origin } })
  }
  const onSignOut = () => {
    void logout({ logoutParams: { returnTo: window.location.origin } })
  }
  const permissions = access.permissions
  const allowed = hasAppAccess(permissions)

  return (
    <Routes>
      <Route
        element={
          <AppShell
            client={client}
            managementClient={managementClient}
            permissions={permissions}
            accountLabel={accountLabel}
            accountName={accountName}
            accountEmail={accountEmail}
            accountRole={accountRole(permissions)}
            onUnauthorized={onUnauthorized}
            onSignOut={onSignOut}
            projectUrl={import.meta.env.VITE_LANGSMITH_PROJECT_URL}
          />
        }
      >
        {allowed ? (
          <>
            <Route index element={<Navigate to="/chat" replace />} />
            <Route path="/chat/:agentId?/:sessionId?" element={<Workspace />} />
            <Route path="/agents" element={<AgentsListPage />} />
            <Route path="/agents/:agentId/settings/:section?" element={<AgentSettingsPage />} />
            <Route element={<DirectoryLayout />}>
              <Route path="/directory" element={<DirectoryIndex />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/groups" element={<GroupsPage />} />
            </Route>
            <Route path="/groups/:groupId" element={<GroupDetailPage />} />
            <Route path="/users/:userId/:section?" element={<UserDetailPage />} />
            <Route path="/manage" element={<Navigate to="/agents" replace />} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </>
        ) : (
          <Route path="*" element={<NoAccessScreen />} />
        )}
      </Route>
    </Routes>
  )
}

export default function App() {
  if (!readAuthConfig()) {
    return <ConfigurationScreen />
  }
  return <AuthenticatedApp />
}
