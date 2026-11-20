import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { isApiError } from '@/lib/errors'
import type {
  AccessAudienceMode,
  AgentAccessConfig,
  GroupRecord,
  ManagementClient,
} from '@/lib/management'

type AccessPanelProps = {
  agentId: string
  client: ManagementClient
  onUnauthorized: () => void
  onAudienceEffectiveChange?: (agentId: string, effective: boolean) => void
}

type Draft = {
  audienceMode: AccessAudienceMode
  owningGroupId: string | null
  groupIds: string[]
}

function draftFromConfig(config: AgentAccessConfig): Draft {
  return {
    audienceMode: config.audience_mode ?? 'groups',
    owningGroupId: config.owning_group_id,
    groupIds: [...config.group_ids],
  }
}

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  const rightSet = new Set(right)
  return left.every((id) => rightSet.has(id))
}

function draftsEqual(left: Draft, right: Draft): boolean {
  return (
    left.audienceMode === right.audienceMode &&
    left.owningGroupId === right.owningGroupId &&
    sameIds(left.groupIds, right.groupIds)
  )
}

function errorMessage(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback
}

export function AccessPanel({
  agentId,
  client,
  onUnauthorized,
  onAudienceEffectiveChange,
}: AccessPanelProps) {
  const audienceName = useId()
  const ticket = useRef(0)
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState<GroupRecord[]>([])
  const [saved, setSaved] = useState<AgentAccessConfig | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [activating, setActivating] = useState(false)
  const [confirmActivate, setConfirmActivate] = useState(false)

  const dirty = useMemo(() => {
    if (!saved || !draft) {
      return false
    }
    return !draftsEqual(draft, draftFromConfig(saved))
  }, [draft, saved])

  useEffect(() => {
    if (dirty) {
      setConfirmActivate(false)
    }
  }, [dirty])

  const load = async () => {
    const current = ++ticket.current
    setLoading(true)
    setError(null)
    try {
      const [config, allGroups] = await Promise.all([
        client.getAccessConfig(agentId),
        client.listAllGroups(),
      ])
      if (ticket.current !== current) {
        return
      }
      setSaved(config)
      setDraft(draftFromConfig(config))
      setGroups(allGroups)
      onAudienceEffectiveChange?.(agentId, config.audience_effective)
    } catch (caught) {
      if (ticket.current !== current) {
        return
      }
      onAudienceEffectiveChange?.(agentId, false)
      if (isApiError(caught) && caught.status === 401) {
        onUnauthorized()
        return
      }
      setError(errorMessage(caught, 'Could not load access settings.'))
    } finally {
      if (ticket.current === current) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    void load()
    return () => {
      ticket.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when agent changes
  }, [agentId])

  const save = async () => {
    if (!draft || saving || activating) {
      return
    }
    setSaving(true)
    setError(null)
    setStatus(null)
    const snapshot = draft
    try {
      const updated = await client.putAccessConfig(agentId, {
        audience_mode: snapshot.audienceMode,
        owning_group_id: snapshot.owningGroupId,
        group_ids: snapshot.groupIds,
      })
      setSaved(updated)
      setDraft(draftFromConfig(updated))
      onAudienceEffectiveChange?.(agentId, updated.audience_effective)
      setStatus(
        updated.audience_effective
          ? 'Access changes saved. They take effect on subsequent requests.'
          : 'Access settings saved. Activate group-based access when ready.',
      )
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        onUnauthorized()
        return
      }
      // Preserve draft; do not claim success or activate.
      setError(errorMessage(caught, 'Could not save access settings.'))
    } finally {
      setSaving(false)
    }
  }

  const activate = async () => {
    if (!saved || saving || activating) {
      return
    }
    if (dirty) {
      setConfirmActivate(false)
      setError('Save access settings before activating.')
      return
    }
    setActivating(true)
    setError(null)
    setStatus(null)
    setConfirmActivate(false)
    try {
      const updated = await client.activateAccessConfig(agentId)
      setSaved(updated)
      setDraft(draftFromConfig(updated))
      onAudienceEffectiveChange?.(agentId, updated.audience_effective)
      setStatus(
        'Group-based access is active. Existing personal grants no longer authorize this agent.',
      )
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        onUnauthorized()
        return
      }
      setError(errorMessage(caught, 'Could not activate group-based access.'))
    } finally {
      setActivating(false)
    }
  }

  const toggleGroup = (groupId: string, enabled: boolean) => {
    setDraft((current) => {
      if (!current) {
        return current
      }
      if (enabled) {
        return {
          ...current,
          groupIds: current.groupIds.includes(groupId)
            ? current.groupIds
            : [...current.groupIds, groupId],
        }
      }
      if (current.owningGroupId === groupId) {
        return current
      }
      return {
        ...current,
        groupIds: current.groupIds.filter((id) => id !== groupId),
      }
    })
  }

  if (loading && !saved) {
    return <p className="text-sm text-muted-foreground">Loading access settings…</p>
  }

  if (!draft || !saved) {
    return error ? <p className="text-sm text-destructive">{error}</p> : null
  }

  const audienceEffective = saved.audience_effective
  const activateDisabled = dirty || saving || activating || !saved.audience_mode

  return (
    <section className="space-y-4 rounded-md border border-border p-4">
      <div>
        <h3 className="text-base font-semibold">Who can use this agent?</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {audienceEffective
            ? 'Changes take effect on subsequent requests after you save.'
            : 'Personal grants still authorize access until you activate group-based access.'}
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}

      <fieldset className="grid gap-2 sm:grid-cols-2" disabled={saving || activating}>
        <legend className="sr-only">Access audience</legend>
        {(
          [
            ['company', 'Everyone in the company'],
            ['groups', 'Selected groups'],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2 text-sm"
          >
            <input
              type="radio"
              className="mt-1"
              name={audienceName}
              checked={draft.audienceMode === value}
              onChange={() => setDraft((current) => (current ? { ...current, audienceMode: value } : current))}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">Owning group (optional)</span>
        <select
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          value={draft.owningGroupId ?? ''}
          disabled={saving || activating}
          aria-label="Owning group"
          onChange={(event) => {
            const next = event.target.value || null
            setDraft((current) => {
              if (!current) {
                return current
              }
              const groupIds =
                next && !current.groupIds.includes(next)
                  ? [...current.groupIds, next]
                  : current.groupIds
              return { ...current, owningGroupId: next, groupIds }
            })
          }}
        >
          <option value="">None</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      </label>

      {draft.audienceMode === 'groups' ? (
        <fieldset className="space-y-2" disabled={saving || activating}>
          <legend className="text-sm font-medium">Assigned groups</legend>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No groups available.</p>
          ) : (
            groups.map((group) => (
              <label key={group.id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={draft.groupIds.includes(group.id)}
                  disabled={draft.owningGroupId === group.id}
                  aria-label={`Assign ${group.name}`}
                  onChange={(event) => toggleGroup(group.id, event.target.checked)}
                />
                <span>
                  <span className="font-medium">{group.name}</span>
                  {draft.owningGroupId === group.id ? (
                    <span className="mt-0.5 block text-muted-foreground">Owning group</span>
                  ) : null}
                </span>
              </label>
            ))
          )}
        </fieldset>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={saving || activating || !dirty} onClick={() => void save()}>
          {audienceEffective ? 'Save access changes' : 'Save access settings'}
        </Button>
        {!audienceEffective ? (
          <Button
            type="button"
            variant="outline"
            disabled={activateDisabled}
            onClick={() => setConfirmActivate(true)}
          >
            Activate group-based access
          </Button>
        ) : null}
      </div>

      {confirmActivate ? (
        <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
          <p>
            Activate the <strong>saved</strong> access configuration? Existing personal grants will
            no longer authorize access to this agent.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={dirty || saving || activating}
              onClick={() => void activate()}
            >
              Confirm activation
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={activating}
              onClick={() => setConfirmActivate(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
