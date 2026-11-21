import { FileText, Files, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { EmptyState, IconButton, LoadingRows, Notice, SectionCard } from '@/components/ui/primitives'
import { isApiError } from '@/lib/errors'
import type { KnowledgeReference, ManagementClient } from '@/lib/management'

export function KnowledgeReferencesPanel({
  agentId,
  client,
  onUnauthorized,
  baseline,
  draft,
  disabled,
  onLoad,
  onDraftChange,
}: {
  agentId: string
  client: Pick<ManagementClient, 'getKnowledgeReferences'>
  onUnauthorized: () => void
  baseline: KnowledgeReference[] | null
  draft: KnowledgeReference[] | null
  disabled: boolean
  onLoad: (references: KnowledgeReference[]) => void
  onDraftChange: (references: KnowledgeReference[] | null) => void
}) {
  const picker = useRef<HTMLInputElement>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const items = draft ?? baseline ?? []

  useEffect(() => {
    if (baseline !== null) {
      return
    }
    let active = true
    void client.getKnowledgeReferences(agentId).then(
      (references) => {
        if (active) {
          onLoad(references)
        }
      },
      (caught: unknown) => {
        if (!active) {
          return
        }
        if (isApiError(caught) && caught.status === 401) {
          onUnauthorized()
          return
        }
        setError(isApiError(caught) ? caught.message : 'Could not load knowledge references.')
      },
    )
    return () => {
      active = false
    }
  }, [agentId, baseline, client, loadAttempt, onLoad, onUnauthorized])

  function updateReferences(references: KnowledgeReference[]) {
    const matchesBaseline = baseline?.length === references.length &&
      references.every((item, index) => item.id === baseline[index].id)
    onDraftChange(matchesBaseline ? null : references)
  }

  return (
    <SectionCard
      title="Knowledge references"
      description="Document names and sizes saved for this agent."
      aside={baseline !== null ? (
        <Button
          variant="primary"
          disabled={disabled}
          onClick={() => picker.current?.click()}
        >
          <Plus className="size-4" aria-hidden />
          Add documents
        </Button>
      ) : null}
    >
      {baseline === null ? (
        error ? (
          <Notice
            tone="error"
            title="Could not load references"
            action={
              <Button size="sm" variant="outline" onClick={() => {
                setError(null)
                setLoadAttempt((attempt) => attempt + 1)
              }}>
                Retry
              </Button>
            }
          >
            {error}
          </Notice>
        ) : <LoadingRows label="Loading knowledge references" rows={2} />
      ) : (
        <>
          <input
            hidden
            ref={picker}
            type="file"
            aria-label="Add document references"
            accept=".pdf,.docx,.txt"
            multiple
            disabled={disabled}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? [])
              event.currentTarget.value = ''
              if (files.length === 0) {
                return
              }
              const references = files.map((file) => ({
                id: crypto.randomUUID(),
                name: file.name,
                size: `${file.size} B`,
              }))
              updateReferences([...items, ...references])
            }}
          />
          {items.length === 0 ? (
            <EmptyState
              icon={
                <span className="grid size-11 place-items-center rounded-xl bg-primary-soft">
                  <Files className="size-5" aria-hidden />
                </span>
              }
              title="No documents added"
            >
              Choose PDF, DOCX, or TXT files to add references.
            </EmptyState>
          ) : (
            <ul aria-label="Referenced documents" className="divide-y divide-border rounded-xl border border-border">
              {items.map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-3 py-3 sm:px-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                    <FileText className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium wrap-anywhere">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.size}</p>
                  </div>
                  <IconButton
                    label={`Remove ${item.name}`}
                    className="border-transparent text-muted-foreground hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                    disabled={disabled}
                    onClick={() => updateReferences(items.filter(({ id }) => id !== item.id))}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </SectionCard>
  )
}
