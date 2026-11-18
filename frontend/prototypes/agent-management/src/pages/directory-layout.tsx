/** PROTOTYPE: Users and Groups share one page with section tabs. */
import { User, Users } from 'lucide-react'
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'

import { cn } from '@/lib/utils'

import { usePermissions } from '../hooks'
import { GROUPS_PATH, USERS_PATH } from '../routes'
import { PageFrame } from '../shell'
import { Notice } from '../ui'

export function DirectoryLayout() {
  const { canOpenUserDetails, canManageAccess, canBrowsePeople } = usePermissions()
  const location = useLocation()
  const canSeeGroups = canManageAccess || canBrowsePeople
  const canSeeUsers = canBrowsePeople || canOpenUserDetails

  if (!canSeeUsers && !canSeeGroups) {
    return (
      <PageFrame mobileTitle="Users">
        <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
          <Notice tone="warning" title="Access denied">
            Users and groups aren’t available for your role.
            <div className="mt-3">
              <Link to="/chat" className="font-medium text-primary underline-offset-4 hover:underline">
                Back to chat
              </Link>
            </div>
          </Notice>
        </div>
      </PageFrame>
    )
  }

  const onUsersList = location.pathname === USERS_PATH
  const onGroupsList = location.pathname === GROUPS_PATH
  const hasTabs = canSeeUsers && canSeeGroups
  const title = hasTabs ? 'Users & groups' : canSeeUsers ? 'Users' : 'Groups'

  if (location.pathname.startsWith(USERS_PATH) && !canSeeUsers) {
    return <Navigate replace to={GROUPS_PATH} />
  }
  if (location.pathname.startsWith(GROUPS_PATH) && !canSeeGroups) {
    return <Navigate replace to={canSeeUsers ? USERS_PATH : '/chat'} />
  }

  return (
    <PageFrame mobileTitle={title}>
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-5xl px-4 pt-5 sm:px-8 sm:pt-6">
          <h1 className={cn('font-serif text-3xl sm:text-4xl', !hasTabs && 'pb-5')}>
            {title}
          </h1>
          {hasTabs ? (
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
      <Outlet />
    </PageFrame>
  )
}

/** Landing route: Users list for everyone who can browse; otherwise Groups. */
export function DirectoryIndex() {
  const { canBrowsePeople, canOpenUserDetails, canManageAccess } = usePermissions()
  if (canBrowsePeople || canOpenUserDetails) {
    return <Navigate replace to={USERS_PATH} />
  }
  if (canManageAccess) {
    return <Navigate replace to={GROUPS_PATH} />
  }
  return <Navigate replace to="/chat" />
}
