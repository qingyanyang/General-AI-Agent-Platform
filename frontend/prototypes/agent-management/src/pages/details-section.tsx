/** PROTOTYPE Details section (#53): inline name/description save and a separate danger zone. */
import { useState, type FormEvent } from 'react'

import { isApiError } from '@/lib/errors'
import type { AgentRecord } from '@/lib/management'

import { usePermissions, useUnsaved } from '../hooks'
import { mockClient } from '../mock/client'
import {
  Button,
  ConfirmDialog,
  DangerZone,
  InlineFormActions,
  LoadingRows,
  Notice,
  SectionCard,
  TextArea,
  TextField,
  type SaveState,
} from '../ui'
import type { MetadataState } from './settings'

export function DetailsSection({
  agentId,
  meta,
  onUpdated,
}: {
  agentId: string
  meta: MetadataState
  onUpdated: (agent: AgentRecord) => void
}) {
  switch (meta.kind) {
    case 'loading':
      return <LoadingRows label="Loading agent details" rows={3} />
    case 'skipped':
      return (
        <Notice tone="info" title="Details aren't available for your role">
          Viewing agent details isn’t available for this role.
        </Notice>
      )
    case 'missing':
      return (
        <Notice tone="warning" title="Details unavailable">
          {meta.message}. You may not have access to <code>{agentId}</code>. Other sections may still work.
        </Notice>
      )
    case 'error':
      return (
        <Notice tone="error" title="Details didn't load">
          {meta.message}
        </Notice>
      )
    case 'ready':
      return (
        <div className="space-y-4">
          <DetailsForm key={meta.agent.id} agent={meta.agent} onUpdated={onUpdated} />
          <AgentDangerZone agent={meta.agent} onUpdated={onUpdated} />
        </div>
      )
    default: {
      const unreachable: never = meta
      return unreachable
    }
  }
}

function DetailsForm({ agent, onUpdated }: { agent: AgentRecord; onUpdated: (agent: AgentRecord) => void }) {
  const [saved, setSaved] = useState({ name: agent.name, description: agent.description ?? '' })
  const [name, setName] = useState(saved.name)
  const [description, setDescription] = useState(saved.description)
  const [state, setState] = useState<SaveState>({ kind: 'idle' })
  const dirty = name !== saved.name || description !== saved.description
  useUnsaved('Details', dirty)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (state.kind === 'saving' || !dirty) {
      return
    }
    if (!name.trim()) {
      setState({ kind: 'error', message: 'Name is required.' })
      return
    }
    const patch: { name?: string; description?: string | null } = {}
    if (name !== saved.name) {
      patch.name = name
    }
    if (description !== saved.description) {
      patch.description = description === '' ? null : description
    }
    setState({ kind: 'saving' })
    try {
      const updated = await mockClient.updateAgent(agent.id, patch)
      const next = { name: updated.name, description: updated.description ?? '' }
      setSaved(next)
      setName(next.name)
      setDescription(next.description)
      setState({ kind: 'saved' })
      onUpdated(updated)
    } catch (caught) {
      setState({ kind: 'error', message: isApiError(caught) ? caught.message : 'Could not save agent details.' })
    }
  }

  const saving = state.kind === 'saving'
  return (
    <SectionCard title="Details">
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <fieldset className="space-y-4" disabled={saving}>
          <TextField label="Name" value={name} required onChange={(next) => {
            setName(next)
            setState({ kind: 'idle' })
          }} />
          <TextArea label="Description" value={description} rows={3} onChange={(next) => {
            setDescription(next)
            setState({ kind: 'idle' })
          }} />
        </fieldset>
        <InlineFormActions
          dirty={dirty}
          state={state}
          onCancel={() => {
            setName(saved.name)
            setDescription(saved.description)
            setState({ kind: 'idle' })
          }}
        />
      </form>
    </SectionCard>
  )
}

function AgentDangerZone({ agent, onUpdated }: { agent: AgentRecord; onUpdated: (agent: AgentRecord) => void }) {
  const { canDeactivateAgent } = usePermissions()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!canDeactivateAgent) {
    return null
  }

  const deactivate = async () => {
    if (busy) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const updated = await mockClient.deactivateAgent(agent.id)
      setConfirming(false)
      onUpdated(updated)
    } catch (caught) {
      setConfirming(false)
      setError(isApiError(caught) ? caught.message : 'Could not deactivate this agent.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DangerZone
      title={agent.status === 'active' ? 'Deactivate this agent' : 'This agent is inactive'}
      description={
        agent.status === 'active'
          ? 'Blocks every new chat, message, and run. Existing conversations stay readable. Reactivation isn’t available.'
          : 'New runs are blocked. Reactivation isn’t available.'
      }
      action={
        agent.status === 'active' ? (
          <Button variant="danger-outline" onClick={() => setConfirming(true)}>
            Deactivate…
          </Button>
        ) : null
      }
    >
      {error ? (
        <Notice tone="error" className="mt-4" title="Not deactivated">
          {error}
        </Notice>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title={`Deactivate ${agent.name}?`}
        confirmLabel={busy ? 'Deactivating…' : 'Deactivate agent'}
        tone="danger"
        busy={busy}
        onConfirm={() => void deactivate()}
        onCancel={() => setConfirming(false)}
      >
        New runs of <code className="font-mono">{agent.id}</code> will fail with 409 “Agent is inactive”. Existing
        conversations stay readable. You can’t undo this from the app.
      </ConfirmDialog>
    </DangerZone>
  )
}
