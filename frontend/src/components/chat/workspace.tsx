import { Menu, X } from 'lucide-react'
import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'

import { MarkdownMessage } from '@/components/chat/markdown-message'
import { useChatWorkspace, type TranscriptEntry } from '@/components/chat/use-chat-workspace'
import { Button } from '@/components/ui/button'
import type { ChatClient, PendingApproval } from '@/lib/types'
import { cn } from '@/lib/utils'

type WorkspaceProps = {
  client: ChatClient
  accountLabel: string | null
  showManage?: boolean
  onUnauthorized: () => void
  onSignOut: () => void
}

function ToolLine({ entry }: { entry: TranscriptEntry }) {
  const name = entry.toolName ?? 'Tool'
  if (entry.pending) {
    return <p>Running {name}</p>
  }
  return (
    <p>
      {name}
      {entry.content ? `: ${entry.content}` : ''}
    </p>
  )
}

function Transcript({
  entries,
  approval,
  deciding,
  onDecide,
}: {
  entries: TranscriptEntry[]
  approval: PendingApproval | null
  deciding: boolean
  onDecide: (decision: 'approve' | 'reject') => void
}) {
  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-6">
      {entries.map((entry) => {
        if (entry.role === 'assistant') {
          return (
            <article key={entry.id} className="max-w-3xl text-foreground">
              {entry.pending && entry.content === '' ? (
                <p className="text-muted-foreground">Responding…</p>
              ) : (
                <MarkdownMessage content={entry.content} />
              )}
            </article>
          )
        }
        if (entry.role === 'user') {
          return (
            <article
              key={entry.id}
              className="ml-auto max-w-3xl rounded-2xl bg-muted px-4 py-3 whitespace-pre-wrap"
            >
              {entry.content}
            </article>
          )
        }
        if (entry.role === 'tool') {
          return (
            <article key={entry.id} className="max-w-3xl text-sm text-muted-foreground">
              <ToolLine entry={entry} />
            </article>
          )
        }
        return (
          <p key={entry.id} className="text-sm text-muted-foreground" role="status">
            {entry.content}
          </p>
        )
      })}
      {approval ? (
        <section className="max-w-3xl rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Approval required</h2>
          <p className="mt-2 font-medium">{approval.tool_name}</p>
          <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(approval.arguments, null, 2)}
          </pre>
          <div className="mt-4 flex gap-2">
            <Button
              type="button"
              disabled={deciding}
              onClick={() => onDecide('approve')}
            >
              Approve
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={deciding}
              onClick={() => onDecide('reject')}
            >
              Reject
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  )
}

