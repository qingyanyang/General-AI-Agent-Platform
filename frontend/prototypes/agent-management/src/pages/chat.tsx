/** PROTOTYPE chat workspace (#53, #54): default entry, URL-driven agent and conversation selection. */
import { Bot, Loader2, Lock, MessageSquareDashed, PanelLeftClose, PanelLeftOpen, Settings2, UsersRound, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'

import type { AgentRecord } from '@/lib/management'

import { Composer } from '../chat/composer'
import { ChatSidebar } from '../chat/sidebar'
import { ApprovalCard, Transcript } from '../chat/transcript'
import type { ChatStore } from '../chat-store'
import { useAgentSettingsAccess, useCatalog, useChat, useDraftAgentIds, usePermissions } from '../hooks'
import { publishAgentDraft } from '../publish-agent-draft'
import { DIRECTORY_PATH, GROUPS_PATH, chatPath, settingsPath } from '../routes'
import { MobileTopBar } from '../shell'
import { AgentStatusBadge, Button, EmptyState, IconButton, LoadingRows, Notice } from '../ui'

export function ChatPage() {
  const { canRead } = usePermissions()
  if (!canRead) {
    return <NoChatAccess />
  }
  return <ChatWorkspace />
}

function NoChatAccess() {
  const { canBrowsePeople, canManageAccess, canOpenUserDetails } = usePermissions()
  const canOpenDirectory = canOpenUserDetails || canManageAccess || canBrowsePeople
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MobileTopBar title="Chat" />
      <div className="mx-auto w-full max-w-xl px-4 py-12 sm:py-20">
        <EmptyState icon={<Lock className="size-6" aria-hidden />} title="Chat isn’t available for your role">
          Chat lists agents you can use.
          {canOpenDirectory ? (
            <div className="mt-5 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
              <Link
                to={canOpenUserDetails ? DIRECTORY_PATH : GROUPS_PATH}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-border-strong bg-card px-4 text-sm font-medium hover:bg-muted"
              >
                <UsersRound className="size-4" aria-hidden />
                {canOpenUserDetails ? 'Users' : 'Groups'}
              </Link>
            </div>
          ) : null}
        </EmptyState>
      </div>
    </div>
  )
}

function ChatWorkspace() {
  const { agentId, sessionId } = useParams()
  const chat = useChat()
  const catalog = useCatalog()
  const location = useLocation()
  const known = agentId ? catalog.agents.find((agent) => agent.id === agentId) : undefined
  const { syncAgent, syncSession, setLastChatPath } = chat

  useEffect(() => {
    if (agentId) {
      void syncAgent(agentId, known)
      syncSession(sessionId ?? null)
    }
  }, [agentId, known, sessionId, syncAgent, syncSession])

  useEffect(() => {
    if (agentId) {
      setLastChatPath(location.pathname)
    }
  }, [agentId, location.pathname, setLastChatPath])

  if (!agentId) {
    return <ChooseAgent />
  }

  const agent = chat.agentState.kind === 'ready' ? chat.agentState.agent : null
  return <ChatLayout agentId={agentId} agent={agent} sessionId={sessionId ?? null} chat={chat} />
}

/** `/chat` with no agent: reopen the last agent, else the first one the user can view. */
function ChooseAgent() {
  const chat = useChat()
  const catalog = useCatalog()
  const { isGlobalBusiness } = usePermissions()

  if (chat.agentState.kind === 'ready') {
    return <Navigate replace to={chatPath(chat.agentState.agent.id)} />
  }
  if (catalog.agents.length > 0) {
    return <Navigate replace to={chatPath(catalog.agents[0].id)} />
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MobileTopBar title="Chat" />
      <div className="mx-auto w-full max-w-xl px-4 py-12 sm:py-20">
        {catalog.loading ? <LoadingRows label="Loading agents" rows={3} /> : null}
        {catalog.error ? (
          <Notice
            tone="error"
            title="Agents didn't load"
            action={
              <Button size="sm" variant="outline" onClick={catalog.reload}>
                Retry
              </Button>
            }
          >
            {catalog.error}
          </Notice>
        ) : null}
        {!catalog.loading && !catalog.error ? (
          <EmptyState icon={<Bot className="size-6" aria-hidden />} title="No agents to chat with">
            No active agents are available for your role and group assignments.
            {isGlobalBusiness && catalog.status !== 'all' ? (
              <div className="mt-4">
                <Button size="sm" variant="outline" onClick={() => catalog.setStatus('all')}>
                  Include inactive agents
                </Button>
              </div>
            ) : null}
          </EmptyState>
        ) : null}
      </div>
    </div>
  )
}

