import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  CircleStop,
  Loader2,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings2,
  ShieldAlert,
  Square,
  SquarePen,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Link, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom'

import {
  ChatProvider,
  useChat,
  useChatOptional,
  type ChatStore,
} from '@/components/chat/chat-provider'
import { MarkdownMessage } from '@/components/chat/markdown-message'
import type { TranscriptEntry } from '@/components/chat/use-chat-workspace'
import { MobileTopBar, type AppShellContext } from '@/components/shell/app-shell'
import { Button } from '@/components/ui/button'
import {
  AgentStatusBadge,
  Badge,
  EmptyState,
  IconButton,
  LoadingRows,
  Notice,
  Skeleton,
} from '@/components/ui/primitives'
import { useInstructionEligibility } from '@/hooks/use-instruction-eligibility'
import { publishAgentDraft, useDraftAgentIds } from '@/lib/agent-drafts'
import { readPreferredAgentId, writePreferredAgentId } from '@/lib/chat-preference'
import type { Agent, ChatClient, ChatSession, PendingApproval } from '@/lib/types'
import {
  AGENT_ACCESS_MANAGE,
  AGENTS_CONFIGURE,
  PLATFORM_TECHNICAL,
} from '@/lib/permissions'
import { chatPath, settingsPath } from '@/lib/routes'
import { cn } from '@/lib/utils'

const MESSAGE_MAX_LENGTH = 32_000
const COMPOSER_MAX_HEIGHT = 200

type WorkspaceProps = {
  /** Optional overrides for unit tests that render Workspace outside AppShell. */
  client?: ChatClient
  accountLabel?: string | null
  showManage?: boolean
  onUnauthorized?: () => void
  onSignOut?: () => void
}

function AgentAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary font-serif text-sm text-primary-foreground',
        className,
      )}
    >
      {name.slice(0, 1)}
    </span>
  )
}

function ActivityRow({
  icon,
  children,
  className,
}: {
  icon: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'ml-10 rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}

function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] min-w-0 rounded-2xl rounded-br-md bg-primary-soft px-4 py-2.5 text-sm break-words whitespace-pre-wrap">
        <span className="sr-only">You: </span>
        {content}
      </div>
    </div>
  )
}

function AssistantMessage({
  entry,
  agentName,
}: {
  entry: TranscriptEntry
  agentName: string
}) {
  const thinking = Boolean(entry.pending && entry.content === '')
  return (
    <div className="flex gap-3" aria-busy={entry.pending || undefined}>
      <span
        aria-hidden
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary font-serif text-xs text-primary-foreground"
      >
        {agentName.slice(0, 1)}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <span className="sr-only">{agentName}: </span>
        {thinking ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Thinking…
          </p>
        ) : (
          <MarkdownMessage content={entry.content} />
        )}
        {entry.pending && !thinking ? (
          <span className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            Responding…
          </span>
        ) : null}
      </div>
    </div>
  )
}

function ToolActivity({ entry }: { entry: TranscriptEntry }) {
  const name = entry.toolName && entry.toolName !== 'Tool' ? entry.toolName : null
  if (entry.pending) {
    return (
      <ActivityRow icon={<Loader2 className="size-4 animate-spin" aria-hidden />}>
        <p>
          Running tool <code className="font-mono text-xs">{name ?? 'tool'}</code>…
        </p>
      </ActivityRow>
    )
  }
  return (
    <ActivityRow icon={<Wrench className="size-4" aria-hidden />}>
      <details className="group">
        <summary className="cursor-pointer list-none rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          {name ? (
            <>
              Ran tool <code className="font-mono text-xs">{name}</code>
            </>
          ) : (
            'Tool output'
          )}
          <span className="ml-2 text-xs text-muted-foreground underline-offset-4 group-open:hidden hover:underline">
            Show output
          </span>
          <span className="ml-2 hidden text-xs text-muted-foreground underline-offset-4 group-open:inline hover:underline">
            Hide output
          </span>
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-card p-2 font-mono text-xs break-words whitespace-pre-wrap">
          {entry.content || '(empty)'}
        </pre>
      </details>
    </ActivityRow>
  )
}

function NoticeLine({ content }: { content: string }) {
  const stopped = content === 'Stopped.'
  return (
    <p className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
      {stopped ? (
        <CircleStop className="size-3.5" aria-hidden />
      ) : (
        <CircleAlert className="size-3.5 text-warning" aria-hidden />
      )}
      {content}
    </p>
  )
}

