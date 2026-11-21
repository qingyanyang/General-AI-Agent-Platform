import { useState } from 'react'
import { Link } from 'react-router-dom'

import { AccessPanel } from '@/components/manage/access-panel'
import { Button } from '@/components/ui/button'
import { LoadingRows } from '@/components/ui/primitives'
import { useManagement, type ConfigForm, type MetadataForm } from '@/components/manage/use-management'
import {
  displayExecutionStatus,
  EXECUTION_STATUSES,
  isOpenExecution,
} from '@/lib/execution-status'
import type { LlmModel, ManagementClient, SkillSummary, ToolCatalogItem } from '@/lib/management'
import { readProjectUrl } from '@/lib/project-link'

type ManagementPageProps = {
  client: ManagementClient
  permissions: ReadonlySet<string>
  accountLabel: string | null
  projectUrl?: string | null
  onUnauthorized: () => void
  onSignOut: () => void
}

const fieldClass =
  'w-full rounded-md border border-border bg-card px-3 py-2 text-sm'

function Field({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <input className={fieldClass} value={value} aria-label={label} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

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

function Checkboxes({
  legend,
  options,
  selected,
  onToggle,
  labelFor,
}: {
  legend: string
  options: { name: string; description: string }[]
  selected: string[]
  onToggle: (name: string, enabled: boolean) => void
  labelFor?: (name: string) => string
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      {options.length === 0 ? <p className="text-sm text-muted-foreground">None available.</p> : null}
      {options.map((option) => {
        const label = labelFor ? labelFor(option.name) : option.name
        return (
          <label key={option.name} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={selected.includes(option.name)}
              aria-label={label}
              onChange={(event) => onToggle(option.name, event.target.checked)}
            />
            <span>
              <span className="font-medium">{label}</span>
              {option.description ? (
                <span className="mt-0.5 block text-muted-foreground">{option.description}</span>
              ) : null}
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}

function modelKey(model: Pick<LlmModel, 'provider' | 'model'>): string {
  return `${model.provider}/${model.model}`
}

function ConfigurationForm({
  form,
  tools,
  models,
  skills,
  skillsUnavailable,
  catalogError,
  configError,
  saving,
  onPrompt,
  onTemperature,
  onModel,
  onTool,
  onSkill,
  onApproval,
  onSave,
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
  const approvalOptions = form.tool_names.map((name) => ({ name, description: '' }))
  const skillOptions = skills === null ? [] : namedOptions(skills, form.skill_names)

  return (
    <section className="space-y-4 rounded-xl border border-border p-4">
      <h2 className="text-sm font-medium">Configuration</h2>
      {catalogError ? (
        <p className="text-sm" role="alert">
          {catalogError}
        </p>
      ) : null}
      <label className="block text-sm">
        <span className="mb-1 block font-medium">System prompt</span>
        <textarea
          aria-label="System prompt"
          className={`${fieldClass} min-h-32 font-mono`}
          value={form.system_prompt}
          onChange={(event) => onPrompt(event.target.value)}
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Model</span>
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
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Temperature</span>
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
      </label>
      <Checkboxes
        legend="Tools"
        options={toolOptions}
        selected={form.tool_names}
        onToggle={onTool}
      />
      {skillsUnavailable ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Skills</p>
          <p className="text-sm text-muted-foreground">Skill discovery is unavailable.</p>
          {form.skill_names.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved skills.</p>
          ) : (
            <ul className="list-disc pl-5 text-sm">
              {form.skill_names.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <Checkboxes
          legend="Skills"
          options={skillOptions}
          selected={form.skill_names}
          onToggle={onSkill}
        />
      )}
      <Checkboxes
        legend="Approval required"
        options={approvalOptions}
        selected={form.approval_tool_names}
        onToggle={onApproval}
        labelFor={(name) => `Approve ${name}`}
      />
      {configError ? (
        <p className="text-sm" role="alert">
          {configError}
        </p>
      ) : null}
      <Button type="button" disabled={saving} onClick={onSave}>
        Save configuration
      </Button>
    </section>
  )
}

function ExecutionRow({
  execution,
  projectUrl,
}: {
  execution: {
    id: string
    status: string
    started_at: string
    completed_at: string | null
    duration_ms: number | null
    error_summary: string | null
    langsmith_run_id: string
  }
  projectUrl: string | null
}) {
  const open = isOpenExecution(execution.status)
  return (
    <article className="rounded-md border border-border p-3 text-sm">
      <p className="font-medium">{displayExecutionStatus(execution.status)}</p>
      <p className="text-muted-foreground">Started {execution.started_at}</p>
      {open ? (
        <p className="text-muted-foreground">No completion or duration yet.</p>
      ) : (
        <p className="text-muted-foreground">
          Completed {execution.completed_at ?? '—'}
          {execution.duration_ms === null ? '' : ` · ${execution.duration_ms} ms`}
        </p>
      )}
      {!open && execution.error_summary ? <p>{execution.error_summary}</p> : null}
      <label className="mt-2 block">
        <span className="mb-1 block text-muted-foreground">LangSmith correlation id</span>
        <input
          aria-label="LangSmith correlation id"
          className={fieldClass}
          readOnly
          value={execution.langsmith_run_id}
        />
      </label>
      {projectUrl ? (
        <a className="mt-2 inline-block text-sm underline" href={projectUrl}>
          Open LangSmith project
        </a>
      ) : null}
    </article>
  )
}

export function ManagementPage({
  client,
  permissions,
  accountLabel,
  projectUrl,
  onUnauthorized,
  onSignOut,
}: ManagementPageProps) {
  const page = useManagement({ client, permissions, onUnauthorized })
  const projectHref = readProjectUrl(projectUrl)
  const detail = page.detail
  // Agent id for which AccessPanel last reported audience_effective=true.
  // Scoped to that agent so opening an audience Agent does not hide grants for others.
  const [audienceEffectiveAgentId, setAudienceEffectiveAgentId] = useState<string | null>(null)
  const hideLegacyGrants =
    detail != null && audienceEffectiveAgentId === detail.id

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-8 px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs tracking-[0.18em] text-primary uppercase">Agent platform</p>
          <h1 className="text-2xl font-semibold">Manage agents</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="text-sm font-medium"
            onClick={(event) => {
              if (page.unsaved && !window.confirm('Discard unsaved changes?')) {
                event.preventDefault()
              }
            }}
          >
            Chat
          </Link>
          <Button type="button" variant="ghost" size="sm" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </header>
      <p className="text-sm text-muted-foreground">{accountLabel ?? 'Signed in'}</p>
      {page.actionError ? (
        <p className="text-sm" role="alert">
          {page.actionError}
        </p>
      ) : null}

      {page.canCreateAgent ? (
        <section className="space-y-3 rounded-xl border border-border p-4">
          <h2 className="text-sm font-medium">Create agent</h2>
          <Field label="New agent id" value={page.createId} onChange={page.setCreateId} />
          <Field label="New agent name" value={page.createName} onChange={page.setCreateName} />
          <Field
            label="New agent description"
            value={page.createDescription}
            onChange={page.setCreateDescription}
          />
          <Button type="button" disabled={page.creating} onClick={() => void page.createAgent()}>
            Create agent
          </Button>
        </section>
      ) : null}

      {page.canRead ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Agents</h2>
          {page.listError ? (
            <p className="text-sm" role="alert">
              {page.listError}
            </p>
          ) : null}
          {page.listLoading && page.agents.length === 0 ? (
            <LoadingRows label="Loading agents" rows={3} />
          ) : null}
          {!page.listLoading && page.agents.length === 0 && !page.listError ? (
            <p className="text-sm text-muted-foreground">No agents to show.</p>
          ) : null}
          <div className="flex flex-col gap-2">
            {page.agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className="rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  setAudienceEffectiveAgentId(null)
                  void page.openAgent(agent.id, agent)
                }}
              >
                <span className="font-medium">{agent.name}</span>
                <span className="mt-1 block text-muted-foreground">
                  {agent.id} · {agent.status} · {agent.created_by}
                </span>
              </button>
            ))}
          </div>
          {page.agentCursor ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => void page.loadMoreAgents()}>
              Load more agents
            </Button>
          ) : null}
        </section>
      ) : null}

      {page.canConfigure ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Open configuration</h2>
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              const id = String(data.get('configuration-agent-id') ?? '')
              setAudienceEffectiveAgentId(null)
              void page.openAgent(id)
            }}
          >
            <input
              name="configuration-agent-id"
              aria-label="Configuration agent id"
              className={fieldClass}
              placeholder="agent id"
            />
            <Button type="submit">Open configuration</Button>
          </form>
        </section>
      ) : null}

      {page.agentLoading ? <LoadingRows label="Loading agent details" rows={3} /> : null}
      {page.agentError ? (
        <p className="text-sm" role="alert">
          {page.agentError}
        </p>
      ) : null}

      {detail ? (
        <section className="space-y-4">
          <h2 className="text-lg font-medium">{detail.metadata?.name ?? detail.id}</h2>
          {detail.metadata ? (
            <p className="text-sm text-muted-foreground">
              {detail.metadata.status} · created by {detail.metadata.created_by} · updated{' '}
              {detail.metadata.updated_at}
            </p>
          ) : null}
          {!(page.canConfigure && detail.metadataForm) && detail.metadata?.description ? (
            <p className="text-sm">{detail.metadata.description}</p>
          ) : null}
          {detail.configDenied ? (
            <p className="text-sm" role="alert">
              {detail.configDenied}
            </p>
          ) : null}
          {page.canConfigure && detail.metadataForm ? (
            <form
              className="space-y-3 rounded-xl border border-border p-4"
              onSubmit={(event) => {
                event.preventDefault()
                void page.saveMetadata()
              }}
            >
              <h3 className="text-sm font-medium">Details</h3>
              <MetadataFields
                form={detail.metadataForm}
                onChange={page.updateMetadataField}
              />
              <div className="flex gap-2">
                <Button type="submit" disabled={page.savingMetadata}>
                  Save details
                </Button>
                {detail.metadata?.status === 'active' ? (
                  <Button type="button" variant="outline" onClick={() => void page.deactivate()}>
                    Deactivate
                  </Button>
                ) : null}
              </div>
            </form>
          ) : null}
          {page.canTechnical && detail.configForm ? (
            <ConfigurationForm
              form={detail.configForm}
              tools={detail.tools}
              models={detail.models}
              skills={detail.skills}
              skillsUnavailable={detail.skillsUnavailable}
              catalogError={detail.catalogError}
              configError={page.configError}
              saving={page.savingConfig}
              onPrompt={(value) => page.updateConfigField('system_prompt', value)}
              onTemperature={(value) => page.updateConfigField('temperature', value)}
              onModel={page.selectModel}
              onTool={page.toggleTool}
              onSkill={page.toggleSkill}
              onApproval={page.toggleApproval}
              onSave={() => void page.saveConfiguration()}
            />
          ) : null}
          {page.canManageAccess ? (
            <AccessPanel
              agentId={detail.id}
              client={client}
              onUnauthorized={onUnauthorized}
              onAudienceEffectiveChange={(agentId, effective) => {
                setAudienceEffectiveAgentId(effective ? agentId : null)
              }}
            />
          ) : null}
        </section>
      ) : null}

      {page.canManageAccess && !hideLegacyGrants ? (
        <section className="space-y-3 rounded-xl border border-border p-4">
          <h2 className="text-sm font-medium">Access grants</h2>
          <p className="text-sm text-muted-foreground">
            Legacy personal grants. Hidden after group-based access is activated for an agent.
          </p>
          <Field label="Grant agent id" value={page.grantAgentId} onChange={page.setGrantAgentId} />
          <Button type="button" onClick={() => void page.loadGrants(page.grantAgentId)}>
            Load grants
          </Button>
          <Field label="User id" value={page.grantUserId} onChange={page.setGrantUserId} />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={page.grantView}
              onChange={(event) => page.setGrantView(event.target.checked)}
            />
            Can view
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={page.grantConfigure}
              onChange={(event) => page.setGrantConfigure(event.target.checked)}
            />
            Can configure
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={page.grantExecute}
              onChange={(event) => page.setGrantExecute(event.target.checked)}
            />
            Can execute
          </label>
          <Button type="button" onClick={() => void page.saveGrant()}>
            Save grant
          </Button>
          {page.grantError ? (
            <p className="text-sm" role="alert">
              {page.grantError}
            </p>
          ) : null}
          <ul className="space-y-2">
            {page.grants.map((grant) => (
              <li key={grant.id} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {grant.user_id} · view {grant.can_view ? 'yes' : 'no'} · configure{' '}
                  {grant.can_configure ? 'yes' : 'no'} · execute {grant.can_execute ? 'yes' : 'no'}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void page.revokeGrant(grant.user_id, grant.agent_id)}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
          {page.grantCursor && page.grantQueryMatches ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => void page.loadMoreGrants()}>
              Load more grants
            </Button>
          ) : null}
          {page.grantLoading ? <LoadingRows label="Loading access" rows={3} /> : null}
        </section>
      ) : null}

      {page.canRead ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Execution history</h2>
          <Field
            label="Execution agent id"
            value={page.executionAgentId}
            onChange={page.setExecutionAgentId}
          />
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Execution status</span>
            <select
              aria-label="Execution status"
              className={fieldClass}
              value={page.executionStatus}
              onChange={(event) => page.setExecutionStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              {EXECUTION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {displayExecutionStatus(status)}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" onClick={() => void page.loadExecutions()}>
            Load executions
          </Button>
          {page.executionError ? (
            <p className="text-sm" role="alert">
              {page.executionError}
            </p>
          ) : null}
          <div className="space-y-2">
            {page.executions.map((execution) => (
              <ExecutionRow key={execution.id} execution={execution} projectUrl={projectHref} />
            ))}
          </div>
          {page.executionCursor && page.executionQueryMatches ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void page.loadMoreExecutions()}
            >
              Load more executions
            </Button>
          ) : null}
        </section>
      ) : null}
    </main>
  )
}

function MetadataFields({
  form,
  onChange,
}: {
  form: MetadataForm
  onChange: (field: keyof MetadataForm, value: string) => void
}) {
  return (
    <>
      <Field label="Name" value={form.name} onChange={(value) => onChange('name', value)} />
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Description</span>
        <textarea
          aria-label="Description"
          className={`${fieldClass} min-h-20`}
          value={form.description}
          onChange={(event) => onChange('description', event.target.value)}
        />
      </label>
    </>
  )
}
