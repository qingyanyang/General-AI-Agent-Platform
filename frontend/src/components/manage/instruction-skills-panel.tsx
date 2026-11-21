import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'

import { Button } from '@/components/ui/button'
import {
  ConfirmDialog,
  IconButton,
  Notice,
  SectionCard,
  TextArea,
  TextField,
  type SaveState,
} from '@/components/ui/primitives'
import { isApiError } from '@/lib/errors'
import { writeInstructionEligibility } from '@/lib/instruction-eligibility-cache'
import {
  DESCRIPTION_MAX_LENGTH,
  INSTRUCTIONS_MAX_LENGTH,
  MAX_ITEMS,
  NAME_MAX_LENGTH,
  validateDraftItems,
  type InstructionSkillDraftFields,
} from '@/lib/instruction-skills'
import type { InstructionSkillItem, ManagementClient } from '@/lib/management'

type DraftItem = InstructionSkillDraftFields & { localId: string; serverId: string | null }

type InstructionSkillsPanelProps = {
  agentId: string
  client: ManagementClient
  initialItems: InstructionSkillItem[]
  onUnauthorized: () => void
  onBaselineChange?: (items: InstructionSkillItem[]) => void
  /** When false, the parent page owns the single Publish button. */
  showPublish?: boolean
  publishRef?: MutableRefObject<(() => Promise<boolean>) | null>
  onDirtyChange?: (dirty: boolean) => void
  /** Restores an unpublished skill list after leaving this page. Null means no skill draft. */
  draftFields?: InstructionSkillDraftFields[] | null
  onFieldsChange?: (fields: InstructionSkillDraftFields[] | null) => void
}

function toDraft(items: InstructionSkillItem[]): DraftItem[] {
  return items.map((item) => ({
    localId: item.id,
    serverId: item.id,
    name: item.name,
    description: item.description,
    instructions: item.instructions,
  }))
}

function fromFields(fields: InstructionSkillDraftFields[]): DraftItem[] {
  return fields.map((item) => ({
    localId: crypto.randomUUID(),
    serverId: null,
    name: item.name,
    description: item.description,
    instructions: item.instructions,
  }))
}

function fieldsOf(items: DraftItem[]): InstructionSkillDraftFields[] {
  return items.map(({ name, description, instructions }) => ({ name, description, instructions }))
}

