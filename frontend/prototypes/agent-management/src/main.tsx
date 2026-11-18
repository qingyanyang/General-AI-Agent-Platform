/**
 * PROTOTYPE entry: Chat-first workspace with a combined Users / Groups directory.
 * Throwaway UI exploration with in-memory mock data. Not imported by the production app.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider, useParams } from 'react-router-dom'

import { ChatPage } from './pages/chat'
import { DirectoryIndex, DirectoryLayout } from './pages/directory-layout'
import { GroupDetailPage, GroupsPage } from './pages/groups'
import { AgentSettingsPage } from './pages/settings'
import { NotFoundPage } from './pages/simple-pages'
import { UserDetailPage, UsersPage } from './pages/users'
import { groupPath, userPath } from './routes'
import { PrototypeRoot } from './shell'
import './styles.css'

function LegacyAdminUserRedirect() {
  const { userId = '', section } = useParams<{ userId: string; section?: string }>()
  if (!userId) {
    return <Navigate to="/users" replace />
  }
  return (
    <Navigate
      replace
      to={section === 'usage' ? userPath(userId, 'usage') : userPath(userId, 'access')}
    />
  )
}

function LegacyAdminGroupRedirect() {
  const { groupId = '' } = useParams<{ groupId: string }>()
  return <Navigate replace to={groupId ? groupPath(groupId) : '/groups'} />
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <PrototypeRoot />,
    children: [
      { index: true, element: <Navigate to="/chat" replace /> },
      { path: 'chat/:agentId?/:sessionId?', element: <ChatPage /> },
      {
        element: <DirectoryLayout />,
        children: [
          { path: 'directory', element: <DirectoryIndex /> },
          { path: 'users', element: <UsersPage /> },
          { path: 'groups', element: <GroupsPage /> },
        ],
      },
      { path: 'users/:userId/:section?', element: <UserDetailPage /> },
      { path: 'groups/:groupId', element: <GroupDetailPage /> },
      { path: 'agents/:agentId/settings/:section?', element: <AgentSettingsPage /> },
      { path: 'tools', element: <Navigate to="/chat" replace /> },
      { path: 'people', element: <Navigate to="/users" replace /> },
      { path: 'history', element: <Navigate to="/chat" replace /> },
      { path: 'admin', element: <Navigate to="/directory" replace /> },
      { path: 'admin/users', element: <Navigate to="/users" replace /> },
      { path: 'admin/users/:userId/:section?', element: <LegacyAdminUserRedirect /> },
      { path: 'admin/groups', element: <Navigate to="/groups" replace /> },
      { path: 'admin/groups/:groupId', element: <LegacyAdminGroupRedirect /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
