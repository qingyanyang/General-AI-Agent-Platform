export type AuthConfig = {
  domain: string
  clientId: string
  audience: string
}

type AuthEnv = {
  VITE_AUTH0_DOMAIN?: string
  VITE_AUTH0_CLIENT_ID?: string
  VITE_AUTH0_AUDIENCE?: string
}

function hostnameOnly(domain: string): boolean {
  return domain.length > 0 && !domain.includes('://') && !domain.includes('/') && !domain.includes(' ')
}

export function readAuthConfig(env: AuthEnv = import.meta.env): AuthConfig | null {
  const domain = env.VITE_AUTH0_DOMAIN?.trim() ?? ''
  const clientId = env.VITE_AUTH0_CLIENT_ID?.trim() ?? ''
  const audience = env.VITE_AUTH0_AUDIENCE?.trim() ?? ''
  if (!hostnameOnly(domain) || !clientId || !audience) {
    return null
  }
  return { domain, clientId, audience }
}
