/** PROTOTYPE UI primitives (#52). Candidate shared design-system pieces; not production code. */
import {
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  CircleDot,
  Copy,
  Info,
  Loader2,
  PauseCircle,
  Plus,
  X,
  XCircle,
} from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from 'react'

import { executionStatusLabel, isExecutionStatus, type ExecutionStatus } from '@/lib/execution-status'
import { cn } from '@/lib/utils'

import { MarkdownMessage } from './chat/markdown'
import { useGuardedClose, useUnsaved } from './hooks'

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'danger-outline'
type ButtonSize = 'sm' | 'md'

const buttonBase =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50'

function buttonVariant(variant: ButtonVariant): string {
  switch (variant) {
    case 'primary':
      return 'bg-primary text-primary-foreground hover:bg-primary-hover'
    case 'outline':
      return 'border border-border-strong bg-card text-foreground hover:bg-muted'
    case 'ghost':
      return 'text-foreground hover:bg-muted'
    case 'danger':
      return 'bg-danger text-white hover:bg-danger/90'
    case 'danger-outline':
      return 'border border-danger/40 bg-card text-danger hover:bg-danger-soft'
    default: {
      const unreachable: never = variant
      return unreachable
    }
  }
}

function buttonSize(size: ButtonSize): string {
  switch (size) {
    case 'sm':
      return 'h-8 px-3 text-xs'
    case 'md':
      return 'h-10 px-5 text-sm'
    default: {
      const unreachable: never = size
      return unreachable
    }
  }
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      type={type}
      className={cn(buttonBase, buttonVariant(variant), buttonSize(size), className)}
      {...props}
    />
  )
}

export function AddButton({ children, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button {...props} aria-haspopup="dialog">
      <Plus className="size-4" aria-hidden />
      {children}
    </Button>
  )
}

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

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
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

