/** PROTOTYPE chat sidebar (#53): one agent picker, New chat, and the agent's conversations. */
import { Bot, ChevronDown, MessageSquare, Search, SquarePen } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import type { AgentRecord } from '@/lib/management'
import { cn } from '@/lib/utils'

import { useCatalog, useChat, useDraftAgentIds, usePermissions } from '../hooks'
import type { AgentStatusFilter } from '../mock/client'
import { chatPath } from '../routes'
import { AgentStatusBadge, Badge, Button, LoadingRows, Notice, Skeleton } from '../ui'

const STATUS_FILTERS: { value: AgentStatusFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'All' },
]

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

function DraftMark() {
  return <Badge tone="warning">Draft</Badge>
}

function AgentPicker({ selected }: { selected: AgentRecord | null }) {
  const { isGlobalBusiness } = usePermissions()
  const catalog = useCatalog()
  const drafts = useDraftAgentIds()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const panelId = useId()
  const hintId = useId()
  const query = catalog.query.trim().toLowerCase()
  const visible = query
    ? catalog.agents.filter(
        (agent) =>
          agent.name.toLowerCase().includes(query) ||
          agent.id.toLowerCase().includes(query) ||
          (agent.description ?? '').toLowerCase().includes(query),
      )
    : catalog.agents
  const showStatusFilter = isGlobalBusiness

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
      <p className="mb-1.5 px-1 text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">Agent</p>
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
                {drafts.has(selected.id) ? <DraftMark /> : null}
              </span>
              <span className="block truncate font-mono text-xs text-muted-foreground">{selected.id}</span>
            </span>
            {selected.status !== 'active' ? <AgentStatusBadge status={selected.status} /> : null}
          </>
        ) : (
          <span className="flex-1 px-1 text-sm text-muted-foreground">Choose an agent</span>
        )}
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
        <span className="sr-only">{open ? 'Close agent list' : 'Change agent'}</span>
      </button>

      {open ? (
        <div id={panelId} className="mt-2 rounded-2xl border border-border bg-card p-2 shadow-sm">
          <div className="space-y-2 p-1">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                ref={searchRef}
                type="search"
                aria-label="Filter loaded agents"
                aria-describedby={hintId}
                placeholder="Filter loaded agents"
                value={catalog.query}
                onChange={(event) => catalog.setQuery(event.target.value)}
                className="h-9 w-full rounded-full border border-border-strong bg-card pr-3 pl-9 text-sm"
              />
            </div>
            <p id={hintId} className="px-1 text-xs text-muted-foreground">
              {showStatusFilter
                ? `Filters the ${catalog.agents.length} loaded agent${catalog.agents.length === 1 ? '' : 's'}`
                : `Active agents you can use (${catalog.agents.length})`}
              {catalog.cursor ? '. Load more to search further.' : '.'}
            </p>
            {showStatusFilter ? (
              <div role="group" aria-label="Agent status" className="flex rounded-full border border-border bg-muted p-1">
                {STATUS_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    aria-pressed={catalog.status === filter.value}
                    onClick={() => catalog.setStatus(filter.value)}
                    className={cn(
                      'h-7 flex-1 rounded-full text-xs font-medium text-muted-foreground',
                      catalog.status === filter.value && 'bg-card text-foreground shadow-sm',
                    )}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="max-h-[45svh] overflow-y-auto">
            {catalog.error ? (
              <Notice
                tone="error"
                title="Agents didn't load"
                className="m-1"
                action={
                  <Button size="sm" variant="outline" onClick={catalog.reload}>
                    Retry
                  </Button>
                }
              >
                {catalog.error}
              </Notice>
            ) : null}
            {catalog.loading && catalog.agents.length === 0 ? <LoadingRows label="Loading agents" rows={3} /> : null}
            {!catalog.loading && !catalog.error && catalog.agents.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                {catalog.status === 'all' ? 'No agents you can view.' : `No ${catalog.status} agents you can view.`}
              </p>
            ) : null}
            {catalog.agents.length > 0 && visible.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">No loaded agents match “{catalog.query}”.</p>
            ) : null}
            <ul className="space-y-0.5">
              {visible.map((agent) => {
                const current = agent.id === selected?.id
                return (
                  <li key={agent.id}>
                    <Link
                      to={chatPath(agent.id)}
                      aria-current={current ? 'true' : undefined}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-muted',
                        current && 'bg-primary-soft hover:bg-primary-soft',
                      )}
                    >
                      <AgentAvatar name={agent.name} className="size-7 rounded-lg text-xs" />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{agent.name}</span>
                          {drafts.has(agent.id) ? <DraftMark /> : null}
                        </span>
                        <span className="block truncate font-mono text-xs text-muted-foreground">{agent.id}</span>
                      </span>
                      {agent.status !== 'active' ? <AgentStatusBadge status={agent.status} /> : null}
                    </Link>
                  </li>
                )
              })}
            </ul>
            {catalog.cursor ? (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 w-full"
                disabled={catalog.loading}
                onClick={catalog.loadMore}
              >
                {catalog.loading ? 'Loading…' : 'Load more agents'}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ConversationList({ agent, sessionId }: { agent: AgentRecord; sessionId: string | null }) {
  const chat = useChat()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2 className="px-5 pt-4 pb-2 text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
        Conversations
      </h2>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {chat.sessionsError ? (
          <Notice
            tone="error"
            title="Conversations didn't load"
            className="mx-2"
            action={
              <Button size="sm" variant="outline" onClick={chat.retrySessions}>
                Retry
              </Button>
            }
          >
            {chat.sessionsError}
          </Notice>
        ) : null}
        {chat.loadingSessions && chat.sessions.length === 0 ? (
          <div className="space-y-2 px-2" role="status" aria-label="Loading conversations">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-4/5" />
          </div>
        ) : null}
        {!chat.loadingSessions && !chat.sessionsError && chat.sessions.length === 0 && !chat.sessionCursor ? (
          <p className="px-2 py-2 text-sm text-muted-foreground">No conversations with {agent.name} yet.</p>
        ) : null}
        <ul className="space-y-0.5">
          {chat.sessions.map((session) => {
            const current = session.id === sessionId
            return (
              <li key={session.id}>
                <Link
                  to={chatPath(agent.id, session.id)}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm hover:bg-muted',
                    current && 'bg-primary-soft font-medium text-primary hover:bg-primary-soft',
                  )}
                >
                  <MessageSquare className="size-4 shrink-0 opacity-60" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{session.title}</span>
                </Link>
              </li>
            )
          })}
        </ul>
        {chat.sessionCursor ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full"
            disabled={chat.loadingSessions}
            onClick={chat.loadMoreSessions}
          >
            {chat.loadingSessions ? 'Loading…' : 'Load more conversations'}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function ChatSidebar({
  agent,
  sessionId,
  newChatBlocked,
}: {
  agent: AgentRecord | null
  sessionId: string | null
  newChatBlocked: string | null
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 px-4 pt-5">
        <AgentPicker selected={agent} />
        {agent ? (
          newChatBlocked ? (
            <p className="rounded-2xl border border-dashed border-border-strong px-3 py-2 text-xs text-muted-foreground">
              {newChatBlocked}
            </p>
          ) : (
            <Link
              to={chatPath(agent.id)}
              aria-current={sessionId ? undefined : 'page'}
              className="flex h-10 items-center justify-center gap-2 rounded-full border border-border-strong bg-card text-sm font-medium hover:bg-muted aria-[current=page]:border-primary aria-[current=page]:text-primary"
            >
              <SquarePen className="size-4" aria-hidden />
              New chat
            </Link>
          )
        ) : null}
      </div>
      {agent ? (
        <ConversationList agent={agent} sessionId={sessionId} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
          <Bot className="size-6" aria-hidden />
          Pick an agent to see its conversations.
        </div>
      )}
    </div>
  )
}
