import { useAuth0 } from '@auth0/auth0-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Route, Routes } from 'react-router-dom'

import { Workspace } from '@/components/chat/workspace'
import { ManagementPage } from '@/components/manage/management-page'
import { Button } from '@/components/ui/button'
import { createChatClient, apiBaseUrl, apiUrl } from '@/lib/api'
import { readAuthConfig } from '@/lib/auth-config'
import { ApiError } from '@/lib/errors'
import { createManagementClient } from '@/lib/management'
import { canOpenManagement, permissionsFromToken } from '@/lib/permissions'

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
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Auth0 is not configured</h1>
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
      <h1 className="mt-4 text-4xl font-semibold tracking-tight">Sign in to chat with your agents</h1>
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

function AuthenticatedApp() {
  const auth = readAuthConfig()
  const { isLoading, isAuthenticated, logout, getAccessTokenSilently, user } = useAuth0()
  const audience = auth?.audience ?? ''

  const getAccessToken = useCallback(async () => {
    try {
      const token = await getAccessTokenSilently({
        authorizationParams: { audience },
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
  const [permissions, setPermissions] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    if (!isAuthenticated) {
      return
    }
    let cancelled = false
    void getAccessToken()
      .then((token) => {
        if (!cancelled) {
          setPermissions(permissionsFromToken(token))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPermissions(new Set())
        }
      })
    return () => {
      cancelled = true
    }
  }, [getAccessToken, isAuthenticated])

  if (isLoading) {
    return (
      <main className="flex min-h-svh items-center justify-center text-muted-foreground">
        Checking your session…
      </main>
    )
  }

  if (!isAuthenticated || !auth) {
    return <SignInScreen />
  }

  const accountLabel = user?.name ?? user?.email ?? null
  const onUnauthorized = () => {
    void logout({ logoutParams: { returnTo: window.location.origin } })
  }
  const onSignOut = () => {
    void logout({ logoutParams: { returnTo: window.location.origin } })
  }

  return (
    <Routes>
      <Route
        path="/manage"
        element={
          <ManagementPage
            client={managementClient}
            permissions={permissions}
            accountLabel={accountLabel}
            projectUrl={import.meta.env.VITE_LANGSMITH_PROJECT_URL}
            onUnauthorized={onUnauthorized}
            onSignOut={onSignOut}
          />
        }
      />
      <Route
        path="*"
        element={
          <Workspace
            client={client}
            accountLabel={accountLabel}
            showManage={canOpenManagement(permissions)}
            onUnauthorized={onUnauthorized}
            onSignOut={onSignOut}
          />
        }
      />
    </Routes>
  )
}

export default function App() {
  if (!readAuthConfig()) {
    return <ConfigurationScreen />
  }
  return <AuthenticatedApp />
}
