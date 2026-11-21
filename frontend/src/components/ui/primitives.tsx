/** Production UI primitives ported from the agent-management prototype. */
import {
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  CircleDot,
  Copy,
  Info,
  Loader2,
  X,
  XCircle,
} from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'

import { MarkdownMessage } from '@/components/chat/markdown-message'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground hover:bg-muted',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

function toneClass(tone: Tone): string {
  switch (tone) {
    case 'neutral':
      return 'border-border bg-muted text-muted-foreground'
    case 'primary':
      return 'border-primary/20 bg-primary-soft text-primary'
    case 'success':
      return 'border-success/20 bg-success-soft text-success'
    case 'warning':
      return 'border-warning/25 bg-warning-soft text-warning'
    case 'danger':
      return 'border-danger/20 bg-danger-soft text-danger'
    case 'info':
      return 'border-info/20 bg-info-soft text-info'
    default: {
      const unreachable: never = tone
      return unreachable
    }
  }
}

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        toneClass(tone),
        className,
      )}
    >
      {children}
    </span>
  )
}

export function AgentStatusBadge({ status }: { status: string }) {
  if (status === 'active') {
    return (
      <Badge tone="success">
        <CircleDot className="size-3" aria-hidden />
        Active
      </Badge>
    )
  }
  if (status === 'inactive') {
    return (
      <Badge tone="neutral">
        <Ban className="size-3" aria-hidden />
        Inactive
      </Badge>
    )
  }
  return <Badge>{status}</Badge>
}

type NoticeTone = 'error' | 'warning' | 'info' | 'success'

function noticeStyle(tone: NoticeTone): { className: string; icon: ReactNode } {
  switch (tone) {
    case 'error':
      return {
        className: 'border-danger/25 bg-danger-soft text-danger',
        icon: <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />,
      }
    case 'warning':
      return {
        className: 'border-warning/25 bg-warning-soft text-warning',
        icon: <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />,
      }
    case 'info':
      return {
        className: 'border-info/20 bg-info-soft text-info',
        icon: <Info className="mt-0.5 size-4 shrink-0" aria-hidden />,
      }
    case 'success':
      return {
        className: 'border-success/20 bg-success-soft text-success',
        icon: <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />,
      }
    default: {
      const unreachable: never = tone
      return unreachable
    }
  }
}

export function Notice({
  tone,
  title,
  children,
  action,
  className,
}: {
  tone: NoticeTone
  title?: string
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  const style = noticeStyle(tone)
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 rounded-xl border px-4 py-3 text-sm', style.className, className)}
    >
      {style.icon}
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn(title && 'mt-0.5', 'text-foreground/80')}>{children}</div> : null}
      </div>
      {action}
    </div>
  )
}

const inputClass =
  'w-full rounded-xl border border-border-strong bg-card px-3 py-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground/70 enabled:hover:border-muted-foreground/60 focus:border-primary disabled:bg-muted disabled:text-muted-foreground'

