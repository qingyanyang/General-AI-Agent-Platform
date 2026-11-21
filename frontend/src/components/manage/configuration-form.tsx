import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import type { ConfigForm } from '@/components/manage/use-management'
import { Badge, ConfirmDialog, IconButton, Notice, SectionCard, TextArea, TextField } from '@/components/ui/primitives'
import type { LlmModel, SkillSummary, ToolCatalogItem } from '@/lib/management'
import { cn } from '@/lib/utils'

const fieldClass =
  'w-full rounded-xl border border-border-strong bg-card px-3 py-2 text-sm disabled:bg-muted'

function namedOptions(
  catalog: { name: string }[],
  selected: string[],
): { name: string; description: string }[] {
  const options = catalog.map((item) => ({
    name: item.name,
    description: 'description' in item && typeof item.description === 'string' ? item.description : '',
  }))
  for (const name of selected) {
    if (!options.some((item) => item.name === name)) {
      options.push({ name, description: '' })
    }
  }
  return options
}

export type DraftConnection = { id: string; name: string; endpoint: string }

export function ConfigureExtras({
  saving,
  between,
  showConnections = false,
  onDirtyChange,
  initialConnections = [],
  onSnapshot,
}: {
  saving: boolean
  between?: ReactNode
  /** MCP connections are a Super Admin technical setting. */
  showConnections?: boolean
  onDirtyChange?: (dirty: boolean) => void
  initialConnections?: DraftConnection[]
  onSnapshot?: (snapshot: { connections: DraftConnection[] }) => void
}) {
  const [connections, setConnections] = useState<DraftConnection[]>(initialConnections)
  const [addingConnection, setAddingConnection] = useState(false)
  const [connectionName, setConnectionName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const dirty = showConnections && connections.length > 0

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    onSnapshot?.({ connections })
  }, [connections, onSnapshot])

  return (
    <>
      {showConnections ? (
        <SectionCard
          title="MCP Connections"
          description="Each connection supplies tools you can enable for this agent."
          aside={
            <Button type="button" size="sm" disabled={saving} onClick={() => setAddingConnection(true)}>
              <Plus className="size-4" aria-hidden />
              Add connection
            </Button>
          }
        >
          {connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No MCP connections yet.</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {connections.map((connection) => (
                <li key={connection.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{connection.name}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{connection.endpoint}</p>
                  </div>
                  <Badge tone="success">Connected</Badge>
                  <IconButton
                    label={`Remove ${connection.name}`}
                    className="size-8 text-danger hover:bg-danger-soft"
                    onClick={() =>
                      setConnections((current) => current.filter((item) => item.id !== connection.id))
                    }
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      ) : null}
      {between}
      {showConnections ? (
        <ConfirmDialog
          open={addingConnection}
          title="Add MCP connection"
          confirmLabel="Add to draft"
          onCancel={() => {
            setAddingConnection(false)
            setConnectionName('')
            setEndpoint('')
          }}
          onConfirm={() => {
            if (!connectionName.trim() || !endpoint.trim()) {
              return
            }
            setConnections((current) => [
              ...current,
              { id: crypto.randomUUID(), name: connectionName.trim(), endpoint: endpoint.trim() },
            ])
            setAddingConnection(false)
            setConnectionName('')
            setEndpoint('')
          }}
        >
          <div className="space-y-3">
            <TextField label="Connection name" value={connectionName} onChange={setConnectionName} required />
            <TextField label="Server URL" value={endpoint} onChange={setEndpoint} placeholder="https://" required />
          </div>
        </ConfirmDialog>
      ) : null}
    </>
  )
}

function modelKey(model: Pick<LlmModel, 'provider' | 'model'>): string {
  return `${model.provider}/${model.model}`
}

export function ConfigurationForm({
  form,
  tools,
  models,
  catalogError,
  configError,
  saving,
  onPrompt,
  onTemperature,
  onModel,
  onTool,
}: {
  form: ConfigForm
  tools: ToolCatalogItem[]
  models: LlmModel[]
  skills: SkillSummary[] | null
  skillsUnavailable: boolean
  catalogError: string | null
  configError: string | null
  saving: boolean
  onPrompt: (value: string) => void
  onTemperature: (value: string) => void
  onModel: (provider: string, model: string) => void
  onTool: (name: string, enabled: boolean) => void
  onSkill: (name: string, enabled: boolean) => void
  onApproval: (name: string, enabled: boolean) => void
  onSave: () => void
}) {
  const selectedModel = models.find(
    (item) => item.provider === form.llm_provider && item.model === form.llm_model,
  )
  const knownModel = selectedModel !== undefined
  const supportsTemperature =
    knownModel && selectedModel.temperature_min !== null && selectedModel.temperature_max !== null
  const toolOptions = namedOptions(tools, form.tool_names)

  return (
    <div className="space-y-4">
      {catalogError ? <Notice tone="error">{catalogError}</Notice> : null}

      <SectionCard title="Model and parameters">
        <fieldset className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" disabled={saving}>
          <label className="block space-y-1.5 text-sm">
            <span className="block font-medium">Model</span>
            <select
              aria-label="Model"
              className={fieldClass}
              value={modelKey({ provider: form.llm_provider, model: form.llm_model })}
              onChange={(event) => {
                const [provider, ...rest] = event.target.value.split('/')
                onModel(provider, rest.join('/'))
              }}
            >
              {models.map((model) => (
                <option key={modelKey(model)} value={modelKey(model)}>
                  {modelKey(model)}
                </option>
              ))}
              {!knownModel ? (
                <option value={modelKey({ provider: form.llm_provider, model: form.llm_model })}>
                  {modelKey({ provider: form.llm_provider, model: form.llm_model })}
                </option>
              ) : null}
            </select>
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="block font-medium">Temperature</span>
            <input
              aria-label="Temperature"
              className={fieldClass}
              inputMode="decimal"
              disabled={!supportsTemperature && knownModel}
              min={supportsTemperature ? selectedModel.temperature_min ?? undefined : undefined}
              max={supportsTemperature ? selectedModel.temperature_max ?? undefined : undefined}
              value={form.temperature}
              onChange={(event) => onTemperature(event.target.value)}
            />
            <span className="block text-xs text-muted-foreground">
              {supportsTemperature
                ? `Range ${selectedModel.temperature_min}–${selectedModel.temperature_max}`
                : knownModel
                  ? 'This model uses a fixed temperature.'
                  : null}
            </span>
          </label>
        </fieldset>
      </SectionCard>

      <SectionCard title="System instructions" description="Standing rules included with every call.">
        <TextArea
          label="Instructions"
          markdown
          mono
          rows={6}
          maxHeight="min(24rem, 55svh)"
          maxLength={20_000}
          value={form.system_prompt}
          disabled={saving}
          onChange={onPrompt}
        />
      </SectionCard>

      <SectionCard title="Built-in Tools">
        <ul className="space-y-2">
          {toolOptions.map((tool) => {
            const checked = form.tool_names.includes(tool.name)
            return (
              <li key={tool.name}>
                <label
                  className={cn(
                    'flex items-start gap-3 rounded-xl border px-3 py-2.5',
                    checked ? 'border-primary/40 bg-primary-soft/60' : 'border-border bg-card',
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-[var(--color-primary)]"
                    checked={checked}
                    disabled={saving}
                    aria-label={toolLabel(tool.name)}
                    onChange={(event) => onTool(tool.name, event.target.checked)}
                  />
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium">{toolLabel(tool.name)}</span>
                    {tool.description ? (
                      <span className="mt-0.5 block text-muted-foreground">{tool.description}</span>
                    ) : null}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      </SectionCard>

      {configError ? <Notice tone="error">{configError}</Notice> : null}
    </div>
  )
}

function toolLabel(name: string): string {
  const words: Record<string, string> = { pdf: 'PDF' }
  return name
    .split(/[-_]/)
    .map((part) => words[part] ?? (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(' ')
}
