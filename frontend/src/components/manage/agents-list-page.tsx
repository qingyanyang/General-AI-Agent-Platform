import { useNavigate } from 'react-router-dom'

import { useManagement } from '@/components/manage/use-management'
import { PageFrame } from '@/components/shell/app-shell'
import { useAppShell } from '@/components/shell/use-app-shell'
import { Button } from '@/components/ui/button'
import {
  AgentStatusBadge,
  EmptyState,
  LoadingRows,
  Notice,
  SectionCard,
  TextField,
} from '@/components/ui/primitives'
import {
  displayExecutionStatus,
  EXECUTION_STATUSES,
  isOpenExecution,
} from '@/lib/execution-status'
import { readProjectUrl } from '@/lib/project-link'
import { settingsPath } from '@/lib/routes'

const fieldClass =
  'w-full rounded-xl border border-border-strong bg-card px-3 py-2 text-sm'

export function AgentsListPage() {
  const {
    managementClient,
    permissions,
    onUnauthorized,
    openCreateAgent,
    canCreateAgent,
    projectUrl,
  } = useAppShell()
  const page = useManagement({
    client: managementClient,
    permissions,
    onUnauthorized,
  })
  const navigate = useNavigate()
  const projectHref = readProjectUrl(projectUrl)

  return (
    <PageFrame mobileTitle="Agents">
      <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs tracking-[0.18em] text-primary uppercase">Agent platform</p>
            <h1 className="font-serif text-3xl tracking-tight">Agents</h1>
          </div>
          {canCreateAgent ? (
            <Button type="button" onClick={openCreateAgent}>
              Create agent
            </Button>
          ) : null}
        </header>

        {page.actionError ? <Notice tone="error">{page.actionError}</Notice> : null}

        {page.canRead ? (
          <SectionCard title="Catalog" description="Agents visible to you.">
            {page.listError ? <Notice tone="error">{page.listError}</Notice> : null}
            {page.listLoading && page.agents.length === 0 ? (
              <LoadingRows label="Loading agents" rows={3} />
            ) : null}
            {!page.listLoading && page.agents.length === 0 && !page.listError ? (
              <EmptyState title="No agents to show">
                Create an agent or ask an administrator for access.
              </EmptyState>
            ) : null}
            <div className="flex flex-col gap-2">
              {page.agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  className="rounded-xl border border-border px-3 py-3 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    void navigate(settingsPath(agent.id))
                  }}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{agent.name}</span>
                    <AgentStatusBadge status={agent.status} />
                  </span>
                  <span className="mt-1 block font-mono text-xs text-muted-foreground">
                    {agent.id} · {agent.created_by}
                  </span>
                  {agent.description ? (
                    <span className="mt-1 block text-muted-foreground">{agent.description}</span>
                  ) : null}
                </button>
              ))}
            </div>
            {page.agentCursor ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-3"
                onClick={() => void page.loadMoreAgents()}
              >
                Load more agents
              </Button>
            ) : null}
          </SectionCard>
        ) : null}

        {page.canConfigure || page.canManageAccess ? (
          <SectionCard
            title="Open by agent ID"
            description="Configure or manage access when the agent is not in your catalog."
          >
            <form
              className="flex flex-col gap-3 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault()
                const data = new FormData(event.currentTarget)
                const id = String(data.get('configuration-agent-id') ?? '').trim()
                if (!id) {
                  return
                }
                void navigate(settingsPath(id))
              }}
            >
              <input
                name="configuration-agent-id"
                aria-label="Configuration agent id"
                className={fieldClass}
                placeholder="agent id"
              />
              <Button type="submit">Open settings</Button>
            </form>
          </SectionCard>
        ) : null}

        {page.canManageAccess ? (
          <SectionCard
            title="Access grants"
            description="Legacy personal grants. Hidden after group-based access is activated for an agent."
          >
            <div className="space-y-3">
              <TextField
                label="Grant agent id"
                value={page.grantAgentId}
                onChange={page.setGrantAgentId}
              />
              <Button type="button" onClick={() => void page.loadGrants(page.grantAgentId)}>
                Load grants
              </Button>
              <TextField label="User id" value={page.grantUserId} onChange={page.setGrantUserId} />
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
              {page.grantError ? <Notice tone="error">{page.grantError}</Notice> : null}
              <ul className="space-y-2">
                {page.grants.map((grant) => (
                  <li key={grant.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-mono">
                      {grant.user_id} · view {grant.can_view ? 'yes' : 'no'} · configure{' '}
                      {grant.can_configure ? 'yes' : 'no'} · execute{' '}
                      {grant.can_execute ? 'yes' : 'no'}
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
              {page.grantLoading ? (
                <LoadingRows label="Loading access" rows={3} />
              ) : null}
            </div>
          </SectionCard>
        ) : null}

        {page.canRead ? (
          <SectionCard
            title="Execution history"
            description="Your own execution records for an agent."
          >
            <div className="space-y-3">
              <TextField
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
              {page.executionError ? <Notice tone="error">{page.executionError}</Notice> : null}
              <div className="space-y-2">
                {page.executions.map((execution) => {
                  const open = isOpenExecution(execution.status)
                  return (
                    <article
                      key={execution.id}
                      className="rounded-xl border border-border p-3 text-sm"
                    >
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
                        <span className="mb-1 block text-muted-foreground">
                          LangSmith correlation id
                        </span>
                        <input
                          aria-label="LangSmith correlation id"
                          className={fieldClass}
                          readOnly
                          value={execution.langsmith_run_id}
                        />
                      </label>
                      {projectHref ? (
                        <a className="mt-2 inline-block text-sm underline" href={projectHref}>
                          Open LangSmith project
                        </a>
                      ) : null}
                    </article>
                  )
                })}
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
            </div>
          </SectionCard>
        ) : null}
      </div>
    </PageFrame>
  )
}
