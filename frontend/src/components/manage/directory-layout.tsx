/** Users and Groups share one page with section tabs, matching the prototype directory. */
import { User, Users } from 'lucide-react'
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'

import { PageFrame } from '@/components/shell/app-shell'
import { useAppShell } from '@/components/shell/use-app-shell'
import { AGENT_ACCESS_MANAGE } from '@/lib/permissions'
import { GROUPS_PATH, USERS_PATH } from '@/lib/routes'
import { cn } from '@/lib/utils'

export function DirectoryLayout() {
  const shell = useAppShell()
  const { permissions } = shell
  const location = useLocation()
  const canSeeUsers = permissions.has(AGENT_ACCESS_MANAGE)
  const onUsersList = location.pathname === USERS_PATH
  const onGroupsList = location.pathname === GROUPS_PATH
  const title = canSeeUsers ? 'Users & groups' : 'Groups'

  if (location.pathname.startsWith(USERS_PATH) && !canSeeUsers) {
    return <Navigate replace to={GROUPS_PATH} />
  }

  return (
    <PageFrame mobileTitle={title}>
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-5xl px-4 pt-5 sm:px-8 sm:pt-6">
          <h1 className={cn('font-serif text-3xl sm:text-4xl', !canSeeUsers && 'pb-5')}>{title}</h1>
          {canSeeUsers ? (
            <nav aria-label="Directory sections" className="-mb-px mt-5 flex gap-1 overflow-x-auto">
              <NavLink
                to={USERS_PATH}
                end
                className={() =>
                  cn(
                    'inline-flex shrink-0 items-center gap-2 border-b-2 px-2.5 pt-2 pb-3 text-sm font-medium whitespace-nowrap sm:px-3',
                    onUsersList
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )
                }
              >
                <User className="size-4" aria-hidden />
                Users
              </NavLink>
              <NavLink
                to={GROUPS_PATH}
                end
                className={() =>
                  cn(
                    'inline-flex shrink-0 items-center gap-2 border-b-2 px-2.5 pt-2 pb-3 text-sm font-medium whitespace-nowrap sm:px-3',
                    onGroupsList
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )
                }
              >
                <Users className="size-4" aria-hidden />
                Groups
              </NavLink>
            </nav>
          ) : null}
        </div>
      </header>
      <Outlet context={shell} />
    </PageFrame>
  )
}

export function DirectoryIndex() {
  const { permissions } = useAppShell()
  return <Navigate replace to={permissions.has(AGENT_ACCESS_MANAGE) ? USERS_PATH : GROUPS_PATH} />
}
