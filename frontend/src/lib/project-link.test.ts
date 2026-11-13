import { readProjectUrl } from '@/lib/project-link'

describe('readProjectUrl', () => {
  it('accepts only absolute http and https URLs', () => {
    expect(readProjectUrl(' https://smith.example/o/acme/projects/p/agent ')).toBe(
      'https://smith.example/o/acme/projects/p/agent',
    )
    expect(readProjectUrl('http://smith.example/project')).toBe('http://smith.example/project')
  })

  it('produces no link for non-http(s) or relative values', () => {
    expect(readProjectUrl('javascript:alert(1)')).toBeNull()
    expect(readProjectUrl('data:text/plain,hi')).toBeNull()
    expect(readProjectUrl('smith.example/project')).toBeNull()
    expect(readProjectUrl('')).toBeNull()
    expect(readProjectUrl(undefined)).toBeNull()
  })
})
