/** PROTOTYPE composer (#53, #57): text, attachments, and simulated voice. */
import { ArrowUp, FlaskConical, Mic, Paperclip, Square } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'

import { cn } from '@/lib/utils'

import { useOptions } from '../mock/options'
import { AttachmentChip, ImagePreview } from './media-ui'
import {
  ATTACHMENT_LIMITS,
  attachmentFromFile,
  demonstrationAttachment,
  describeLimits,
  fixtureAttachment,
  fixturePlaceholder,
  recoverAttachment,
  simulatedTranscript,
  type FixtureId,
  type MediaAttachment,
} from './media'

const MESSAGE_MAX_LENGTH = 32_000
const COUNT_FROM = 30_000
const MAX_HEIGHT = 200
const PREPARE_MS = 450

const DEMO_PROMPTS = [
  'Show your setup as a table',
  'Multiply 1240 by 1.1, then double it',
  'Add 2150 and 1380',
  'echo: site induction booked',
  'Write some SQL code',
  'Sample PDF',
  'Sample PNG',
  'Sample JPEG',
  'Sample DOCX',
  'Sample XLSX',
  'Sample CSV',
]

type VoiceState = 'idle' | 'recording' | 'transcribing'

export function Composer({
  agentName,
  disabledReason,
  streaming,
  busy,
  onSend,
  onStop,
}: {
  agentName: string
  disabledReason: string | null
  streaming: boolean
  busy: boolean
  onSend: (content: string, attachments: MediaAttachment[]) => Promise<boolean>
  onStop: () => void
}) {
  const { demoPrompts } = useOptions()
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<MediaAttachment[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [voice, setVoice] = useState<VoiceState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [preview, setPreview] = useState<MediaAttachment | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const attachRef = useRef<HTMLButtonElement>(null)
  const dropped = useRef(new Set<string>())
  const menuId = useId()
  const disabled = disabledReason !== null
  const trimmed = value.trim()
  const tooLong = trimmed.length > MESSAGE_MAX_LENGTH
  const preparing = attachments.some((item) => item.status === 'preparing')
  const blockedFile = attachments.some((item) => item.status !== 'ready' && item.status !== 'preparing')
  const readyCount = attachments.filter((item) => item.status === 'ready').length
  const canSend =
    !disabled &&
    !streaming &&
    !busy &&
    voice === 'idle' &&
    !preparing &&
    !blockedFile &&
    !tooLong &&
    (trimmed !== '' || readyCount > 0)

  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) {
      return
    }
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`
  }, [value])

  useEffect(() => {
    if (voice !== 'recording') {
      return
    }
    const timer = window.setInterval(() => setElapsed((current) => current + 1), 1000)
    return () => window.clearInterval(timer)
  }, [voice])

  useEffect(() => {
    if (!menuOpen) {
      return
    }
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [menuOpen])

  const delay = (ms: number, id: string) =>
    new Promise<boolean>((resolve) => {
      window.setTimeout(() => resolve(!dropped.current.has(id)), ms)
    })

  const roomFor = (count: number) => {
    if (attachments.length + count > ATTACHMENT_LIMITS.maxCount) {
      setNotice(`You can attach up to ${ATTACHMENT_LIMITS.maxCount} files.`)
      return false
    }
    setNotice(null)
    return true
  }

  const addPrepared = async (id: string, produce: () => MediaAttachment | Promise<MediaAttachment>) => {
    const kept = await delay(PREPARE_MS, id)
    if (!kept) {
      return
    }
    const next = await produce()
    if (dropped.current.has(id)) {
      if (next.ownsPreview && next.previewUrl) {
        URL.revokeObjectURL(next.previewUrl)
      }
      return
    }
    setAttachments((current) => current.map((item) => (item.id === id ? { ...next, id } : item)))
  }

  const stage = (placeholder: MediaAttachment, produce: () => MediaAttachment | Promise<MediaAttachment>) => {
    setAttachments((current) => [
      ...current,
      { ...placeholder, status: 'preparing', detail: 'Preparing…', retryable: false },
    ])
    void addPrepared(placeholder.id, produce)
  }

  const addFiles = (files: File[]) => {
    if (!roomFor(files.length)) {
      return
    }
    for (const file of files) {
      const ready = attachmentFromFile(file)
      stage(ready, () => ready)
    }
  }

  const addFixture = (id: FixtureId) => {
    if (!roomFor(1)) {
      return
    }
    stage(fixturePlaceholder(id), () => fixtureAttachment(id))
  }

  const addDemo = (kind: 'oversized' | 'failed' | 'unsupported') => {
    if (!roomFor(1)) {
      return
    }
    const ready = demonstrationAttachment(kind)
    stage(ready, () => ready)
  }

  const removeAttachment = (attachment: MediaAttachment) => {
    dropped.current.add(attachment.id)
    if (attachment.ownsPreview && attachment.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl)
    }
    setAttachments((current) => current.filter((item) => item.id !== attachment.id))
    setNotice(null)
  }

  const retryAttachment = (attachment: MediaAttachment) => {
    dropped.current.delete(attachment.id)
    setAttachments((current) =>
      current.map((item) => (item.id === attachment.id ? { ...item, status: 'preparing', detail: 'Preparing…' } : item)),
    )
    void addPrepared(attachment.id, () => recoverAttachment(attachment))
  }

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!canSend) {
      return
    }
    const content = value
    const snapshot = attachments
    setValue('')
    setAttachments([])
    setNotice(null)
    const accepted = await onSend(content, snapshot)
    if (!accepted) {
      setValue((current) => (current === '' ? content : current))
      setAttachments((current) => (current.length === 0 ? snapshot : current))
    }
    textareaRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
    }
  }

  const onDrop = (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault()
    setDragging(false)
    if (disabled) {
      return
    }
    addFiles([...event.dataTransfer.files])
  }

  const stopVoice = () => {
    setVoice('transcribing')
    window.setTimeout(() => {
      setVoice('idle')
      setElapsed(0)
      const transcript = simulatedTranscript()
      setValue((current) => (current.trim() ? `${current.replace(/\s+$/, '')} ${transcript}` : transcript))
      textareaRef.current?.focus()
    }, 500)
  }

  const cancelVoice = () => {
    setVoice('idle')
    setElapsed(0)
    textareaRef.current?.focus()
  }

  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
  const sendHint = preparing
    ? 'Wait until every attachment is ready.'
    : blockedFile
      ? 'Remove files that are not ready, or retry the failed one. The text draft is kept.'
      : voice !== 'idle'
        ? 'Simulated voice. No microphone is used. Edit the text, then send it yourself.'
        : null

  return (
    <div className="shrink-0 border-t border-border bg-background/95 px-4 pt-3 pb-4 backdrop-blur sm:px-6">
      <div className="mx-auto max-w-3xl">
        {demoPrompts && !disabled ? (
          <div
            className="-mx-1 mb-1 flex items-center gap-1.5 overflow-x-auto px-1 py-1 sm:flex-wrap sm:overflow-visible"
            aria-label="Prototype demo prompts"
            role="group"
          >
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold tracking-wide text-background">
              <FlaskConical className="size-3" aria-hidden />
              PROTOTYPE
            </span>
            {DEMO_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => {
                  setValue(prompt)
                  textareaRef.current?.focus()
                }}
                className="shrink-0 rounded-full border border-dashed border-border-strong px-2.5 py-0.5 text-xs whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {prompt}
              </button>
            ))}
          </div>
        ) : null}
        <form
          onSubmit={(event) => void submit(event)}
          onDragOver={(event) => {
            event.preventDefault()
            if (!disabled) {
              setDragging(true)
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'rounded-3xl border border-border-strong bg-card p-2 shadow-sm focus-within:border-primary',
            disabled && 'bg-muted',
            dragging && 'border-primary bg-primary-soft/40',
          )}
        >
          {attachments.length > 0 ? (
            <ul className="mb-2 flex gap-2 overflow-x-auto px-1" aria-label="Attachments to send">
              {attachments.map((attachment) => (
                <AttachmentChip
                  key={attachment.id}
                  attachment={attachment}
                  onRemove={() => removeAttachment(attachment)}
                  onRetry={attachment.retryable ? () => retryAttachment(attachment) : undefined}
                  onPreview={attachment.previewUrl ? () => setPreview(attachment) : undefined}
                />
              ))}
            </ul>
          ) : null}
          {voice === 'recording' ? (
            <div className="mb-2 flex items-center gap-2 rounded-2xl bg-danger-soft px-3 py-2 text-sm text-danger" role="status">
              <span className="size-2 shrink-0 rounded-full bg-danger" aria-hidden />
              <span className="font-medium">Simulated recording</span>
              <span className="font-mono tabular-nums">{clock}</span>
              <span className="min-w-0 flex-1 truncate text-xs">No microphone is used.</span>
              <button type="button" onClick={stopVoice} className="font-medium hover:underline">
                Stop
              </button>
              <button type="button" onClick={cancelVoice} className="font-medium hover:underline">
                Cancel
              </button>
            </div>
          ) : null}
          {voice === 'transcribing' ? (
            <p className="mb-2 px-2 text-xs text-muted-foreground" role="status">
              Simulated transcription…
            </p>
          ) : null}
          <div className="flex items-end gap-1.5">
            <div ref={menuRef} className="relative shrink-0">
              <button
                ref={attachRef}
                type="button"
                disabled={disabled}
                aria-expanded={menuOpen}
                aria-controls={menuId}
                aria-label="Add attachment"
                title="Add attachment"
                onClick={() => setMenuOpen((open) => !open)}
                className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Paperclip className="size-4" aria-hidden />
              </button>
              {menuOpen ? (
                <div
                  id={menuId}
                  role="menu"
                  aria-label="Attachment options"
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.stopPropagation()
                      setMenuOpen(false)
                      attachRef.current?.focus()
                    }
                  }}
                  className="absolute bottom-11 left-0 z-20 w-64 rounded-2xl border border-border bg-card p-1 shadow-lg"
                >
                  <MenuButton
                    label="Choose files"
                    onClick={() => {
                      setMenuOpen(false)
                      fileRef.current?.click()
                    }}
                  />
                  <MenuButton
                    label="Sample invoice image"
                    onClick={() => {
                      setMenuOpen(false)
                      addFixture('invoice')
                    }}
                  />
                  <MenuButton
                    label="Sample policy PDF"
                    onClick={() => {
                      setMenuOpen(false)
                      addFixture('policy')
                    }}
                  />
                  <MenuButton
                    label="Sample costs spreadsheet"
                    onClick={() => {
                      setMenuOpen(false)
                      addFixture('costs')
                    }}
                  />
                  <div className="my-1 border-t border-border" />
                  <MenuButton
                    label="Demonstrate oversized file"
                    onClick={() => {
                      setMenuOpen(false)
                      addDemo('oversized')
                    }}
                  />
                  <MenuButton
                    label="Demonstrate preparation failure"
                    onClick={() => {
                      setMenuOpen(false)
                      addDemo('failed')
                    }}
                  />
                  <MenuButton
                    label="Demonstrate unsupported file"
                    onClick={() => {
                      setMenuOpen(false)
                      addDemo('unsupported')
                    }}
                  />
                </div>
              ) : null}
            </div>
            <input
              ref={fileRef}
              type="file"
              multiple
              aria-label="Choose files to attach"
              className="sr-only"
              onChange={(event) => {
                addFiles([...(event.target.files ?? [])])
                event.target.value = ''
              }}
            />
            <button
              type="button"
              disabled={disabled || voice === 'transcribing'}
              aria-pressed={voice === 'recording'}
              aria-label={voice === 'recording' ? 'Stop simulated recording' : 'Start simulated voice input'}
              title="Simulated voice"
              onClick={() => {
                if (voice === 'recording') {
                  stopVoice()
                  return
                }
                setElapsed(0)
                setVoice('recording')
              }}
              className={cn(
                'inline-flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50',
                voice === 'recording' ? 'bg-danger-soft text-danger' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Mic className="size-4" aria-hidden />
            </button>
            <label htmlFor="composer-input" className="sr-only">
              Message {agentName}
            </label>
            <textarea
              id="composer-input"
              ref={textareaRef}
              rows={1}
              value={value}
              disabled={disabled}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={disabled ? 'Messaging is unavailable' : `Message ${agentName}…`}
              aria-describedby="composer-hint"
              className="max-h-[200px] min-h-9 min-w-0 flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed"
            />
            {streaming ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop response"
                title="Stop response"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background hover:bg-foreground/85"
              >
                <Square className="size-3.5 fill-current" aria-hidden />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                aria-label="Send message"
                title="Send message"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-muted-foreground"
              >
                <ArrowUp className="size-4" aria-hidden />
              </button>
            )}
          </div>
        </form>
        <p id="composer-hint" className={cn('mt-2 px-2 text-xs', disabled ? 'text-foreground' : 'text-muted-foreground')}>
          {disabledReason ?? sendHint ?? notice ?? (
            <>
              {tooLong ? (
                <span className="text-danger">
                  Too long: {trimmed.length.toLocaleString()} / {MESSAGE_MAX_LENGTH.toLocaleString()} characters.
                </span>
              ) : trimmed.length >= COUNT_FROM ? (
                `${trimmed.length.toLocaleString()} / ${MESSAGE_MAX_LENGTH.toLocaleString()} characters. `
              ) : (
                <span className="hidden sm:inline">Enter to send · Shift+Enter for a new line. </span>
              )}
              {describeLimits()}
              {streaming ? <span> Responding… press Stop to end the response.</span> : null}
            </>
          )}
        </p>
        <ImagePreview attachment={preview} open={preview !== null} onClose={() => setPreview(null)} />
      </div>
    </div>
  )
}

function MenuButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-muted"
    >
      {label}
    </button>
  )
}
