import {
  AGENT_ACCESS_MANAGE,
  AGENTS_CONFIGURE,
  AGENTS_EXECUTE,
  AGENTS_READ,
  PLATFORM_TECHNICAL,
  accountRole,
  hasAppAccess,
  permissionsFromToken,
} from '@/lib/permissions'

function token(payload: unknown): string {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `header.${encoded}.sig`
}

describe('permissionsFromToken', () => {
  it('returns an empty set when any permission entry is invalid', () => {
    expect(permissionsFromToken(token({ permissions: ['agents:read', 1] }))).toEqual(new Set())
    expect(permissionsFromToken(token({ permissions: ['agents:read', ''] }))).toEqual(new Set())
    expect(permissionsFromToken(token({ permissions: ['agents:read', null] }))).toEqual(new Set())
  })

  it('keeps a well-formed claim exactly, including surrounding spaces', () => {
    expect(
      permissionsFromToken(token({ permissions: ['agents:read', ' agents:configure '] })),
    ).toEqual(new Set(['agents:read', ' agents:configure ']))
  })

  it('treats a token with no platform permission as no app access', () => {
    expect(hasAppAccess(new Set())).toBe(false)
    expect(hasAppAccess(new Set(['openid', 'profile']))).toBe(false)
    expect(hasAppAccess(new Set([AGENTS_READ]))).toBe(true)
    expect(hasAppAccess(new Set([AGENTS_EXECUTE]))).toBe(true)
    expect(hasAppAccess(new Set([AGENTS_CONFIGURE]))).toBe(true)
    expect(hasAppAccess(new Set([AGENT_ACCESS_MANAGE]))).toBe(true)
    expect(hasAppAccess(new Set([PLATFORM_TECHNICAL]))).toBe(true)
  })

  it('names the platform role from the permissions in the token', () => {
    expect(accountRole(new Set())).toBeNull()
    expect(accountRole(new Set([AGENTS_READ, AGENTS_EXECUTE]))).toBe('User')
    expect(accountRole(new Set([AGENTS_READ, AGENTS_CONFIGURE, AGENT_ACCESS_MANAGE]))).toBe('Admin')
    expect(accountRole(new Set([AGENTS_EXECUTE, PLATFORM_TECHNICAL]))).toBe('Super Admin')
  })

  it('returns an empty set for a missing, malformed, or non-array claim', () => {
    expect(permissionsFromToken('')).toEqual(new Set())
    expect(permissionsFromToken('not-a-jwt')).toEqual(new Set())
    expect(permissionsFromToken('aaa.###.sig')).toEqual(new Set())
    expect(permissionsFromToken(token('agents:read'))).toEqual(new Set())
    expect(permissionsFromToken(token({ permissions: 'agents:read' }))).toEqual(new Set())
    expect(permissionsFromToken(token({}))).toEqual(new Set())
  })
})