export function TextField({
  label,
  value,
  onChange,
  hint,
  placeholder,
  disabled,
  mono,
  maxLength,
  autoFocus,
  required,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: ReactNode
  placeholder?: string
  disabled?: boolean
  mono?: boolean
  maxLength?: number
  autoFocus?: boolean
  required?: boolean
  type?: 'text' | 'email' | 'date'
}) {
  const id = useId()
  const hintId = `${id}-hint`
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {required ? <span className="text-muted-foreground"> (required)</span> : null}
      </label>
      <input
        id={id}
        type={type}
        className={cn(inputClass, mono && 'font-mono')}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        data-dialog-focus={autoFocus || undefined}
        required={required}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function TextArea({
  label,
  value,
  onChange,
  hint,
  rows = 4,
  mono,
  disabled,
  placeholder,
  markdown = false,
  maxLength,
  maxHeight,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: ReactNode
  rows?: number
  mono?: boolean
  disabled?: boolean
  placeholder?: string
  markdown?: boolean
  maxLength?: number
  maxHeight?: string
}) {
  const id = useId()
  const [mode, setMode] = useState<'initial-edit' | 'edit' | 'preview'>(() =>
    markdown && value.trim() ? 'preview' : 'initial-edit',
  )
  const previewing = markdown && mode === 'preview'
  const hintId = hint || markdown || maxLength !== undefined ? `${id}-hint` : undefined
  const fieldLabel = previewing ? (
    <span className="block text-sm font-medium">{label}</span>
  ) : (
    <label htmlFor={id} className="block text-sm font-medium">
      {label}
    </label>
  )
  const height = { minHeight: `calc(${rows}lh + 1rem + 2px)`, maxHeight }

  return (
    <div className="space-y-1.5">
      {markdown ? (
        <div className="flex items-center justify-between gap-2">
          {fieldLabel}
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-controls={id}
            disabled={disabled}
            onClick={() => setMode(previewing ? 'edit' : 'preview')}
          >
            {previewing ? 'Edit' : 'Preview'}
          </Button>
        </div>
      ) : (
        fieldLabel
      )}
      {previewing ? (
        <div
          id={id}
          role="region"
          aria-label={`${label} Markdown preview`}
          style={height}
          className="markdown-preview overflow-auto rounded-xl border border-border-strong bg-card px-3 py-2 text-sm leading-relaxed"
        >
          {value.trim() ? (
            <MarkdownMessage content={value} />
          ) : (
            <p className="text-muted-foreground">Nothing to preview yet.</p>
          )}
        </div>
      ) : (
        <textarea
          id={id}
          rows={rows}
          className={cn(inputClass, 'resize-y leading-relaxed', mono && 'font-mono text-[13px]')}
          style={maxHeight ? height : undefined}
          value={value}
          maxLength={maxLength}
          disabled={disabled}
          placeholder={placeholder}
          aria-describedby={hintId}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {hintId ? (
        <div
          id={hintId}
          className={cn(
            'text-xs text-muted-foreground',
            markdown && 'flex flex-wrap justify-between gap-x-3 gap-y-1',
          )}
        >
          {markdown ? <span>Markdown supported</span> : null}
          {hint}
          {maxLength !== undefined ? (
            <span className={cn('tabular-nums', value.length > maxLength && 'text-danger')}>
              {value.length.toLocaleString()} / {maxLength.toLocaleString()} characters
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function SectionCard({
  title,
  description,
  children,
  aside,
  className,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  aside?: ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-2xl border border-border bg-card p-5 sm:p-6', className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-serif text-lg">{title}</h2>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function CopyText({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) {
      return
    }
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code
        className="min-w-0 flex-1 truncate rounded-lg border border-border bg-muted px-2.5 py-1.5 font-mono text-xs select-all"
        title={value}
      >
        {value}
      </code>
      <IconButton
        label={copied ? `${label} copied` : `Copy ${label}`}
        className="size-8"
        onClick={() => {
          void navigator.clipboard?.writeText(value).catch(() => undefined)
          setCopied(true)
        }}
      >
        {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      </IconButton>
      <span role="status" className="sr-only">
        {copied ? 'Copied' : ''}
      </span>
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-muted', className)} aria-hidden />
}

export function LoadingRows({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} className="space-y-2">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-14 w-full" />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border-strong bg-card px-6 py-10 text-center">
      {icon ? <div className="mb-3 text-primary">{icon}</div> : null}
      <p className="font-serif text-lg">{title}</p>
      {children ? <div className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

function closeDialog(node: HTMLDialogElement, previous: HTMLElement | null) {
  node.close()
  queueMicrotask(() => {
    if (previous?.isConnected && !node.open) {
      previous.focus()
    }
  })
}

/** Minimal modal dialog used by ConfirmDialog (no unsaved-guard hooks). */
function SimpleDialog({
  open,
  onRequestClose,
  title,
  children,
  footer,
  closeDisabled = false,
}: {
  open: boolean
  onRequestClose: () => void
  title: string
  children?: ReactNode
  footer?: ReactNode
  closeDisabled?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    const node = ref.current
    if (!node) {
      return
    }
    if (open && !node.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      node.showModal()
      const focusTarget = node.querySelector<HTMLElement>('[data-dialog-focus]:enabled')
      focusTarget?.focus()
    } else if (!open && node.open) {
      closeDialog(node, returnFocus.current)
    }
  }, [open])

  useEffect(() => {
    const node = ref.current
    return () => {
      if (node?.open) {
        closeDialog(node, returnFocus.current)
      }
    }
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        if (!closeDisabled) {
          onRequestClose()
        }
      }}
      onMouseDown={(event) => {
        if (!closeDisabled && event.target === ref.current) {
          onRequestClose()
        }
      }}
      className="m-auto max-h-[calc(100svh-2rem)] w-[calc(100%-1.5rem)] max-w-lg rounded-3xl border border-border bg-card p-0 text-foreground shadow-2xl"
    >
      {open ? (
        <div className="flex max-h-[inherit] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-border px-6 pt-6 pb-4">
            <h2 id={titleId} className="min-w-0 font-serif text-2xl leading-tight">
              {title}
            </h2>
            <IconButton label="Close dialog" onClick={onRequestClose} disabled={closeDisabled}>
              <X className="size-4" aria-hidden />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background/60 px-6 py-4">
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  )
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'primary',
  busy,
  confirmDisabled,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'primary' | 'danger'
  busy?: boolean
  confirmDisabled?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <SimpleDialog
      open={open}
      onRequestClose={onCancel}
      title={title}
      closeDisabled={busy}
      footer={
        <>
          <Button variant="outline" data-dialog-focus onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-foreground/80">{children}</div>
    </SimpleDialog>
  )
}

export function DangerZone({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="rounded-2xl border border-danger/30 bg-card p-5 sm:p-6">
      <h2 id={titleId} className="flex items-center gap-2 font-serif text-lg text-danger">
        <AlertTriangle className="size-4" aria-hidden />
        Danger zone
      </h2>
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <p className="font-medium">{title}</p>
          <p className="mt-1 text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>
    </section>
  )
}

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string }

export function SaveStatus({ state, dirty }: { state: SaveState; dirty: boolean }) {
  if (state.kind === 'saving') {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Saving…
      </span>
    )
  }
  if (dirty) {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-sm font-medium text-warning">
        <CircleDot className="size-3.5" aria-hidden />
        Unsaved changes
      </span>
    )
  }
  if (state.kind === 'saved') {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
        <Check className="size-4" aria-hidden />
        Saved
      </span>
    )
  }
  return <span role="status" className="sr-only" />
}