function ApprovalCard({
  approval,
  agentName,
  deciding,
  onDecide,
}: {
  approval: PendingApproval
  agentName: string
  deciding: boolean
  onDecide: (decision: 'approve' | 'reject') => void
}) {
  const entries = Object.entries(approval.arguments)
  return (
    <section
      aria-labelledby="approval-title"
      className="ml-10 rounded-2xl border border-warning/50 bg-warning-soft p-4"
    >
      <h3 id="approval-title" className="flex items-center gap-2 text-sm font-semibold">
        <ShieldAlert className="size-4 text-warning" aria-hidden />
        Approval needed
      </h3>
      <p className="mt-1 text-sm">
        {agentName} wants to run{' '}
        <code className="font-mono text-xs">{approval.tool_name}</code> with:
      </p>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-xl border border-border bg-card px-3 py-2 font-mono text-xs">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No arguments.</p>
        ) : (
          entries.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="break-words">
                {typeof value === 'string' ? value : JSON.stringify(value)}
              </dd>
            </div>
          ))
        )}
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={deciding} onClick={() => onDecide('approve')}>
          <Check className="size-3.5" aria-hidden />
          Approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={deciding}
          onClick={() => onDecide('reject')}
        >
          <X className="size-3.5" aria-hidden />
          Reject
        </Button>
      </div>
    </section>
  )
}

function Transcript({
  entries,
  agentName,
  approval,
  deciding,
  onDecide,
}: {
  entries: TranscriptEntry[]
  agentName: string
  approval: PendingApproval | null
  deciding: boolean
  onDecide: (decision: 'approve' | 'reject') => void
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <ol aria-label="Messages" className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
        {entries.map((entry) => {
          if (entry.role === 'assistant') {
            return (
              <li key={entry.id}>
                <AssistantMessage entry={entry} agentName={agentName} />
              </li>
            )
          }
          if (entry.role === 'user') {
            return (
              <li key={entry.id}>
                <UserMessage content={entry.content} />
              </li>
            )
          }
          if (entry.role === 'tool') {
            return (
              <li key={entry.id}>
                <ToolActivity entry={entry} />
              </li>
            )
          }
          return (
            <li key={entry.id}>
              <NoticeLine content={entry.content} />
            </li>
          )
        })}
        {approval ? (
          <li>
            <ApprovalCard
              approval={approval}
              agentName={agentName}
              deciding={deciding}
              onDecide={onDecide}
            />
          </li>
        ) : null}
      </ol>
    </div>
  )
}

function AgentIntro({
  agent,
  creating,
}: {
  agent: Agent
  creating: boolean
}) {
  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center px-6 py-12 text-center">
      <span
        aria-hidden
        className="flex size-14 items-center justify-center rounded-2xl bg-primary font-serif text-2xl text-primary-foreground"
      >
        {agent.name.slice(0, 1)}
      </span>
      <h2 className="mt-4 font-serif text-3xl">{agent.name}</h2>
      {agent.description ? (
        <p className="mt-2 text-sm text-muted-foreground">{agent.description}</p>
      ) : null}
      <p className="mt-6 text-sm text-muted-foreground">
        {creating
          ? 'Starting a new conversation…'
          : 'Choose a conversation or start a new chat.'}
      </p>
    </div>
  )
}

