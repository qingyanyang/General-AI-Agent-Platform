/** PROTOTYPE attachment chips, previews, and simulated output cards (#57). */
import { FileSpreadsheet, FileText, Image as ImageIcon, Loader2, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { Dialog } from '../ui'
import { formatBytes, statusLabel, type AssistantMedia, type ChartPoint, type MediaAttachment } from './media'

function fileIcon(attachment: Pick<MediaAttachment, 'kind'>): ReactNode {
  switch (attachment.kind) {
    case 'image':
      return <ImageIcon className="size-4" aria-hidden />
    case 'spreadsheet':
      return <FileSpreadsheet className="size-4" aria-hidden />
    case 'document':
    case 'other':
      return <FileText className="size-4" aria-hidden />
    default: {
      const unreachable: never = attachment.kind
      return unreachable
    }
  }
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export function AttachmentChip({
  attachment,
  onRemove,
  onRetry,
  onPreview,
}: {
  attachment: MediaAttachment
  onRemove?: () => void
  onRetry?: () => void
  onPreview?: () => void
}) {
  const problem = attachment.status === 'failed' || attachment.status === 'unsupported' || attachment.status === 'oversized'
  return (
    <li
      className={cn(
        'flex w-56 max-w-full shrink-0 items-center gap-2 rounded-xl border bg-card p-1.5',
        problem ? 'border-danger/40' : 'border-border',
      )}
    >
      {attachment.previewUrl ? (
        <button
          type="button"
          onClick={onPreview}
          className="size-10 shrink-0 overflow-hidden rounded-lg border border-border"
          aria-label={`Enlarge ${attachment.name}`}
        >
          <img src={attachment.previewUrl} alt="" className="size-full object-cover" />
        </button>
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {attachment.status === 'preparing' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            fileIcon(attachment)
          )}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium" title={attachment.name}>
          {attachment.name}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {attachment.typeLabel}
          {attachment.status === 'preparing' && attachment.size === 0 ? '' : ` · ${formatBytes(attachment.size)}`}
          {' · '}
          {statusLabel(attachment.status)}
        </p>
      </div>
      {attachment.retryable && onRetry ? (
        <button type="button" onClick={onRetry} className="shrink-0 text-[11px] font-medium text-primary hover:underline">
          Retry
        </button>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${attachment.name}`}
          title={`Remove ${attachment.name}`}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </li>
  )
}

export function ImagePreview({
  attachment,
  open,
  onClose,
}: {
  attachment: MediaAttachment | null
  open: boolean
  onClose: () => void
}) {
  return (
    <Dialog open={open} onRequestClose={onClose} title={attachment?.name ?? 'Preview'} description={attachment?.detail}>
      {attachment?.previewUrl ? (
        <img
          src={attachment.previewUrl}
          alt={attachment.detail}
          className="max-h-[60vh] w-full rounded-xl object-contain"
        />
      ) : (
        <p className="text-sm text-muted-foreground">No preview for this file.</p>
      )}
    </Dialog>
  )
}

export function MessageAttachments({ attachments }: { attachments: MediaAttachment[] }) {
  const [preview, setPreview] = useState<MediaAttachment | null>(null)
  if (attachments.length === 0) {
    return null
  }
  return (
    <>
      <ul className="mt-2 flex max-w-full gap-2 overflow-x-auto" aria-label="Attachments">
        {attachments.map((attachment) => (
          <AttachmentChip
            key={attachment.id}
            attachment={attachment}
            onPreview={attachment.previewUrl ? () => setPreview(attachment) : undefined}
          />
        ))}
      </ul>
      <ImagePreview attachment={preview} open={preview !== null} onClose={() => setPreview(null)} />
    </>
  )
}

function Chart({ title, points }: { title: string; points: ChartPoint[] }) {
  const max = Math.max(...points.map((point) => point.value), 1)
  return (
    <figure className="my-3 rounded-xl border border-border bg-card p-3">
      <figcaption className="text-xs font-medium text-muted-foreground">
        {title} · sample chart, not computed from an uploaded file
      </figcaption>
      <svg viewBox="0 0 320 140" role="img" aria-label={title} className="mt-2 h-36 w-full">
        {points.map((point, index) => {
          const height = (point.value / max) * 96
          const x = 28 + index * 100
          return (
            <g key={point.label}>
              <rect x={x} y={112 - height} width="48" height={height} rx="6" fill="#1f5a52" />
              <text x={x + 24} y="128" textAnchor="middle" fontSize="11" fill="#5f6965">
                {point.label}
              </text>
            </g>
          )
        })}
      </svg>
    </figure>
  )
}

export function AssistantExtras({ media }: { media: AssistantMedia }) {
  return (
    <div>
      {media.image ? (
        <figure className="my-3 max-w-sm">
          <img src={media.image.url} alt={media.image.alt} className="w-full rounded-xl border border-border" />
          <figcaption className="mt-1 text-xs text-muted-foreground">Simulated sample image</figcaption>
        </figure>
      ) : null}
      {media.chart ? <Chart title={media.chart.title} points={media.chart.points} /> : null}
      {media.files && media.files.length > 0 ? (
        <ul className="my-3 space-y-2" aria-label="Generated files">
          {media.files.map((file) => (
            <li
              key={file.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2"
            >
              <span className="text-muted-foreground">{fileIcon({ kind: file.kind })}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={file.name}>
                  {file.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {file.typeLabel} · {formatBytes(file.size)} · Generated output
                </p>
              </div>
              <button
                type="button"
                onClick={() => downloadBlob(file.name, file.blob)}
                className="text-xs font-medium text-primary hover:underline"
              >
                Download
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
