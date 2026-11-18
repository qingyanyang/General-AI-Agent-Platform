/** PROTOTYPE Configure tab with a single Publish action. */
import { Loader2 } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

import { isApiError } from '@/lib/errors'
import type { AgentConfiguration, LlmModel } from '@/lib/management'

import { usePermissions } from '../hooks'
import { mockClient } from '../mock/client'
import {
  EMPTY_CONFIGURATION_DRAFT,
  hasDraftChanges,
  INSTRUCTION_CHARACTER_LIMIT,
  readConfigurationDraft,
  storeConfigurationDraft,
  validateDraftItems,
  type ConfigurationFields,
} from '../mock/configuration-draft'
import { applyFields, modelKey, supportsTemperature, toFields } from '../publish-agent-draft'
import { Badge, Button, ConfirmDialog, LoadingRows, Notice, SectionCard, SelectField, TextArea } from '../ui'
import { SkillsSection } from './skills-section'
import { KnowledgeSection, McpSection, ToolsSection } from './technical-extras'

function updateDraft<T>(drafts: Record<string, T>, id: string, value: T | null): Record<string, T> {
  if (value !== null) {
    return { ...drafts, [id]: value }
  }
  if (!Object.hasOwn(drafts, id)) {
    return drafts
  }
  const next = { ...drafts }
  delete next[id]
  return next
}

function changedFields(fields: Partial<ConfigurationFields>, saved: ConfigurationFields): Partial<ConfigurationFields> {
  const next = { ...fields }
  if (next.model === saved.model) delete next.model
  if (next.temperature === saved.temperature) delete next.temperature
  if (next.instructions === saved.instructions) delete next.instructions
  if (next.tools && next.tools.length === saved.tools.length && next.tools.every((name) => saved.tools.includes(name))) {
    delete next.tools
  }
  return next
}

export function ConfigurePage({
  agentId,
  technical,
  knowledge,
}: {
  agentId: string
  technical: boolean
  knowledge: boolean
}) {
  const { persona } = usePermissions()
  const editorId = persona.userId
  const [config, setConfig] = useState<AgentConfiguration | null>(null)
  const [models, setModels] = useState<LlmModel[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [modelError, setModelError] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState(() => readConfigurationDraft(editorId, agentId))
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const inFlight = useRef<AbortController | null>(null)

  const saved = config && toFields(config)
  const fields = saved && { ...saved, ...workspace.fields }
  const dirty = hasDraftChanges(workspace)
  const hasTechnicalFields = Object.keys(workspace.fields).length > 0

  useEffect(() => {
    if (!technical) {
      return
    }
    let active = true
    mockClient.getConfiguration(agentId).then((next) => {
      if (active) setConfig(next)
    }).catch((caught: unknown) => {
      if (active) setLoadError(isApiError(caught) ? caught.message : 'Could not load the configuration.')
    })
    mockClient.listModels().then((next) => {
      if (active) setModels(next)
    }).catch((caught: unknown) => {
      if (active) setModelError(isApiError(caught) ? caught.message : 'Could not load models.')
    })
    return () => { active = false }
  }, [agentId, technical])

  useEffect(() => () => inFlight.current?.abort(), [])

  useEffect(() => {
    storeConfigurationDraft(editorId, agentId, workspace)
  }, [agentId, editorId, workspace])

  const editConfig = (patch: Partial<ConfigurationFields>) => {
    if (saved) {
      setWorkspace((current) => ({ ...current, fields: changedFields({ ...current.fields, ...patch }, saved) }))
      setError(null)
    }
  }

  const prepareDraft = () => {
    const invalid = validateDraftItems(agentId, workspace)
    if (invalid) {
      throw new Error(invalid)
    }
    if (hasTechnicalFields && !config) {
      throw new Error(loadError ?? 'Wait for the configuration to load.')
    }
    return config ? applyFields(config, workspace.fields, models) : undefined
  }

  const publish = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!dirty || inFlight.current) {
      return
    }
    const controller = new AbortController()
    inFlight.current = controller
    setPublishing(true)
    setError(null)
    try {
      const configuration = prepareDraft()
      const next = await mockClient.publishConfiguration(agentId, {
        configuration: hasTechnicalFields ? configuration ?? null : null,
        skills: workspace.skills,
        connections: workspace.connections,
        mcpTools: workspace.mcpTools,
        knowledge: workspace.knowledge,
      }, controller.signal)
      if (controller.signal.aborted) {
        return
      }
      if (next) {
        setConfig(next)
      }
      setWorkspace(EMPTY_CONFIGURATION_DRAFT)
      setPublished(true)
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : 'Could not publish the draft.')
      }
    } finally {
      inFlight.current = null
      if (!controller.signal.aborted) {
        setPublishing(false)
      }
    }
  }

  return (
    <div className="space-y-4" aria-busy={publishing}>
      {dirty ? (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground">
          <Badge tone="warning">Draft</Badge>
          Changes take effect when you publish.
        </div>
      ) : null}
      {technical ? (
        <>
          <SectionCard title="Model and parameters">
            {loadError || modelError ? <Notice tone="error">{loadError ?? modelError}</Notice> : fields && saved && models ? (
              <ModelFields
                draft={fields}
                saved={saved}
                models={models}
                saving={publishing}
                onChange={editConfig}
                defaultTemperature={config?.temperature ?? 0.7}
              />
            ) : <LoadingRows label="Loading model" rows={1} />}
          </SectionCard>
          <SectionCard title="System instructions" description="Standing rules included with every call.">
            {fields ? (
              <TextArea
                label="Instructions"
                markdown
                mono
                value={fields.instructions}
                onChange={(instructions) => editConfig({ instructions })}
                disabled={publishing}
                rows={6}
                maxHeight="min(24rem, 55svh)"
                maxLength={INSTRUCTION_CHARACTER_LIMIT}
              />
            ) : loadError ? <Notice tone="error">{loadError}</Notice> : <LoadingRows label="Loading system instructions" rows={2} />}
          </SectionCard>
          <ToolsSection
            assigned={fields?.tools ?? null}
            loading={fields === null && loadError === null}
            error={loadError}
            saving={publishing}
            onToggle={(name, enabled) => {
              if (fields) editConfig({ tools: enabled ? [...fields.tools, name] : fields.tools.filter((tool) => tool !== name) })
            }}
          />
          <McpSection
            agentId={agentId}
            drafts={workspace.connections}
            toolChanges={workspace.mcpTools}
            saving={publishing}
            onDraftChange={(id, value) => {
              setWorkspace((current) => ({ ...current, connections: updateDraft(current.connections, id, value) }))
              setError(null)
            }}
            onToolChange={(id, value) => {
              setWorkspace((current) => ({ ...current, mcpTools: updateDraft(current.mcpTools, id, value) }))
              setError(null)
            }}
          />
        </>
      ) : null}
      <SkillsSection
        agentId={agentId}
        drafts={workspace.skills}
        saving={publishing}
        onDraftChange={(id, value) => {
          setWorkspace((current) => ({ ...current, skills: updateDraft(current.skills, id, value) }))
          setError(null)
        }}
      />
      {knowledge ? (
        <KnowledgeSection
          agentId={agentId}
          saving={publishing}
          drafts={workspace.knowledge}
          onDraftChange={(id, value) => {
            setWorkspace((current) => ({ ...current, knowledge: updateDraft(current.knowledge, id, value) }))
            setError(null)
          }}
        />
      ) : null}
      <form
        aria-label="Publish agent configuration"
        className="sticky bottom-0 z-10 ml-[calc(50%-50cqw)] w-[100cqw] max-w-none border-t border-border bg-card/95 backdrop-blur"
        onSubmit={(event) => void publish(event)}
      >
        <div className="mx-auto max-w-5xl space-y-3 px-4 py-3 sm:px-8">
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div role="status" className="mr-auto">
              {published && !dirty ? <Badge tone="success">Published</Badge> : null}
            </div>
            {dirty ? <Button variant="ghost" disabled={publishing} onClick={() => setDiscarding(true)}>Discard draft</Button> : null}
            <Button type="submit" disabled={publishing || !dirty}>
              {publishing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {publishing ? 'Publishing…' : 'Publish'}
            </Button>
          </div>
        </div>
      </form>
      <ConfirmDialog
        open={discarding}
        title="Discard draft?"
        confirmLabel="Discard draft"
        tone="danger"
        onCancel={() => setDiscarding(false)}
        onConfirm={() => {
          setWorkspace(EMPTY_CONFIGURATION_DRAFT)
          setError(null)
          setDiscarding(false)
        }}
      >
        This restores the last published configuration for this agent.
      </ConfirmDialog>
    </div>
  )
}

