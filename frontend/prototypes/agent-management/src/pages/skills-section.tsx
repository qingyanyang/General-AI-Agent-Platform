/** PROTOTYPE Instruction Skills for one predefined agent. */
import { Trash2 } from 'lucide-react'
import { useState } from 'react'

import {
  draftSkills,
  INSTRUCTION_CHARACTER_LIMIT,
  normalizedSkillName,
  type DraftChange,
  type SkillDraft,
} from '../mock/configuration-draft'
import { listInstructionSkills, type InstructionSkill } from '../mock/product-state'
import {
  AddButton,
  ConfirmDialog,
  FormDialog,
  IconButton,
  SectionCard,
  TextArea,
  TextField,
} from '../ui'

const EMPTY: SkillDraft = { name: '', description: '', instructions: '' }

type Editor = { id: string | null; initial: SkillDraft; value: SkillDraft }

function sameFields(a: SkillDraft, b: SkillDraft) {
  return a.name === b.name && a.description === b.description && a.instructions === b.instructions
}

export function SkillsSection({
  agentId,
  drafts,
  onDraftChange,
  saving,
}: {
  agentId: string
  drafts: Record<string, DraftChange<SkillDraft>>
  onDraftChange: (id: string, change: DraftChange<SkillDraft> | null) => void
  saving: boolean
}) {
  const skills = draftSkills(agentId, drafts)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<InstructionSkill | null>(null)
  const value = editor?.value ?? EMPTY
  const editing = editor?.id != null
  const dirty = editor !== null && !sameFields(value, editor.initial)
  const removingAddition = pendingDelete !== null && drafts[pendingDelete.id]?.kind === 'added'

  const openEditor = (skill?: InstructionSkill) => {
    const initial = skill ?? EMPTY
    setEditor({ id: skill?.id ?? null, initial, value: initial })
    setError(null)
  }

  const changeFields = (patch: Partial<SkillDraft>) => {
    setEditor((current) => current && { ...current, value: { ...current.value, ...patch } })
    setError(null)
  }

  const applyDraft = () => {
    if (!editor) {
      return
    }
    const name = normalizedSkillName(value.name)
    if (skills.some((skill) => skill.id !== editor.id && normalizedSkillName(skill.name) === name)) {
      setError('This agent already has a skill with that name.')
      return
    }
    if (value.instructions.length > INSTRUCTION_CHARACTER_LIMIT) {
      setError(`Skill instructions must be at most ${INSTRUCTION_CHARACTER_LIMIT.toLocaleString()} characters.`)
      return
    }

    const next = { name: value.name.trim(), description: value.description.trim(), instructions: value.instructions }
    const id = editor.id ?? `draft-skill-${crypto.randomUUID()}`
    const published = listInstructionSkills(agentId).find((skill) => skill.id === id)
    if (published && sameFields(published, next)) {
      onDraftChange(id, null)
    } else {
      onDraftChange(id, { kind: published ? 'edited' : 'added', value: next })
    }
    setEditor(null)
  }

  return (
    <SectionCard
      title="Instruction Skills"
      description="Business rules the agent can use for specific tasks."
      aside={<AddButton size="sm" disabled={saving} onClick={() => openEditor()}>Add skill</AddButton>}
    >
      {skills.length === 0 ? (
        <p className="text-sm text-muted-foreground">No skills added yet.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {skills.map((skill) => (
            <li key={skill.id} className="flex items-start gap-2 px-3 py-2.5">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-start rounded-lg px-1 py-1 text-left hover:bg-muted disabled:opacity-60"
                aria-haspopup="dialog"
                aria-label={`Edit ${skill.name}`}
                disabled={saving}
                onClick={() => openEditor(skill)}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium break-words">{skill.name}</span>
                  {skill.description ? (
                    <span className="mt-0.5 line-clamp-2 text-sm break-words text-muted-foreground">{skill.description}</span>
                  ) : null}
                </span>
              </button>
              <IconButton
                label={`Remove ${skill.name}`}
                className="size-8 text-danger hover:bg-danger-soft"
                disabled={saving}
                onClick={() => setPendingDelete(skill)}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <FormDialog
        open={editor !== null}
        variant="wide"
        title={editing ? 'Edit skill' : 'Add skill'}
        description="Describe when the agent should use this skill and what it should do."
        submitLabel={editing ? 'Update skill' : 'Add to draft'}
        dirty={dirty}
        busy={saving}
        disabled={!dirty || !value.name.trim()}
        error={error}
        onClose={() => setEditor(null)}
        onSubmit={applyDraft}
      >
        <TextField label="Name" value={value.name} onChange={(name) => changeFields({ name })} required />
        <TextArea
          label="Description"
          hint="When the agent should use this skill."
          rows={2}
          value={value.description}
          onChange={(description) => changeFields({ description })}
        />
        <TextArea
          label="Instructions"
          markdown
          mono
          rows={5}
          maxLength={INSTRUCTION_CHARACTER_LIMIT}
          value={value.instructions}
          onChange={(instructions) => changeFields({ instructions })}
        />
      </FormDialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Remove skill?"
        confirmLabel="Remove"
        tone="danger"
        busy={saving}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            onDraftChange(pendingDelete.id, removingAddition ? null : { kind: 'removed' })
          }
          setPendingDelete(null)
        }}
      >
        {removingAddition
          ? `Remove “${pendingDelete?.name}” from this draft?`
          : `“${pendingDelete?.name}” will be removed from this agent when you publish.`}
      </ConfirmDialog>
    </SectionCard>
  )
}