function AgentPicker({
  agents,
  selected,
  loading,
  cursor,
  query,
  onQueryChange,
  onSelect,
  onLoadMore,
}: {
  agents: Agent[]
  selected: Agent | null
  loading: boolean
  cursor: string | null
  query: string
  onQueryChange: (value: string) => void
  onSelect: (agent: Agent) => void
  onLoadMore: () => void
}) {
  const drafts = useDraftAgentIds()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const panelId = useId()
  const hintId = useId()
  const normalized = query.trim().toLowerCase()
  const visible = normalized
    ? agents.filter(
        (agent) =>
          agent.name.toLowerCase().includes(normalized) ||
          agent.id.toLowerCase().includes(normalized) ||
          (agent.description ?? '').toLowerCase().includes(normalized),
      )
    : agents

  useEffect(() => {
    if (open) {
      searchRef.current?.focus()
    }
  }, [open])

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          close()
        }
      }}
    >
      <p className="mb-1.5 px-1 text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
        Agent
      </p>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-2 text-left hover:bg-muted"
      >
        {selected ? (
          <>
            <AgentAvatar name={selected.name} />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-sm font-medium">{selected.name}</span>
                {drafts.has(selected.id) ? <Badge tone="warning">Draft</Badge> : null}
              </span>
              <span className="block truncate font-mono text-xs text-muted-foreground">
                {selected.id}
              </span>
            </span>
            {selected.status !== 'active' ? <AgentStatusBadge status={selected.status} /> : null}
          </>
        ) : (
          <span className="flex-1 px-1 text-sm text-muted-foreground">Choose an agent</span>
        )}
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        />
        <span className="sr-only">{open ? 'Close agent list' : 'Change agent'}</span>
      </button>

      {open ? (
        <div id={panelId} className="mt-2 rounded-2xl border border-border bg-card p-2 shadow-sm">
          <div className="space-y-2 p-1">
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                ref={searchRef}
                type="search"
                aria-label="Filter loaded agents"
                aria-describedby={hintId}
                placeholder="Filter loaded agents"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                className="h-9 w-full rounded-full border border-border-strong bg-card pr-3 pl-9 text-sm"
              />
            </div>
            <p id={hintId} className="px-1 text-xs text-muted-foreground">
              {`Active agents you can use (${agents.length})`}
              {cursor ? '. Load more to search further.' : '.'}
            </p>
          </div>
          <div className="max-h-[45svh] overflow-y-auto">
            {loading && agents.length === 0 ? <LoadingRows label="Loading agents" rows={3} /> : null}
            {!loading && agents.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">No agents are available.</p>
            ) : null}
            {agents.length > 0 && visible.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                No loaded agents match “{query}”.
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {visible.map((agent) => {
                const current = agent.id === selected?.id
                return (
                  <li key={agent.id}>
                    <button
                      type="button"
                      aria-label={agent.name}
                      aria-current={current ? 'true' : undefined}
                      onClick={() => {
                        onSelect(agent)
                        close()
                      }}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-muted',
                        current && 'bg-primary-soft hover:bg-primary-soft',
                      )}
                    >
                      <AgentAvatar name={agent.name} className="size-7 rounded-lg text-xs" />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{agent.name}</span>
                          {drafts.has(agent.id) ? <Badge tone="warning">Draft</Badge> : null}
                        </span>
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          {agent.id}
                        </span>
                      </span>
                      {agent.status !== 'active' ? (
                        <AgentStatusBadge status={agent.status} />
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
            {cursor ? (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 w-full"
                disabled={loading}
                onClick={onLoadMore}
              >
                {loading ? 'Loading…' : 'Load more agents'}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ConversationList({
  agent,
  sessions,
  selectedSession,
  loading,
  cursor,
  onOpen,
  onDelete,
  deletingId,
  onLoadMore,
  onClose,
}: {
  agent: Agent
  sessions: ChatSession[]
  selectedSession: ChatSession | null
  loading: boolean
  cursor: string | null
  onOpen: (session: ChatSession) => void
  onDelete: (session: ChatSession) => void
  deletingId: string | null
  onLoadMore: () => void
  onClose?: () => void
}) {
  const sessionsEmpty = !loading && sessions.length === 0 && !cursor

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2 className="px-5 pt-4 pb-2 text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
        Conversations
      </h2>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {loading && sessions.length === 0 ? (
          <div className="space-y-2 px-2" role="status" aria-label="Loading conversations">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-4/5" />
            <span className="sr-only">Loading conversations</span>
          </div>
        ) : null}
        {sessionsEmpty ? (
          <p className="px-2 py-2 text-sm text-muted-foreground">
            No conversations with {agent.name} yet.
          </p>
        ) : null}
        <ul className="space-y-0.5">
          {sessions.map((session) => {
            const current = session.id === selectedSession?.id
            return (
              <li key={session.id} className="group relative">
                <button
                  type="button"
                  aria-current={current ? 'page' : undefined}
                  onClick={() => {
                    void onOpen(session)
                    onClose?.()
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 pr-9 text-left text-sm hover:bg-muted',
                    current && 'bg-primary-soft font-medium text-primary hover:bg-primary-soft',
                  )}
                >
                  <MessageSquare className="size-4 shrink-0 opacity-60" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{session.title}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${session.title}`}
                  title={`Delete ${session.title}`}
                  disabled={deletingId === session.id}
                  onClick={() => onDelete(session)}
                  className="absolute top-1/2 right-1 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-card hover:text-foreground disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>
        {cursor ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full"
            disabled={loading}
            onClick={onLoadMore}
          >
            {loading ? 'Loading…' : 'Load more conversations'}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function ChatSidebar({
  chat,
  agentQuery,
  onAgentQueryChange,
  onAgentSelect,
  onClose,
}: {
  chat: ChatStore
  agentQuery: string
  onAgentQueryChange: (value: string) => void
  onAgentSelect: (agent: Agent) => void
  onClose?: () => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-4 pt-4 md:hidden">
        <p className="text-sm font-medium">Chat</p>
        {onClose ? (
          <button type="button" aria-label="Close conversations" onClick={onClose}>
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      <div className="space-y-3 px-4 pt-5">
        <AgentPicker
          agents={chat.agents}
          selected={chat.selectedAgent}
          loading={chat.loadingAgents}
          cursor={chat.agentCursor}
          query={agentQuery}
          onQueryChange={onAgentQueryChange}
          onSelect={(agent) => {
            onAgentSelect(agent)
            onClose?.()
          }}
          onLoadMore={() => chat.loadMoreAgents()}
        />
        {chat.selectedAgent ? (
          <Button
            type="button"
            variant="outline"
            className="h-10 w-full rounded-full"
            disabled={chat.creating}
            aria-current={chat.selectedSession ? undefined : 'page'}
            onClick={() => {
              chat.createChat()
              onClose?.()
            }}
          >
            <SquarePen className="size-4" aria-hidden />
            New chat
          </Button>
        ) : null}
      </div>
      {chat.selectedAgent ? (
        <ConversationList
          agent={chat.selectedAgent}
          sessions={chat.sessions}
          selectedSession={chat.selectedSession}
          loading={chat.loadingSessions}
          cursor={chat.sessionCursor}
          onOpen={(session) => void chat.openSession(session)}
          onDelete={(session) => void chat.deleteSession(session.id)}
          deletingId={chat.deletingSessionId}
          onLoadMore={() => chat.loadMoreSessions()}
          onClose={onClose}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
          <Bot className="size-6" aria-hidden />
          Pick an agent to see its conversations.
        </div>
      )}
    </div>
  )
}

function Composer({
  agentName,
  draft,
  setDraft,
  disabled,
  streaming,
  approvalBlocked,
  onSend,
  onStop,
}: {
  agentName: string
  draft: string
  setDraft: (value: string) => void
  disabled: boolean
  streaming: boolean
  approvalBlocked: boolean
  onSend: () => void
  onStop: () => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const trimmed = draft.trim()
  const tooLong = trimmed.length > MESSAGE_MAX_LENGTH
  const canSend = !disabled && !streaming && !approvalBlocked && !tooLong && trimmed !== ''

  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) {
      return
    }
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, COMPOSER_MAX_HEIGHT)}px`
  }, [draft])

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSend) {
      return
    }
    onSend()
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <form onSubmit={onSubmit} className="border-t border-border bg-card px-4 py-3 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        {approvalBlocked ? (
          <p className="mb-2 text-sm text-muted-foreground">
            Resolve the pending tool call before sending another message.
          </p>
        ) : null}
        <div
          className={cn(
            'flex items-end gap-2 rounded-3xl border border-border-strong bg-background px-2 py-2',
            disabled && 'opacity-60',
          )}
        >
          <label htmlFor="composer-input" className="sr-only">
            Message {agentName}
          </label>
          <textarea
            id="composer-input"
            ref={textareaRef}
            rows={1}
            aria-label="Message"
            value={draft}
            disabled={disabled || approvalBlocked}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              disabled || approvalBlocked ? 'Messaging is unavailable' : `Message ${agentName}…`
            }
            className="max-h-[200px] min-h-9 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop"
              title="Stop"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background hover:bg-foreground/85"
            >
              <Square className="size-3.5 fill-current" aria-hidden />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send"
              title="Send"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowUp className="size-4" aria-hidden />
            </button>
          )}
        </div>
        <p className="mt-2 px-1 text-xs text-muted-foreground">
          Enter to send · Shift+Enter for a new line.
        </p>
      </div>
    </form>
  )
}

export function Workspace(props: WorkspaceProps = {}) {
  const shell = useOutletContext<AppShellContext | undefined>()
  const client = props.client ?? shell?.client
  const onUnauthorized = props.onUnauthorized ?? shell?.onUnauthorized
  const parentChat = useChatOptional()

  if (!client || !onUnauthorized) {
    throw new Error('Workspace requires a chat client and onUnauthorized handler.')
  }

  // AppShell owns ChatProvider so state survives leaving /chat. Tests mount Workspace alone.
  if (parentChat) {
    return <WorkspaceView {...props} />
  }
  return (
    <ChatProvider client={client} onUnauthorized={onUnauthorized}>
      <WorkspaceView {...props} />
    </ChatProvider>
  )
}

function WorkspaceView(props: WorkspaceProps) {
  const shell = useOutletContext<AppShellContext | undefined>()
  const onUnauthorized = props.onUnauthorized ?? shell?.onUnauthorized
  const managementClient = shell?.managementClient ?? null
  const permissions = shell?.permissions ?? new Set<string>()
  const accountLabel = props.accountLabel ?? shell?.accountLabel ?? null

  if (!onUnauthorized) {
    throw new Error('Workspace requires an onUnauthorized handler.')
  }

  const chat = useChat()
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams<{ agentId?: string; sessionId?: string }>()
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [agentQuery, setAgentQuery] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const drafts = useDraftAgentIds()

  const selectedAgentId = chat.selectedAgent?.id ?? null
  const eligibility = useInstructionEligibility({
    managementClient,
    agentId: selectedAgentId,
    onUnauthorized,
  })

  const noAgentsReady =
    !chat.loadingAgents &&
    chat.agents.length === 0 &&
    !chat.selectedAgent &&
    !chat.actionError
  const canConfigure = permissions.has(AGENTS_CONFIGURE)
  const canManageAccess = permissions.has(AGENT_ACCESS_MANAGE)
  const canTechnical = permissions.has(PLATFORM_TECHNICAL)
  const showSettings =
    Boolean(selectedAgentId) &&
    (canConfigure ||
      canManageAccess ||
      canTechnical ||
      eligibility.status === 'eligible' ||
      props.showManage === true)

  const {
    agents,
    sessions,
    selectedAgent,
    selectedSession,
    preferNewChat,
    selectAgent,
    openSession,
    setLastChatPath,
  } = chat

  useEffect(() => {
    if (params.agentId) {
      setLastChatPath(location.pathname)
    }
  }, [params.agentId, location.pathname, setLastChatPath])

  const appliedDefaultAgent = useRef(false)

  useEffect(() => {
    const agentId = params.agentId
    if (agentId) {
      if (agents.length === 0) {
        return
      }
      const agent = agents.find((item) => item.id === agentId)
      if (!agent) {
        return
      }
      writePreferredAgentId(agent.id)
      if (selectedAgent?.id !== agent.id) {
        // Keep preferNewChat off when the URL already names a session so deep links open.
        selectAgent(agent, { preferNewChat: !params.sessionId })
      }
      return
    }
    if (appliedDefaultAgent.current || agents.length === 0) {
      return
    }
    appliedDefaultAgent.current = true
    const preferredId = readPreferredAgentId()
    const preferred = preferredId ? agents.find((item) => item.id === preferredId) : undefined
    const agent = preferred ?? agents[0]
    if (!agent || selectedAgent?.id === agent.id) {
      return
    }
    writePreferredAgentId(agent.id)
    selectAgent(agent, { preferNewChat: true })
  }, [params.agentId, params.sessionId, agents, selectedAgent?.id, selectAgent])

  const syncedSession = useRef<{ url: string | undefined; selected: string | undefined } | null>(
    null,
  )

  useEffect(() => {
    if (!selectedAgent || (params.agentId && params.agentId !== selectedAgent.id)) {
      syncedSession.current = null
      return
    }
    const url = params.sessionId
    const selected = selectedSession?.id
    const previous = syncedSession.current
    const urlChanged = previous === null || previous.url !== url
    // A null previous with a selection is a click that happened before the URL sync ran.
    const selectionChanged =
      previous === null ? selected !== undefined : previous.selected !== selected

    if (preferNewChat) {
      syncedSession.current = { url, selected }
      const next = chatPath(selectedAgent.id)
      if (location.pathname !== next) {
        void navigate(next, { replace: true })
      }
      return
    }

    // Back/forward or a deep link: the URL changed and the user did not click a row.
    if (urlChanged && !selectionChanged && url && url !== selected) {
      if (sessions.length === 0) {
        return
      }
      const session = sessions.find((item) => item.id === url)
      if (!session) {
        return
      }
      syncedSession.current = { url, selected }
      void openSession(session)
      return
    }

    syncedSession.current = { url, selected }
    const next = chatPath(selectedAgent.id, selected)
    if (location.pathname !== next) {
      void navigate(next, { replace: true })
    }
  }, [
    params.agentId,
    params.sessionId,
    selectedSession?.id,
    preferNewChat,
    selectedAgent,
    sessions,
    openSession,
    location.pathname,
    navigate,
  ])

  const title = chat.selectedSession?.title ?? (chat.selectedAgent ? 'New chat' : 'Chat')
  const subtitle = chat.selectedAgent?.name ?? accountLabel
  const selectedDirty = selectedAgentId ? drafts.has(selectedAgentId) : false
  const canPublish =
    Boolean(managementClient) &&
    (canTechnical ||
      eligibility.status === 'eligible' ||
      eligibility.status === 'loading' ||
      eligibility.status === 'error')

  const publish = () => {
    if (!managementClient || !selectedAgentId || !selectedDirty || publishing) {
      return
    }
    setPublishing(true)
    setPublishError(null)
    void publishAgentDraft(managementClient, selectedAgentId)
      .catch((caught: unknown) => {
        setPublishError(caught instanceof Error ? caught.message : 'Could not publish the draft.')
      })
      .finally(() => setPublishing(false))
  }

  const headerActions: ReactNode =
    showSettings && selectedAgentId ? (
      <div className="flex shrink-0 items-center gap-2">
        {canPublish ? (
          <Button
            type="button"
            size="sm"
            className="h-9 px-3.5"
            disabled={!selectedDirty || publishing}
            title={publishError ?? undefined}
            onClick={publish}
          >
            {publishing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {publishing ? 'Publishing…' : 'Publish'}
          </Button>
        ) : null}
        <Link
          to={settingsPath(selectedAgentId)}
          aria-label={`Agent settings for ${chat.selectedAgent?.name ?? selectedAgentId}`}
          title="Agent settings"
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-border bg-card px-2.5 text-sm font-medium hover:bg-muted sm:px-3.5"
        >
          <Settings2 className="size-4" aria-hidden />
          <span className="hidden sm:inline">Agent settings</span>
        </Link>
        {publishError ? (
          <span role="alert" className="sr-only">
            {publishError}
          </span>
        ) : null}
      </div>
    ) : null

  function handleAgentSelect(agent: Agent) {
    if (agent.id === selectedAgentId) {
      selectAgent(agent)
      return
    }

    void navigate(chatPath(agent.id), { replace: true })
  }

  const sidebar = (
    <ChatSidebar
      chat={chat}
      agentQuery={agentQuery}
      onAgentQueryChange={setAgentQuery}
      onAgentSelect={handleAgentSelect}
      onClose={() => setMenuOpen(false)}
    />
  )

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        id="chat-drawer"
        aria-label="Agent and conversations"
        className={cn(
          'hidden w-80 shrink-0 flex-col border-r border-border bg-card md:flex',
          !drawerOpen && 'md:hidden',
        )}
      >
        {sidebar}
      </aside>

      <section aria-label="Chat" className="flex min-w-0 flex-1 flex-col">
        {shell ? (
          <MobileTopBar
            title={title}
            subtitle={subtitle}
            actions={headerActions}
            drawerContent={
              <ChatSidebar
                chat={chat}
                agentQuery={agentQuery}
                onAgentQueryChange={setAgentQuery}
                onAgentSelect={handleAgentSelect}
                onClose={() => setMenuOpen(false)}
              />
            }
          />
        ) : (
          <header className="flex items-center gap-3 border-b border-border px-4 py-3 md:hidden">
            <button
              type="button"
              aria-label="Open conversations"
              onClick={() => setMenuOpen(true)}
            >
              <Menu className="size-5" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-sm font-medium">{title}</h1>
            </div>
            {headerActions}
            {props.onSignOut ? (
              <Button type="button" variant="ghost" size="sm" onClick={props.onSignOut}>
                Sign out
              </Button>
            ) : null}
          </header>
        )}

        <header className="hidden shrink-0 items-center gap-3 border-b border-border bg-card py-3 pr-6 pl-3 md:flex">
          <IconButton
            label={drawerOpen ? 'Collapse drawer' : 'Expand drawer'}
            aria-expanded={drawerOpen}
            aria-controls="chat-drawer"
            className="border-transparent"
            onClick={() => setDrawerOpen((open) => !open)}
          >
            {drawerOpen ? (
              <PanelLeftClose className="size-4" aria-hidden />
            ) : (
              <PanelLeftOpen className="size-4" aria-hidden />
            )}
          </IconButton>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-medium">{title}</h1>
            {chat.selectedAgent ? (
              <p className="flex items-center gap-2 truncate text-xs text-muted-foreground">
                <span className="truncate">{chat.selectedAgent.name}</span>
                {chat.selectedAgent.status !== 'active' ? (
                  <AgentStatusBadge status={chat.selectedAgent.status} />
                ) : null}
              </p>
            ) : null}
          </div>
          {headerActions}
        </header>

        {menuOpen && !shell ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-20 bg-foreground/20 md:hidden"
              aria-label="Close conversations"
              onClick={() => setMenuOpen(false)}
            />
            <aside className="fixed inset-y-0 left-0 z-30 flex w-80 flex-col border-r border-border bg-card md:hidden">
              {sidebar}
            </aside>
          </>
        ) : null}

        {eligibility.status === 'error' && selectedAgentId ? (
          <Notice
            tone="error"
            className="mx-4 mt-3"
            action={
              <Button type="button" size="sm" variant="outline" onClick={eligibility.retry}>
                Retry
              </Button>
            }
          >
            {eligibility.message ?? 'Could not check Instruction Skills access.'}
          </Notice>
        ) : null}
        {chat.permissionError && !noAgentsReady ? (
          <Notice tone="error" className="mx-4 mt-3" title={chat.permissionError} />
        ) : null}
        {chat.sessionNotice ? (
          <Notice tone="info" className="mx-4 mt-3">
            {chat.sessionNotice}
          </Notice>
        ) : null}
        {chat.actionError ? (
          <Notice tone="error" className="mx-4 mt-3">
            {chat.actionError}
          </Notice>
        ) : null}

        {chat.selectedSession ? (
          chat.loadingSession && chat.entries.length === 0 && !chat.approval ? (
            <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
              <LoadingRows label="Loading conversation" rows={4} />
            </div>
          ) : chat.entries.length === 0 && !chat.approval ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
              No messages yet. Send the first one to {chat.selectedAgent?.name ?? 'this agent'}.
            </div>
          ) : (
            <Transcript
              entries={chat.entries}
              agentName={chat.selectedAgent?.name ?? 'Agent'}
              approval={chat.approval}
              deciding={chat.deciding}
              onDecide={(decision) => void chat.decide(decision)}
            />
          )
        ) : chat.loadingAgents && !chat.selectedAgent ? (
          <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
            <LoadingRows label="Loading agent" rows={2} />
          </div>
        ) : chat.selectedAgent ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <AgentIntro agent={chat.selectedAgent} creating={chat.creating} />
          </div>
        ) : noAgentsReady ? (
          <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-12">
            <EmptyState
              icon={<ShieldAlert className="size-6" aria-hidden />}
              title={chat.permissionError ? "You don't have access yet" : 'No agents yet'}
            >
              {chat.permissionError
                ? 'Ask an admin to give you access to this app. You can sign out and come back after they do.'
                : 'Ask an admin to add you to a group or grant you an agent.'}
            </EmptyState>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-12">
            <EmptyState icon={<Bot className="size-6" aria-hidden />} title="Choose an agent">
              Pick an agent from the sidebar to start chatting.
            </EmptyState>
          </div>
        )}

        {noAgentsReady ? null : (
        <Composer
          agentName={chat.selectedAgent?.name ?? 'agent'}
          draft={draft}
          setDraft={setDraft}
          disabled={!chat.selectedAgent || chat.creating}
          streaming={chat.streaming}
          approvalBlocked={Boolean(chat.approval)}
          onSend={() => {
            const content = draft.trim()
            if (!content) {
              return
            }
            setDraft('')
            void chat.send(content)
          }}
          onStop={chat.stop}
        />
        )}
      </section>
    </div>
  )
}
