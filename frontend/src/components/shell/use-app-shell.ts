import { useOutletContext } from 'react-router-dom'

import type { AppShellContext } from '@/components/shell/app-shell'

export function useAppShell(): AppShellContext {
  return useOutletContext<AppShellContext>()
}