function blockedReason(agent: AgentRecord | null, canExecute: boolean): string | null {
  if (!canExecute) {
    return 'Your role can read conversations but can’t run agents.'
  }
  if (agent && agent.status !== 'active') {
    return 'This agent is inactive. Its conversations stay readable, but it can’t run.'
  }
  return null
}

function ChatLayout({
  agentId,
  agent,
  sessionId,
  chat,
}: {
  agentId: string
  agent: AgentRecord | null
  sessionId: string | null
  chat: ChatStore
}) {
  const { canExecute } = usePermissions()
  const blocked = blockedReason(agent, canExecute)
  const session = chat.sessionState.kind === 'ready' ? chat.sessionState.session : null
  const listedTitle =
    chat.sessionState.kind === 'loading' ? chat.sessionState.session?.title ?? 'Loading conversation…' : null
  const title = session?.title ?? listedTitle ?? (sessionId ? 'Conversation' : 'New chat')
  const agentName = agent?.name ?? agentId

  const headerActions = <ChatHeaderActions agentId={agentId} agentName={agentName} />
  const [drawerOpen, setDrawerOpen] = useState(true)

  const sidebar = <ChatSidebar agent={agent} sessionId={sessionId} newChatBlocked={blocked} />

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        id="chat-drawer"
        aria-label="Agent and conversations"
        className={drawerOpen ? 'hidden w-80 shrink-0 border-r border-border bg-card md:block' : 'hidden'}
      >
        {sidebar}
      </aside>
      <section aria-label="Chat" className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar
          title={title}
          subtitle={
            <>
              {agentName}
              {agent && agent.status !== 'active' ? ' · Inactive' : ''}
            </>
          }
          actions={headerActions}
          drawerContent={sidebar}
        />
        <header className="hidden shrink-0 items-center gap-3 border-b border-border bg-card py-3 pr-6 pl-3 md:flex">
          <IconButton
            label={drawerOpen ? 'Collapse drawer' : 'Expand drawer'}
            aria-expanded={drawerOpen}
            aria-controls="chat-drawer"
            className="border-transparent"
            onClick={() => setDrawerOpen((open) => !open)}
          >
            {drawerOpen ? <PanelLeftClose className="size-4" aria-hidden /> : <PanelLeftOpen className="size-4" aria-hidden />}
          </IconButton>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-medium">{title}</h1>
            <p className="flex items-center gap-2 truncate text-xs text-muted-foreground">
              <span className="truncate">{agentName}</span>
              {agent && agent.status !== 'active' ? <AgentStatusBadge status={agent.status} /> : null}
            </p>
          </div>
          {headerActions}
        </header>
        <ChatBody agentId={agentId} agent={agent} sessionId={sessionId} chat={chat} blocked={blocked} />
      </section>
    </div>
  )
}

function ChatHeaderActions({ agentId, agentName }: { agentId: string; agentName: string }) {
  const { persona } = usePermissions()
  const { canOpenSettings, canOpenConfiguration } = useAgentSettingsAccess(agentId)
  const drafts = useDraftAgentIds()
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = drafts.has(agentId)

  const publish = () => {
    setPublishing(true)
    setError(null)
    void publishAgentDraft(agentId, persona.userId)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Could not publish the draft.')
      })
      .finally(() => setPublishing(false))
  }

  if (!canOpenSettings && !canOpenConfiguration) {
    return null
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {canOpenConfiguration ? (
        <Button
          size="sm"
          className="h-9 px-3.5"
          disabled={!dirty || publishing}
          title={error ?? undefined}
          onClick={publish}
        >
          {publishing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {publishing ? 'Publishing…' : 'Publish'}
        </Button>
      ) : null}
      {canOpenSettings ? (
        <Link
          to={settingsPath(agentId)}
          aria-label={`Agent settings for ${agentName}`}
          title="Agent settings"
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-border bg-card px-2.5 text-sm font-medium hover:bg-muted sm:px-3.5"
        >
          <Settings2 className="size-4" aria-hidden />
          <span className="hidden sm:inline">Agent settings</span>
        </Link>
      ) : null}
      {error ? <span role="alert" className="sr-only">{error}</span> : null}
    </div>
  )
}