function ModelFields({
  draft,
  saved,
  models,
  saving,
  onChange,
  defaultTemperature,
}: {
  draft: ConfigurationFields
  saved: ConfigurationFields
  models: LlmModel[]
  saving: boolean
  onChange: (patch: Partial<ConfigurationFields>) => void
  defaultTemperature: number
}) {
  const temperatureId = useId()
  const selected = models.find((item) => modelKey(item) === draft.model)
  const temperatureModel = supportsTemperature(selected) ? selected : undefined

  const changeModel = (model: string) => {
    const chosen = models.find((item) => modelKey(item) === model)
    let temperature = ''
    if (supportsTemperature(chosen)) {
      temperature = model === saved.model
        ? saved.temperature
        : String(Math.max(chosen.temperature_min, Math.min(chosen.temperature_max, defaultTemperature)))
    }
    onChange({ model, temperature })
  }

  return (
    <fieldset className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" disabled={saving}>
      <SelectField label="Model" value={draft.model} onChange={changeModel}>
        {selected === undefined ? <option value={draft.model}>{draft.model}</option> : null}
        {models.map((item) => (
          <option key={modelKey(item)} value={modelKey(item)}>{modelKey(item)}</option>
        ))}
      </SelectField>
      <div className="space-y-1.5">
        <label htmlFor={temperatureId} className="block text-sm font-medium">Temperature</label>
        <input
          id={temperatureId}
          type="number"
          inputMode="decimal"
          step="any"
          min={temperatureModel?.temperature_min}
          max={temperatureModel?.temperature_max}
          required={temperatureModel !== undefined}
          disabled={temperatureModel === undefined}
          value={draft.temperature}
          onChange={(event) => onChange({ temperature: event.target.value })}
          aria-describedby={`${temperatureId}-hint`}
          className="h-10 w-full rounded-xl border border-border-strong bg-card px-3 text-sm disabled:bg-muted"
        />
        <p id={`${temperatureId}-hint`} className="text-xs text-muted-foreground">
          {temperatureModel
            ? `Range ${temperatureModel.temperature_min}–${temperatureModel.temperature_max}`
            : 'This model uses a fixed temperature.'}
        </p>
      </div>
    </fieldset>
  )
}
