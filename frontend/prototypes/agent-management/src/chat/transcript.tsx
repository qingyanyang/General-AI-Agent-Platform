/** PROTOTYPE transcript (#53): messages, tool activity, approval card, and smart auto-scroll. */
import {
  ArrowDown,
  Check,
  CircleAlert,
  CircleStop,
  Loader2,
  ShieldAlert,
  Wrench,
  X,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import type { PendingApproval } from '@/lib/types'
import { cn } from '@/lib/utils'

import type { TranscriptEntry } from '../chat-store'
import { Button } from '../ui'
import { MarkdownMessage } from './markdown'
import { AssistantExtras, MessageAttachments } from './media-ui'

const PIN_THRESHOLD = 96

function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function ArgumentList({ args }: { args: Record<string, unknown> }) {
  const entries = Object.entries(args)
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No arguments.</p>
  }
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-xl border border-border bg-card px-3 py-2 font-mono text-xs">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-muted-foreground">{key}</dt>
          <dd className="break-words">{formatValue(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

function UserMessage({ entry }: { entry: TranscriptEntry }) {
  const attachments = entry.attachments ?? []
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] min-w-0">
        {entry.content ? (
          <div className="rounded-2xl rounded-br-md bg-primary-soft px-4 py-2.5 text-sm whitespace-pre-wrap break-words">
            <span className="sr-only">You: </span>
            {entry.content}
          </div>
        ) : (
          <span className="sr-only">You sent attachments.</span>
        )}
        {attachments.length > 0 ? <MessageAttachments attachments={attachments} /> : null}
      </div>
    </div>
  )
}

function AssistantMessage({ entry, agentName }: { entry: TranscriptEntry; agentName: string }) {
  const thinking = entry.pending && entry.content === ''
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
          <>
            <MarkdownMessage content={entry.content} />
            {entry.media ? <AssistantExtras media={entry.media} /> : null}
          </>
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

function ActivityRow({ icon, children, className }: { icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('ml-10 rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm', className)}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
        <div className="min-w-0 flex-1">{children}</div>
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
        <pre className="mt-2 overflow-x-auto rounded-lg bg-card p-2 font-mono text-xs whitespace-pre-wrap break-words">
          {entry.content || '(empty)'}
        </pre>
      </details>
    </ActivityRow>
  )
}

function DecisionRecord({ entry }: { entry: TranscriptEntry }) {
  const approved = entry.content === 'Approved'
  return (
    <ActivityRow
      icon={approved ? <Check className="size-4 text-success" aria-hidden /> : <X className="size-4 text-danger" aria-hidden />}
    >
      <p>
        {approved ? 'You approved' : 'You rejected'} <code className="font-mono text-xs">{entry.toolName}</code>
        {entry.args ? (
          <span className="ml-1 font-mono text-xs text-muted-foreground">
            ({Object.entries(entry.args).map(([key, value]) => `${key}=${formatValue(value)}`).join(', ')})
          </span>
        ) : null}
      </p>
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

function Entry({ entry, agentName }: { entry: TranscriptEntry; agentName: string }) {
  switch (entry.role) {
    case 'user':
      return <UserMessage entry={entry} />
    case 'assistant':
      return <AssistantMessage entry={entry} agentName={agentName} />
    case 'tool':
      return <ToolActivity entry={entry} />
    case 'decision':
      return <DecisionRecord entry={entry} />
    case 'notice':
      return <NoticeLine content={entry.content} />
    default: {
      const unreachable: never = entry.role
      return unreachable
    }
  }
}

export function ApprovalCard({
  approval,
  agentName,
  deciding,
  canDecide,
  onDecide,
}: {
  approval: PendingApproval
  agentName: string
  deciding: 'approve' | 'reject' | null
  canDecide: boolean
  onDecide: (decision: 'approve' | 'reject') => void
}) {
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
        {agentName} wants to run <code className="font-mono text-xs">{approval.tool_name}</code> with:
      </p>
      <div className="mt-3">
        <ArgumentList args={approval.arguments} />
      </div>
      {canDecide ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onDecide('approve')} disabled={deciding !== null}>
            {deciding === 'approve' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
            {deciding === 'approve' ? 'Approving…' : 'Approve'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onDecide('reject')} disabled={deciding !== null}>
            {deciding === 'reject' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <X className="size-3.5" aria-hidden />}
            {deciding === 'reject' ? 'Rejecting…' : 'Reject'}
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          Only someone who can run this agent can approve or reject this call.
        </p>
      )}
    </section>
  )
}

export function Transcript({
  entries,
  agentName,
  footer,
  resetKey,
}: {
  entries: TranscriptEntry[]
  agentName: string
  footer?: ReactNode
  resetKey: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const [unseen, setUnseen] = useState(false)

  const scrollToEnd = (behavior: ScrollBehavior = 'auto') => {
    const element = scrollRef.current
    if (element) {
      element.scrollTo({ top: element.scrollHeight, behavior })
    }
    pinnedRef.current = true
    setUnseen(false)
  }

  useLayoutEffect(() => {
    pinnedRef.current = true
    scrollToEnd()
  }, [resetKey])

  useLayoutEffect(() => {
    if (pinnedRef.current) {
      scrollToEnd()
    } else {
      setUnseen(true)
    }
  }, [entries, footer])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) {
      return
    }
    const onScroll = () => {
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight
      pinnedRef.current = distance < PIN_THRESHOLD
      if (pinnedRef.current) {
        setUnseen(false)
      }
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} className="h-full overflow-y-auto" tabIndex={-1}>
        <ol aria-label="Messages" className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Entry entry={entry} agentName={agentName} />
            </li>
          ))}
          {footer ? <li>{footer}</li> : null}
        </ol>
      </div>
      {unseen ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <Button size="sm" variant="outline" className="pointer-events-auto shadow-md" onClick={() => scrollToEnd('smooth')}>
            <ArrowDown className="size-3.5" aria-hidden />
            Jump to latest
          </Button>
        </div>
      ) : null}
    </div>
  )
}