function sameBaseline(left: DraftItem[], right: InstructionSkillItem[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  return left.every((item, index) => {
    const baseline = right[index]
    return (
      item.name === baseline.name &&
      item.description === baseline.description &&
      item.instructions === baseline.instructions
    )
  })
}

const EMPTY_EDITOR: InstructionSkillDraftFields = {
  name: '',
  description: '',
  instructions: '',
}

export function InstructionSkillsPanel({
  agentId,
  client,
  initialItems,
  onUnauthorized,
  onBaselineChange,
  showPublish = true,
  publishRef,
  onDirtyChange,
  draftFields = null,
  onFieldsChange,
}: InstructionSkillsPanelProps) {
  const draftFieldsRef = useRef(draftFields)
  draftFieldsRef.current = draftFields
  const [baseline, setBaseline] = useState<InstructionSkillItem[]>(initialItems)
  const [draft, setDraft] = useState<DraftItem[]>(() =>
    draftFields ? fromFields(draftFields) : toDraft(initialItems),
  )
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' })
  const [editorIndex, setEditorIndex] = useState<number | null>(null)
  const [editorValue, setEditorValue] = useState<InstructionSkillDraftFields>(EMPTY_EDITOR)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<number | null>(null)
  const generation = useRef(0)
  const publishTicket = useRef(0)

  useEffect(() => {
    generation.current += 1
    const seed = draftFieldsRef.current
    setBaseline(initialItems)
    setDraft(seed ? fromFields(seed) : toDraft(initialItems))
    setSaveState({ kind: 'idle' })
    setEditorIndex(null)
    setDiscardOpen(false)
    setPendingDelete(null)
  }, [agentId, initialItems])

  const dirty = useMemo(() => !sameBaseline(draft, baseline), [baseline, draft])
  const publishing = saveState.kind === 'saving'

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    onFieldsChange?.(dirty ? fieldsOf(draft) : null)
  }, [dirty, draft, onFieldsChange])

  function openAdd() {
    setEditorIndex(-1)
    setEditorValue(EMPTY_EDITOR)
    setEditorError(null)
  }

  function openEdit(index: number) {
    const item = draft[index]
    setEditorIndex(index)
    setEditorValue({
      name: item.name,
      description: item.description,
      instructions: item.instructions,
    })
    setEditorError(null)
  }

  function applyEditor() {
    if (editorIndex === null) {
      return
    }
    const nextFields: InstructionSkillDraftFields = {
      name: editorValue.name,
      description: editorValue.description,
      instructions: editorValue.instructions,
    }
    const nextDraft =
      editorIndex === -1
        ? [
            ...draft,
            {
              localId: `draft-${crypto.randomUUID()}`,
              serverId: null,
              ...nextFields,
            },
          ]
        : draft.map((item, index) =>
            index === editorIndex ? { ...item, ...nextFields } : item,
          )
    const validation = validateDraftItems(fieldsOf(nextDraft))
    if (validation) {
      setEditorError(validation)
      return
    }
    setDraft(nextDraft)
    setEditorIndex(null)
    setSaveState({ kind: 'idle' })
  }

  function confirmDelete() {
    if (pendingDelete === null) {
      return
    }
    setDraft((current) => current.filter((_, index) => index !== pendingDelete))
    setPendingDelete(null)
    setSaveState({ kind: 'idle' })
  }

  function discard() {
    setDraft(toDraft(baseline))
    setSaveState({ kind: 'idle' })
    setDiscardOpen(false)
  }

  async function publish() {
    const validation = validateDraftItems(fieldsOf(draft))
    if (validation) {
      setSaveState({ kind: 'error', message: validation })
      return false
    }
    const ticket = publishTicket.current + 1
    publishTicket.current = ticket
    const gen = generation.current
    setSaveState({ kind: 'saving' })
    try {
      const result = await client.putInstructionSkills(agentId, fieldsOf(draft))
      if (generation.current !== gen || publishTicket.current !== ticket) {
        return false
      }
      setBaseline(result.items)
      setDraft(toDraft(result.items))
      writeInstructionEligibility(agentId, { status: 'eligible', items: result.items })
      setSaveState({ kind: 'saved' })
      onBaselineChange?.(result.items)
      return true
    } catch (error) {
      if (generation.current !== gen || publishTicket.current !== ticket) {
        return false
      }
      if (isApiError(error) && error.status === 401) {
        onUnauthorized()
        return false
      }
      setSaveState({
        kind: 'error',
        message: isApiError(error) ? error.message : 'Could not publish Instruction Skills.',
      })
      return false
    }
  }

  useEffect(() => {
    if (!publishRef) {
      return
    }
    publishRef.current = publish
    return () => {
      publishRef.current = null
    }
  })

  const editorOpen = editorIndex !== null
  const editingExisting = editorIndex !== null && editorIndex >= 0

  return (
    <div className="space-y-4" aria-busy={publishing}>
      <SectionCard
        title="Instruction Skills"
        description="Business rules the agent can use for specific tasks."
        aside={
          <Button
            type="button"
            size="sm"
            disabled={draft.length >= MAX_ITEMS || publishing}
            onClick={openAdd}
          >
            <Plus className="size-4" aria-hidden />
            Add skill
          </Button>
        }
      >
        {draft.length === 0 ? (
          <p className="text-sm text-muted-foreground">No skills added yet.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {draft.map((skill, index) => (
              <li key={skill.localId} className="flex items-start gap-2 px-3 py-2.5">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-start rounded-lg px-1 py-1 text-left hover:bg-muted disabled:opacity-60"
                  aria-haspopup="dialog"
                  aria-label={`Edit ${skill.name || 'skill'}`}
                  disabled={publishing}
                  onClick={() => openEdit(index)}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium break-words">
                      {skill.name.trim() || 'Untitled skill'}
                    </span>
                    {skill.description ? (
                      <span className="mt-0.5 line-clamp-2 text-sm break-words text-muted-foreground">
                        {skill.description}
                      </span>
                    ) : null}
                  </span>
                </button>
                <IconButton
                  label={`Remove ${skill.name || 'skill'}`}
                  className="size-8 text-danger hover:bg-danger-soft"
                  disabled={publishing}
                  onClick={() => setPendingDelete(index)}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {saveState.kind === 'error' && !dirty ? (
        <Notice tone="error">{saveState.message}</Notice>
      ) : null}

      {saveState.kind === 'error' ? <Notice tone="error">{saveState.message}</Notice> : null}
      {showPublish && dirty ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="ghost" disabled={publishing} onClick={() => setDiscardOpen(true)}>
            Discard
          </Button>
          <Button type="button" disabled={publishing} onClick={() => void publish()}>
            {publishing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {publishing ? 'Publishing…' : 'Publish Instruction Skills'}
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={editorOpen}
        title={editingExisting ? 'Edit skill' : 'Add skill'}
        confirmLabel={editingExisting ? 'Update skill' : 'Add to draft'}
        cancelLabel="Cancel"
        busy={false}
        onCancel={() => setEditorIndex(null)}
        onConfirm={applyEditor}
      >
        <div className="space-y-4">
          {editorError ? <Notice tone="error">{editorError}</Notice> : null}
          <TextField
            label="Name"
            value={editorValue.name}
            onChange={(name) => setEditorValue((current) => ({ ...current, name }))}
            maxLength={NAME_MAX_LENGTH}
            required
          />
          <TextArea
            label="Description"
            hint="When the agent should use this skill."
            rows={2}
            maxLength={DESCRIPTION_MAX_LENGTH}
            value={editorValue.description}
            onChange={(description) => setEditorValue((current) => ({ ...current, description }))}
          />
          <TextArea
            label="Instructions"
            markdown
            mono
            rows={6}
            maxHeight="min(24rem, 55svh)"
            maxLength={INSTRUCTIONS_MAX_LENGTH}
            value={editorValue.instructions}
            onChange={(instructions) => setEditorValue((current) => ({ ...current, instructions }))}
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Remove skill?"
        confirmLabel="Remove"
        tone="danger"
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      >
        This skill stays removed from the draft until you publish.
      </ConfirmDialog>

      <ConfirmDialog
        open={discardOpen}
        title="Discard Instruction Skills draft?"
        confirmLabel="Discard"
        tone="danger"
        onCancel={() => setDiscardOpen(false)}
        onConfirm={discard}
      >
        Unsaved Instruction Skills changes will be lost. The last published collection stays on the server.
      </ConfirmDialog>
    </div>
  )
}