function ChatBody({
  agentId,
  agent,
  sessionId,
  chat,
  blocked,
}: {
  agentId: string
  agent: AgentRecord | null
  sessionId: string | null
  chat: ChatStore
  blocked: string | null
}) {
  const navigate = useNavigate()
  const { canExecute } = usePermissions()
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null)

  if (chat.agentState.kind === 'loading' || chat.agentState.kind === 'none') {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <LoadingRows label="Loading agent" rows={2} />
      </div>
    )
  }
  if (chat.agentState.kind === 'missing' || !agent) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-12">
        <EmptyState icon={<Bot className="size-6" aria-hidden />} title="Agent not available">
          No agent with ID <code className="font-mono">{agentId}</code> is visible to you. It may not exist, or you
          may not have a view grant for it.
          <div className="mt-4">
            <Link to="/chat" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              Choose another agent
            </Link>
          </div>
        </EmptyState>
      </div>
    )
  }

  const state = chat.sessionState
  const pendingApproval = chat.approval
  const composerReason =
    blocked ??
    (pendingApproval ? 'Approve or reject the pending tool call to continue.' : null) ??
    (state.kind === 'loading' ? 'Loading conversation…' : null)

  const errors =
    chat.permissionError || chat.actionError ? (
      <div className="mx-auto w-full max-w-3xl space-y-2 px-4 pb-2 sm:px-6">
        {chat.permissionError ? (
          <Notice
            tone="warning"
            title={chat.permissionError}
            action={
              <button type="button" aria-label="Dismiss" onClick={chat.dismissErrors} className="rounded-full p-1 hover:bg-warning/10">
                <X className="size-4" aria-hidden />
              </button>
            }
          >
            Ask someone who manages access for an execute grant on <code className="font-mono">{agent.id}</code>.
          </Notice>
        ) : null}
        {chat.actionError ? (
          <Notice
            tone="error"
            title={chat.actionError}
            action={
              <button type="button" aria-label="Dismiss" onClick={chat.dismissErrors} className="rounded-full p-1 hover:bg-danger/10">
                <X className="size-4" aria-hidden />
              </button>
            }
          />
        ) : null}
      </div>
    ) : null

  const composer = (
    <Composer
      key={sessionId ?? 'new'}
      agentName={agent.name}
      disabledReason={composerReason}
      streaming={chat.streaming}
      busy={chat.creating || chat.deciding}
      onStop={chat.stop}
      onSend={(content, attachments) =>
        chat.send(content, (created) => {
          navigate(chatPath(agent.id, created.id), { replace: true })
        }, attachments)
      }
    />
  )

  if (!sessionId) {
    return (
      <>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <AgentIntro agent={agent} blocked={blocked} creating={chat.creating} />
        </div>
        {errors}
        {composer}
      </>
    )
  }

  switch (state.kind) {
    case 'none':
    case 'loading':
      return (
        <>
          <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
            <LoadingRows label="Loading conversation" rows={4} />
          </div>
          {composer}
        </>
      )
    case 'unavailable':
      return (
        <div className="mx-auto w-full max-w-xl px-4 py-12">
          <EmptyState icon={<MessageSquareDashed className="size-6" aria-hidden />} title="This conversation is unavailable.">
            It may have been deleted, or it belongs to another agent or user.
            <div className="mt-4">
              <Link to={chatPath(agent.id)} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                Start a new chat with {agent.name}
              </Link>
            </div>
          </EmptyState>
        </div>
      )
    case 'error':
      return (
        <div className="mx-auto w-full max-w-xl px-4 py-12">
          <Notice
            tone="error"
            title="Conversation didn't load"
            action={
              <Button size="sm" variant="outline" onClick={chat.retryOpen}>
                Retry
              </Button>
            }
          >
            {state.message}
          </Notice>
        </div>
      )
    case 'ready':
      break
    default: {
      const unreachable: never = state
      return unreachable
    }
  }

  const approvalCard = pendingApproval ? (
    <ApprovalCard
      approval={pendingApproval}
      agentName={agent.name}
      deciding={chat.deciding ? decision : null}
      canDecide={canExecute && agent.status === 'active'}
      onDecide={(choice) => {
        setDecision(choice)
        void chat.decide(choice)
      }}
    />
  ) : null

  return (
    <>
      {chat.entries.length === 0 && !pendingApproval ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          No messages yet.{blocked ? '' : ` Send the first one to ${agent.name}.`}
        </div>
      ) : (
        <Transcript entries={chat.entries} agentName={agent.name} footer={approvalCard} resetKey={state.session.id} />
      )}
      {errors}
      {composer}
    </>
  )
}

function AgentIntro({ agent, blocked, creating }: { agent: AgentRecord; blocked: string | null; creating: boolean }) {
  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center px-6 py-12 text-center">
      <span
        aria-hidden
        className="flex size-14 items-center justify-center rounded-2xl bg-primary font-serif text-2xl text-primary-foreground"
      >
        {agent.name.slice(0, 1)}
      </span>
      <h2 className="mt-4 font-serif text-3xl">{agent.name}</h2>
      {agent.description ? <p className="mt-2 text-sm text-muted-foreground">{agent.description}</p> : null}
      <p className="mt-6 text-sm text-muted-foreground">
        {creating
          ? 'Starting a new conversation…'
          : blocked
            ? 'Pick a past conversation from the list to read it.'
            : 'Your first message starts a new conversation.'}
      </p>
    </div>
  )
}
