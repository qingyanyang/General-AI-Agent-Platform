/** PROTOTYPE dialogs (#52, #53): create agent, add/edit grant. */
import { Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { isApiError } from '@/lib/errors'
import type { AccessGrant, AgentRecord } from '@/lib/management'

import { useGuardedClose, useUnsaved } from './hooks'
import { mockClient } from './mock/client'
import { Button, CheckRow, ConfirmDialog, Dialog, Notice, TextArea, TextField } from './ui'

const AGENT_ID_MAX = 64

function DiscardDialog({ open, onConfirm, onCancel }: { open: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <ConfirmDialog
      open={open}
      title="Discard unsaved changes?"
      confirmLabel="Discard"
      cancelLabel="Keep editing"
      tone="danger"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      What you typed in this dialog will be lost.
    </ConfirmDialog>
  )
}

export function CreateAgentDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (agent: AgentRecord) => void
}) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = open && (id !== '' || name !== '' || description !== '')
  useUnsaved('New agent', dirty)

  const reset = () => {
    setId('')
    setName('')
    setDescription('')
    setError(null)
  }
  const guard = useGuardedClose(dirty, () => {
    reset()
    onClose()
  })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (creating) {
      return
    }
    const trimmedId = id.trim()
    if (!trimmedId || !name.trim()) {
      setError('Agent ID and name are required.')
      return
    }
    if (trimmedId.length > AGENT_ID_MAX) {
      setError(`Agent ID must be at most ${AGENT_ID_MAX} characters.`)
      return
    }
    setCreating(true)
    setError(null)
    try {
      const created = await mockClient.createAgent({
        id: trimmedId,
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
      })
      reset()
      onCreated(created)
    } catch (caught) {
      if (isApiError(caught) && caught.status === 409) {
        setError(`An agent with ID “${trimmedId}” already exists. Choose another ID.`)
      } else {
        setError(isApiError(caught) ? caught.message : 'Could not create the agent.')
      }
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onRequestClose={() => (creating ? undefined : guard.request())}
        title="Create agent"
        description="You'll get view, configure, and execute access to the new agent."
        footer={
          <>
            <Button variant="outline" onClick={guard.request} disabled={creating}>
              Cancel
            </Button>
            <Button type="submit" form="create-agent-form" disabled={creating}>
              {creating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {creating ? 'Creating…' : 'Create agent'}
            </Button>
          </>
        }
      >
        <form id="create-agent-form" className="space-y-4" onSubmit={(event) => void submit(event)}>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <TextField
            label="Agent ID"
            value={id}
            onChange={setId}
            mono
            required
            autoFocus
            maxLength={AGENT_ID_MAX + 8}
            placeholder="e.g. site-diary"
            hint={`1–${AGENT_ID_MAX} characters. The ID can't be changed after creation.`}
          />
          <TextField label="Name" value={name} onChange={setName} required placeholder="e.g. Site Diary" />
          <TextArea
            label="Description (optional)"
            value={description}
            onChange={setDescription}
            rows={3}
          />
        </form>
      </Dialog>
      <DiscardDialog open={guard.confirming} onConfirm={guard.confirm} onCancel={guard.cancel} />
    </>
  )
}

export type GrantSaveResult = { kind: 'saved'; grant: AccessGrant } | { kind: 'removed'; userId: string }

export function GrantDialog({
  open,
  agentId,
  existing,
  onClose,
  onSaved,
}: {
  open: boolean
  agentId: string
  existing: AccessGrant | null
  onClose: () => void
  onSaved: (result: GrantSaveResult) => void
}) {
  const [userId, setUserId] = useState(existing?.user_id ?? '')
  const [view, setView] = useState(existing?.can_view ?? true)
  const [configure, setConfigure] = useState(existing?.can_configure ?? false)
  const [execute, setExecute] = useState(existing?.can_execute ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty =
    open &&
    (existing
      ? view !== existing.can_view || configure !== existing.can_configure || execute !== existing.can_execute
      : userId !== '' || !view || configure || execute)
  useUnsaved('Access grant', dirty)
  const guard = useGuardedClose(dirty, onClose)
  const noneSelected = !view && !configure && !execute

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) {
      return
    }
    const trimmed = userId.trim()
    if (!trimmed) {
      setError('User ID is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = await mockClient.upsertGrant({
        user_id: trimmed,
        agent_id: agentId,
        can_view: view,
        can_configure: configure,
        can_execute: execute,
      })
      onSaved(saved ? { kind: 'saved', grant: saved } : { kind: 'removed', userId: trimmed })
    } catch (caught) {
      setError(isApiError(caught) ? caught.message : 'Could not save the grant.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onRequestClose={() => (saving ? undefined : guard.request())}
        title={existing ? 'Edit grant' : 'Add grant'}
        description={
          <>
            Agent ID <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{agentId}</code>
          </>
        }
        footer={
          <>
            <Button variant="outline" onClick={guard.request} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="grant-form"
              variant={noneSelected && existing ? 'danger' : 'primary'}
              disabled={saving || (existing !== null && !dirty)}
            >
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {saving ? 'Saving…' : noneSelected && existing ? 'Remove grant' : 'Save grant'}
            </Button>
          </>
        }
      >
        <form id="grant-form" className="space-y-4" onSubmit={(event) => void submit(event)}>
          {error ? <Notice tone="error" title="Not saved">{error}</Notice> : null}
          <TextField
            label="User ID"
            value={userId}
            onChange={setUserId}
            mono
            disabled={existing !== null}
            autoFocus={existing === null}
            placeholder="auth0|…"
            hint="The Auth0 user ID (sub). Saving replaces this user's capabilities for this agent."
          />
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Capabilities</legend>
            <CheckRow
              label="View"
              description="See the agent, its sessions, and message history."
              checked={view}
              onChange={setView}
            />
            <CheckRow
              label="Configure"
              description="Edit details and configuration, and deactivate the agent."
              checked={configure}
              onChange={setConfigure}
            />
            <CheckRow
              label="Execute"
              description="Start sessions and send messages while the agent is active."
              checked={execute}
              onChange={setExecute}
            />
          </fieldset>
          {noneSelected ? (
            <Notice tone="info">
              With no capabilities selected, saving removes this user's grant. The API answers with 204.
            </Notice>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Users also need the matching platform permission (for example <code>agents:execute</code>). Grants
            never replace it.
          </p>
        </form>
      </Dialog>
      <DiscardDialog open={guard.confirming} onConfirm={guard.confirm} onCancel={guard.cancel} />
    </>
  )
}
