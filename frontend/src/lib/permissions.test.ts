import { permissionsFromToken } from '@/lib/permissions'

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

  it('returns an empty set for a missing, malformed, or non-array claim', () => {
    expect(permissionsFromToken('')).toEqual(new Set())
    expect(permissionsFromToken('not-a-jwt')).toEqual(new Set())
    expect(permissionsFromToken('aaa.###.sig')).toEqual(new Set())
    expect(permissionsFromToken(token('agents:read'))).toEqual(new Set())
    expect(permissionsFromToken(token({ permissions: 'agents:read' }))).toEqual(new Set())
    expect(permissionsFromToken(token({}))).toEqual(new Set())
  })
})