function executionTone(status: ExecutionStatus): { tone: Tone; icon: ReactNode } {
  switch (status) {
    case 'running':
      return { tone: 'info', icon: <Loader2 className="size-3" aria-hidden /> }
    case 'awaiting_approval':
      return { tone: 'warning', icon: <PauseCircle className="size-3" aria-hidden /> }
    case 'succeeded':
      return { tone: 'success', icon: <CheckCircle2 className="size-3" aria-hidden /> }
    case 'failed':
      return { tone: 'danger', icon: <XCircle className="size-3" aria-hidden /> }
    case 'cancelled':
      return { tone: 'neutral', icon: <Ban className="size-3" aria-hidden /> }
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}

export function ExecutionStatusBadge({ status, count }: { status: string; count?: number }) {
  const countLabel = count === undefined ? null : <span className="tabular-nums">{count}</span>
  if (!isExecutionStatus(status)) {
    return (
      <Badge>
        {status}
        {countLabel}
      </Badge>
    )
  }
  const { tone, icon } = executionTone(status)
  return (
    <Badge tone={tone}>
      {icon}
      {executionStatusLabel(status)}
      {countLabel}
    </Badge>
  )
}

type NoticeTone = 'error' | 'warning' | 'info' | 'success'

function noticeStyle(tone: NoticeTone): { className: string; icon: ReactNode } {
  switch (tone) {
    case 'error':
      return { className: 'border-danger/25 bg-danger-soft text-danger', icon: <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> }
    case 'warning':
      return { className: 'border-warning/25 bg-warning-soft text-warning', icon: <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> }
    case 'info':
      return { className: 'border-info/20 bg-info-soft text-info', icon: <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> }
    case 'success':
      return { className: 'border-success/20 bg-success-soft text-success', icon: <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> }
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
  type?: 'text' | 'email'
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
  const [mode, setMode] = useState<'initial-edit' | 'edit' | 'preview'>(
    () => markdown && value.trim() ? 'preview' : 'initial-edit',
  )
  const previewing = markdown && mode === 'preview'
  const hintId = hint || markdown || maxLength !== undefined ? `${id}-hint` : undefined
  const fieldLabel = previewing
    ? <span className="block text-sm font-medium">{label}</span>
    : <label htmlFor={id} className="block text-sm font-medium">{label}</label>
  const height = { minHeight: `calc(${rows}lh + 1rem + 2px)`, maxHeight }

  return (
    <div className="space-y-1.5">
      {markdown ? (
        <div className="flex items-center justify-between gap-2">
          {fieldLabel}
          <Button
            size="sm"
            variant="outline"
            aria-controls={id}
            disabled={disabled}
            onClick={() => setMode(previewing ? 'edit' : 'preview')}
          >
            {previewing ? 'Edit' : 'Preview'}
          </Button>
        </div>
      ) : fieldLabel}
      {previewing ? (
        <div
          id={id}
          role="region"
          aria-label={`${label} Markdown preview`}
          style={height}
          className="overflow-auto rounded-xl border border-border-strong bg-card px-3 py-2 text-sm leading-relaxed"
          tabIndex={maxHeight ? 0 : undefined}
        >
          {value.trim() ? <MarkdownMessage content={value} /> : <p className="text-muted-foreground">Nothing to preview yet.</p>}
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
          autoFocus={mode === 'edit'}
          aria-describedby={hintId}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {hintId ? (
        <div id={hintId} className={cn('text-xs text-muted-foreground', markdown && 'flex flex-wrap justify-between gap-x-3 gap-y-1')}>
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

export function SelectField({
  label,
  value,
  onChange,
  children,
  hint,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
  hint?: ReactNode
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        className={cn(inputClass, 'h-10 py-0')}
        value={value}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
      {hint ? <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function CheckRow({
  label,
  description,
  checked,
  onChange,
  badge,
  disabled,
}: {
  label: string
  description?: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  badge?: ReactNode
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors',
        checked ? 'border-primary/40 bg-primary-soft/60' : 'border-border bg-card',
      )}
    >
      <input
        id={id}
        type="checkbox"
        className="mt-1 size-4 shrink-0 accent-[var(--color-primary)]"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer text-sm">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium break-all">{label}</span>
          {badge}
        </span>
        {description ? <span className="mt-0.5 block text-muted-foreground">{description}</span> : null}
      </label>
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

/** Shared destructive section: warning heading, action copy, and an outline button. */
export function DangerZone({
  title,
  description,
  action,
  children,
}: {
  title: string
  description: string
  action?: ReactNode
  children?: ReactNode
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
      <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-muted px-2.5 py-1.5 font-mono text-xs select-all" title={value}>
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

type DialogVariant = 'center' | 'wide' | 'drawer' | 'nav'

function dialogFrame(variant: DialogVariant): string {
  switch (variant) {
    case 'center':
      return 'm-auto max-h-[calc(100svh-2rem)] w-[calc(100%-1.5rem)] max-w-lg rounded-3xl'
    case 'wide':
      return 'm-auto max-h-[calc(100svh-2rem)] w-[calc(100%-1.5rem)] max-w-4xl rounded-3xl'
    case 'drawer':
      return 'my-0 mr-0 ml-auto h-svh max-h-svh w-full max-w-md rounded-none border-y-0 border-r-0 sm:rounded-l-3xl'
    case 'nav':
      return 'fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none rounded-none border-0 shadow-none'
    default: {
      const unreachable: never = variant
      return unreachable
    }
  }
}

function closeDialog(node: HTMLDialogElement, previous: HTMLElement | null) {
  node.close()
  queueMicrotask(() => {
    if (previous?.isConnected && !node.open) {
      previous.focus()
    }
  })
}

export function Dialog({
  open,
  onRequestClose,
  title,
  description,
  children,
  footer,
  variant = 'center',
  closeDisabled = false,
  focusForm = false,
}: {
  open: boolean
  onRequestClose: () => void
  title: string
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  variant?: DialogVariant
  closeDisabled?: boolean
  focusForm?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const node = ref.current
    if (!node) {
      return
    }
    if (open && !node.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      node.showModal()
      const focusTarget = node.querySelector<HTMLElement>('[data-dialog-focus]:enabled')
        ?? (focusForm ? node.querySelector<HTMLElement>('form :is(input:not([type="hidden"]), select, textarea):enabled') : null)
      focusTarget?.focus()
    } else if (!open && node.open) {
      closeDialog(node, returnFocus.current)
    }
  }, [open, focusForm])

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
      aria-describedby={description ? descriptionId : undefined}
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
      className={cn('border border-border bg-card p-0 text-foreground shadow-2xl', dialogFrame(variant))}
    >
      {open ? (
        <div className={cn('flex max-h-[inherit] flex-col', variant !== 'center' && variant !== 'wide' && 'h-full')}>
          <div
            className={cn(
              'flex items-start justify-between gap-4 border-b border-border',
              variant === 'nav' ? 'px-4 pt-4 pb-3' : 'px-6 pt-6 pb-4',
            )}
          >
            <div className="min-w-0">
              <h2 id={titleId} className="font-serif text-2xl leading-tight">
                {title}
              </h2>
              {description ? <div id={descriptionId} className="mt-1.5 text-sm text-muted-foreground">{description}</div> : null}
            </div>
            <IconButton label="Close dialog" onClick={onRequestClose} disabled={closeDisabled}>
              <X className="size-4" aria-hidden />
            </IconButton>
          </div>
          <div className={cn('min-h-0 flex-1', variant === 'nav' ? 'flex flex-col' : 'overflow-y-auto px-6 py-5')}>
            {children}
          </div>
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

export function FormDialog({
  open,
  title,
  description,
  onClose,
  onSubmit,
  submitLabel,
  pendingLabel = 'Saving…',
  busy = false,
  dirty = false,
  disabled = false,
  error,
  children,
  variant = 'center',
}: {
  open: boolean
  title: string
  description?: ReactNode
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  submitLabel: string
  pendingLabel?: string
  busy?: boolean
  dirty?: boolean
  disabled?: boolean
  error?: string | null
  children: ReactNode
  variant?: 'center' | 'wide'
}) {
  const formId = useId()
  const guard = useGuardedClose(dirty, onClose)
  useUnsaved(title, open && dirty)

  return (
    <>
      <Dialog
        open={open}
        title={title}
        description={description}
        variant={variant}
        onRequestClose={guard.request}
        closeDisabled={busy}
        focusForm
        footer={
          <>
            <Button variant="outline" onClick={guard.request} disabled={busy}>Cancel</Button>
            <Button type="submit" form={formId} disabled={disabled || busy}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {busy ? pendingLabel : submitLabel}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="space-y-4"
          aria-busy={busy}
          onSubmit={(event) => {
            event.preventDefault()
            if (!disabled && !busy) {
              onSubmit(event)
            }
          }}
        >
          {error ? <Notice tone="error">{error}</Notice> : null}
          <fieldset disabled={busy} className="min-w-0 space-y-4">
            {children}
          </fieldset>
        </form>
      </Dialog>
      <ConfirmDialog
        open={open && guard.confirming}
        title="Discard unsaved changes?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={guard.confirm}
        onCancel={guard.cancel}
      >
        Your changes in this dialog will be lost.
      </ConfirmDialog>
    </>
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
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog
      open={open}
      onRequestClose={onCancel}
      title={title}
      closeDisabled={busy}
      footer={
        <>
          <Button variant="outline" data-dialog-focus onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-foreground/80">{children}</div>
    </Dialog>
  )
}

export type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string }

export function InlineFormActions({
  dirty,
  state = { kind: 'idle' },
  onCancel,
  disabled = false,
  saveLabel = 'Save changes',
}: {
  dirty: boolean
  state?: SaveState
  onCancel: () => void
  disabled?: boolean
  saveLabel?: string
}) {
  const saving = state.kind === 'saving'
  return (
    <div className="space-y-3 border-t border-border pt-4">
      {state.kind === 'error' ? <Notice tone="error" title="Changes couldn’t be saved">{state.message}</Notice> : null}
      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        <div className="mr-auto"><SaveStatus state={state} dirty={dirty} /></div>
        <div className="ml-auto flex items-center gap-2">
          {dirty ? <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button> : null}
          <Button type="submit" disabled={!dirty || disabled || saving}>{saveLabel}</Button>
        </div>
      </div>
    </div>
  )
}

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