export function Workspace({
  client,
  accountLabel,
  showManage = false,
  onUnauthorized,
  onSignOut,
}: WorkspaceProps) {
  const chat = useChatWorkspace(client, onUnauthorized)
  const [menuOpen, setMenuOpen] = useState(false)
  const [draft, setDraft] = useState('')

  function closeMenu() {
    setMenuOpen(false)
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || chat.streaming || chat.approval) {
      return
    }
    setDraft('')
    void chat.send(content)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  const sessionsEmpty =
    chat.selectedAgent &&
    !chat.loadingSessions &&
    chat.sessions.length === 0 &&
    !chat.sessionCursor

  return (
    <div className="flex h-svh bg-background">
      {menuOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-20 bg-foreground/20 md:hidden"
          aria-label="Close conversations"
          onClick={closeMenu}
        />
      ) : null}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-border bg-card md:static',
          menuOpen ? 'flex' : 'hidden md:flex',
        )}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <p className="text-sm font-medium">Agents</p>
          <button
            type="button"
            className="md:hidden"
            aria-label="Close conversations"
            onClick={closeMenu}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex flex-col gap-1 overflow-y-auto px-3">
          {chat.loadingAgents && chat.agents.length === 0 ? (
            <p className="px-2 text-sm text-muted-foreground">Loading agents…</p>
          ) : null}
          {!chat.loadingAgents && chat.agents.length === 0 ? (
            <p className="px-2 text-sm text-muted-foreground">No agents are available.</p>
          ) : null}
          {chat.agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className={cn(
                'rounded-md px-2 py-2 text-left text-sm hover:bg-muted',
                chat.selectedAgent?.id === agent.id && 'bg-muted',
              )}
              onClick={() => {
                chat.selectAgent(agent)
                closeMenu()
              }}
            >
              <span className="block font-medium">{agent.name}</span>
              {agent.description ? (
                <span className="mt-1 block text-xs text-muted-foreground">
                  {agent.description}
                </span>
              ) : null}
            </button>
          ))}
          {chat.agentCursor ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => chat.loadMoreAgents()}
            >
              Load more agents
            </Button>
          ) : null}
        </div>
        <div className="mt-4 flex items-center justify-between px-4">
          <p className="text-sm font-medium">Conversations</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!chat.selectedAgent || chat.creating}
            onClick={() => void chat.createChat()}
          >
            New chat
          </Button>
        </div>
        <div className="mt-2 flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3">
          {chat.loadingSessions ? (
            <p className="px-2 text-sm text-muted-foreground">Loading conversations…</p>
          ) : null}
          {sessionsEmpty ? (
            <p className="px-2 text-sm text-muted-foreground">
              No conversations for this agent.
            </p>
          ) : null}
          {chat.sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              className={cn(
                'rounded-md px-2 py-2 text-left text-sm hover:bg-muted',
                chat.selectedSession?.id === session.id && 'bg-muted',
              )}
              onClick={() => {
                void chat.openSession(session)
                closeMenu()
              }}
            >
              {session.title}
            </button>
          ))}
          {chat.sessionCursor ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => chat.loadMoreSessions()}
            >
              Load more conversations
            </Button>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
          <p className="truncate text-xs text-muted-foreground">{accountLabel ?? 'Signed in'}</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              chat.abandon()
              onSignOut()
            }}
          >
            Sign out
          </Button>
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <button
            type="button"
            className="md:hidden"
            aria-label="Open conversations"
            onClick={() => setMenuOpen(true)}
          >
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-medium">
              {chat.selectedSession?.title ?? chat.selectedAgent?.name ?? 'Chat'}
            </h1>
          </div>
          {showManage ? (
            <Link to="/manage" className="text-sm font-medium">
              Manage
            </Link>
          ) : null}
        </header>
        {chat.permissionError ? (
          <p className="border-b border-border px-4 py-2 text-sm" role="alert">
            {chat.permissionError}
          </p>
        ) : null}
        {chat.sessionNotice ? (
          <p className="border-b border-border px-4 py-2 text-sm" role="alert">
            {chat.sessionNotice}
          </p>
        ) : null}
        {chat.actionError ? (
          <p className="border-b border-border px-4 py-2 text-sm" role="alert">
            {chat.actionError}
          </p>
        ) : null}
        {chat.selectedSession ? (
          <Transcript
            entries={chat.entries}
            approval={chat.approval}
            deciding={chat.deciding}
            onDecide={(decision) => void chat.decide(decision)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-muted-foreground">
            {chat.selectedAgent
              ? 'Choose a conversation or start a new chat.'
              : 'Choose an agent to start.'}
          </div>
        )}
        <form onSubmit={onSubmit} className="border-t border-border p-4">
          {chat.approval ? (
            <p className="mb-2 text-sm text-muted-foreground">
              Resolve the pending tool call before sending another message.
            </p>
          ) : null}
          <div className="flex items-end gap-2">
            <textarea
              aria-label="Message"
              className="min-h-20 w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-sm"
              value={draft}
              disabled={!chat.selectedSession || Boolean(chat.approval) || chat.streaming}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
            />
            {chat.streaming ? (
              <Button type="button" variant="outline" onClick={chat.stop}>
                Stop
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!chat.selectedSession || Boolean(chat.approval) || draft.trim() === ''}
              >
                Send
              </Button>
            )}
          </div>
        </form>
      </section>
    </div>
  )
}
