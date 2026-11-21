import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ConfigureExtras } from '@/components/manage/configuration-form'

describe('ConfigureExtras', () => {
  it('hides MCP connections unless the caller can edit technical settings', () => {
    const { rerender } = render(<ConfigureExtras saving={false} />)

    expect(screen.queryByRole('heading', { name: 'MCP Connections' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add connection' })).not.toBeInTheDocument()

    rerender(<ConfigureExtras saving={false} showConnections />)

    expect(screen.getByRole('heading', { name: 'MCP Connections' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add connection' })).toBeInTheDocument()
  })
})
