import { AlertTriangle, ArrowLeft, FileText, KeyRound, Loader2, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { Link, Navigate, NavLink, useParams } from 'react-router-dom'

import { useChatOptional } from '@/components/chat/chat-provider'
import { AccessPanel } from '@/components/manage/access-panel'
import {
  ConfigurationForm,
  ConfigureExtras,
  type DraftConnection,
} from '@/components/manage/configuration-form'
import { KnowledgeReferencesPanel } from '@/components/manage/knowledge-references-panel'
import { InstructionSkillsPanel } from '@/components/manage/instruction-skills-panel'
import { useManagement, type ConfigForm, type MetadataForm } from '@/components/manage/use-management'
import { PageFrame } from '@/components/shell/app-shell'
import { useAppShell } from '@/components/shell/use-app-shell'
import { Button } from '@/components/ui/button'
import {
  AgentStatusBadge,
  Badge,
  ConfirmDialog,
  CopyText,
  LoadingRows,
  Notice,
  SectionCard,
  TextArea,
  TextField,
} from '@/components/ui/primitives'
import {
  useInstructionEligibility,
  type InstructionEligibilityState,
} from '@/hooks/use-instruction-eligibility'
import {
  clearAgentDraft,
  readAgentDraft,
  storeAgentDraft,
  useDraftAgentIds,
  type AgentDraft,
} from '@/lib/agent-drafts'
import { isApiError } from '@/lib/errors'
import type { InstructionSkillDraftFields } from '@/lib/instruction-skills'
import type { InstructionSkillItem, KnowledgeReference, ManagementClient } from '@/lib/management'
import {
  AGENT_ACCESS_MANAGE,
  AGENTS_CONFIGURE,
  AGENTS_READ,
  PLATFORM_TECHNICAL,
} from '@/lib/permissions'
import {
  SETTINGS_SECTIONS,
  chatPath,
  isSettingsSection,
  settingsPath,
  type SettingsSection,
} from '@/lib/routes'
import { cn } from '@/lib/utils'

function sectionMeta(section: SettingsSection): { label: string; icon: ReactNode } {
  switch (section) {
    case 'details':
      return { label: 'Details', icon: <FileText className="size-4" aria-hidden /> }
    case 'configuration':
      return { label: 'Configure', icon: <SlidersHorizontal className="size-4" aria-hidden /> }
    case 'access':
      return { label: 'Access', icon: <KeyRound className="size-4" aria-hidden /> }
    default: {
      const unreachable: never = section
      return unreachable
    }
  }
}

export function AgentSettingsPage() {
  const { agentId = '', section } = useParams()
  return <AgentSettings key={agentId} agentId={agentId} section={section} />
}

function AgentSettings({ agentId, section }: { agentId: string; section: string | undefined }) {
  const { managementClient, permissions, onUnauthorized } = useAppShell()
  const hasDraft = useDraftAgentIds().has(agentId)
  const chat = useChatOptional()
  const page = useManagement({
    client: managementClient,
    permissions,
    onUnauthorized,
  })
  const eligibility = useInstructionEligibility({
    managementClient,
    agentId,
    onUnauthorized,
  })
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const skillsPublish = useRef<(() => Promise<boolean>) | null>(null)
  const [extrasDirty, setExtrasDirty] = useState(false)
  const [skillsDirty, setSkillsDirty] = useState(false)
  const [published, setPublished] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [draftKey, setDraftKey] = useState(0)
  const agentChatPath = chatPath(agentId)
  const backToChat =
    chat && chat.lastChatPath.startsWith(agentChatPath) ? chat.lastChatPath : agentChatPath

  const canOpenDetails = permissions.has(AGENTS_CONFIGURE) || permissions.has(AGENTS_READ)
  const canOpenAccess = permissions.has(AGENT_ACCESS_MANAGE)
  const canOpenConfiguration =
    eligibility.status === 'eligible' ||
    eligibility.status === 'unknown' ||
    eligibility.status === 'loading' ||
    eligibility.status === 'error' ||
    permissions.has(PLATFORM_TECHNICAL)

  const allowed = SETTINGS_SECTIONS.filter((item) => {
    switch (item) {
      case 'details':
        return canOpenDetails
      case 'configuration':
        return canOpenConfiguration
      case 'access':
        return canOpenAccess
      default: {
        const unreachable: never = item
        return unreachable
      }
    }
  })

  useEffect(() => {
    void page.openAgent(agentId)
    // openAgent intentionally omitted — only re-open when agentId changes
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/agent switch
  }, [agentId])

  if (allowed.length === 0) {
    return (
      <PageFrame mobileTitle="Agent settings">
        <div className="mx-auto max-w-xl px-4 py-12">
          <Notice tone="warning" title="Settings unavailable">
            You do not have permission to view settings for this agent.
          </Notice>
          <Link to={backToChat} className="mt-4 inline-flex text-sm text-primary hover:underline">
            Back to chat
          </Link>
        </div>
      </PageFrame>
    )
  }

  const requested = isSettingsSection(section) ? section : null
  const active = requested && allowed.includes(requested) ? requested : allowed[0]
  if (!requested || !allowed.includes(requested)) {
    return <Navigate to={settingsPath(agentId, active)} replace />
  }

  const detail = page.detail
  const agentName = detail?.metadata?.name ?? agentId

  return (
    <PageFrame mobileTitle={`Settings · ${agentName}`}>
      <div className="flex min-h-full flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-5xl px-4 pt-5 sm:px-8 sm:pt-6">
          <Link
            to={backToChat}
            className="inline-flex max-w-full items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4 shrink-0" aria-hidden />
            <span className="truncate">Back to chat with {agentName}</span>
          </Link>
          <p className="mt-4 text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
            Agent settings
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 font-serif text-3xl break-words sm:text-4xl">{agentName}</h1>
            {hasDraft ? <Badge tone="warning">Draft</Badge> : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {detail?.metadata ? <AgentStatusBadge status={detail.metadata.status} /> : null}
            <div className="w-full max-w-xs min-w-0">
              <CopyText value={agentId} label="agent ID" />
            </div>
          </div>
          <nav aria-label="Settings sections" className="-mb-px mt-5 flex gap-1 overflow-x-auto">
            {allowed.map((item) => {
              const meta = sectionMeta(item)
              return (
                <NavLink
                  key={item}
                  to={settingsPath(agentId, item)}
                  className={({ isActive }) =>
                    cn(
                      'inline-flex shrink-0 items-center gap-2 border-b-2 px-2.5 pt-2 pb-3 text-sm font-medium whitespace-nowrap sm:px-3',
                      isActive
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )
                  }
                >
                  {meta.icon}
                  {meta.label}
                </NavLink>
              )
            })}
          </nav>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col space-y-4 px-4 pt-6 sm:px-8">
        {page.actionError ? <Notice tone="error">{page.actionError}</Notice> : null}
        {active !== 'access' && page.agentLoading ? (
          <LoadingRows label="Loading agent details" rows={3} />
        ) : null}
        {page.agentError ? <Notice tone="error">{page.agentError}</Notice> : null}

        {active === 'details' && detail ? (
          <div className="space-y-4">
            {page.canConfigure && detail.metadataForm ? (
              <SectionCard title="Details">
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void page.saveMetadata()
                  }}
                >
                  <fieldset className="space-y-4" disabled={page.savingMetadata}>
                    <MetadataFields form={detail.metadataForm} onChange={page.updateMetadataField} />
                  </fieldset>
                  <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
                    <Button
                      type="submit"
                      disabled={
                        page.savingMetadata ||
                        (detail.metadataForm.name === detail.savedMetadata?.name &&
                          detail.metadataForm.description === detail.savedMetadata?.description)
                      }
                    >
                      {page.savingMetadata ? 'Saving…' : 'Save changes'}
                    </Button>
                  </div>
                </form>
              </SectionCard>
            ) : detail.metadata?.description ? (
              <SectionCard title="Details">
                <p className="text-sm">{detail.metadata.description}</p>
              </SectionCard>
            ) : (
              <Notice tone="info">You can view this agent but cannot edit its details.</Notice>
            )}
            {page.canConfigure && detail.metadata ? (
              <section className="rounded-2xl border border-danger/30 bg-card p-5 sm:p-6">
                <h2 className="flex items-center gap-2 font-serif text-lg text-danger">
                  <AlertTriangle className="size-4" aria-hidden />
                  Danger zone
                </h2>
                <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <p className="font-medium">
                      {detail.metadata.status === 'active'
                        ? 'Deactivate this agent'
                        : 'This agent is inactive'}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {detail.metadata.status === 'active'
                        ? 'Blocks every new chat, message, and run. Existing conversations stay readable. Reactivation isn’t available.'
                        : 'New runs are blocked. Reactivation isn’t available.'}
                    </p>
                  </div>
                  {detail.metadata.status === 'active' ? (
                    <Button type="button" variant="danger-outline" onClick={() => setDeactivateOpen(true)}>
                      Deactivate…
                    </Button>
                  ) : null}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {active === 'configuration' ? (
          <ConfigureTab
            agentId={agentId}
            page={page}
            detail={detail}
            eligibility={eligibility}
            managementClient={managementClient}
            onUnauthorized={onUnauthorized}
            skillsPublish={skillsPublish}
            extrasDirty={extrasDirty}
            skillsDirty={skillsDirty}
            published={published}
            discarding={discarding}
            draftKey={draftKey}
            onExtrasDirty={setExtrasDirty}
            onSkillsDirty={setSkillsDirty}
            onPublished={setPublished}
            onDiscarding={setDiscarding}
            onDraftKey={setDraftKey}
          />
        ) : null}

        {active === 'access' && page.canManageAccess ? (
          <AccessPanel agentId={agentId} client={managementClient} onUnauthorized={onUnauthorized} />
        ) : null}
      </div>
      </div>

      <ConfirmDialog
        open={deactivateOpen}
        title="Deactivate this agent?"
        confirmLabel="Deactivate"
        tone="danger"
        onCancel={() => setDeactivateOpen(false)}
        onConfirm={() => {
          setDeactivateOpen(false)
          void page.deactivate()
        }}
      >
        The agent will stop accepting new work. This UI does not support reactivation.
      </ConfirmDialog>
    </PageFrame>
  )
}

function sameNames(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function sameConfig(left: ConfigForm, right: ConfigForm): boolean {
  return (
    left.system_prompt === right.system_prompt &&
    left.llm_provider === right.llm_provider &&
    left.llm_model === right.llm_model &&
    left.temperature === right.temperature &&
    sameNames(left.tool_names, right.tool_names) &&
    sameNames(left.skill_names, right.skill_names) &&
    sameNames(left.approval_tool_names, right.approval_tool_names)
  )
}

function sameExtras(left: DraftConnection[], right: DraftConnection[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (item, index) =>
        item.id === right[index]?.id &&
        item.name === right[index]?.name &&
        item.endpoint === right[index]?.endpoint,
    )
  )
}

function applyTechnical(
  current: ConfigForm,
  next: ConfigForm,
  actions: {
    updateConfigField: (field: keyof ConfigForm, value: string) => void
    selectModel: (provider: string, model: string) => void
    toggleTool: (name: string, enabled: boolean) => void
    toggleSkill: (name: string, enabled: boolean) => void
    toggleApproval: (name: string, enabled: boolean) => void
  },
) {
  if (current.llm_provider !== next.llm_provider || current.llm_model !== next.llm_model) {
    actions.selectModel(next.llm_provider, next.llm_model)
  }
  if (current.system_prompt !== next.system_prompt) {
    actions.updateConfigField('system_prompt', next.system_prompt)
  }
  if (current.temperature !== next.temperature) {
    actions.updateConfigField('temperature', next.temperature)
  }
  for (const name of current.tool_names) {
    if (!next.tool_names.includes(name)) {
      actions.toggleTool(name, false)
    }
  }
  for (const name of next.tool_names) {
    if (!current.tool_names.includes(name)) {
      actions.toggleTool(name, true)
    }
  }
  for (const name of current.skill_names) {
    if (!next.skill_names.includes(name)) {
      actions.toggleSkill(name, false)
    }
  }
  for (const name of next.skill_names) {
    if (!current.skill_names.includes(name)) {
      actions.toggleSkill(name, true)
    }
  }
  for (const name of current.approval_tool_names) {
    if (!next.approval_tool_names.includes(name)) {
      actions.toggleApproval(name, false)
    }
  }
  for (const name of next.approval_tool_names) {
    if (!current.approval_tool_names.includes(name)) {
      actions.toggleApproval(name, true)
    }
  }
}

function ConfigureTab({
  agentId,
  page,
  detail,
  eligibility,
  managementClient,
  onUnauthorized,
  skillsPublish,
  extrasDirty,
  skillsDirty,
  published,
  discarding,
  draftKey,
  onExtrasDirty,
  onSkillsDirty,
  onPublished,
  onDiscarding,
  onDraftKey,
}: {
  agentId: string
  page: ReturnType<typeof useManagement>
  detail: ReturnType<typeof useManagement>['detail']
  eligibility: InstructionEligibilityState
  managementClient: ManagementClient
  onUnauthorized: () => void
  skillsPublish: MutableRefObject<(() => Promise<boolean>) | null>
  extrasDirty: boolean
  skillsDirty: boolean
  published: boolean
  discarding: boolean
  draftKey: number
  onExtrasDirty: (dirty: boolean) => void
  onSkillsDirty: (dirty: boolean) => void
  onPublished: (published: boolean) => void
  onDiscarding: (open: boolean) => void
  onDraftKey: (key: number) => void
}) {
  const form = detail?.configForm ?? null
  const saved = detail?.savedConfig ?? null
  const stored = readAgentDraft(agentId)
  const [skillFields, setSkillFields] = useState<InstructionSkillDraftFields[] | null>(
    stored?.skills ?? null,
  )
  const [extras, setExtras] = useState<{ connections: DraftConnection[] }>(
    () => ({
      connections: stored?.connections ?? [],
    }),
  )
  const [publishedSkills, setPublishedSkills] = useState<InstructionSkillItem[] | null>(null)
  const [publishedDocuments, setPublishedDocuments] = useState<KnowledgeReference[] | null>(null)
  const [documents, setDocuments] = useState<KnowledgeReference[] | null>(stored?.documents ?? null)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const onSkillFields = useCallback((fields: InstructionSkillDraftFields[] | null) => {
    setSkillFields(fields)
  }, [])
  const onExtras = useCallback(
    (snapshot: { connections: DraftConnection[] }) => {
      setExtras((current) =>
        sameExtras(current.connections, snapshot.connections)
          ? current
          : snapshot,
      )
    },
    [],
  )
  const technicalDirty = Boolean(
    form &&
      saved &&
      (form.system_prompt !== saved.system_prompt ||
        form.llm_provider !== saved.llm_provider ||
        form.llm_model !== saved.llm_model ||
        form.temperature !== saved.temperature ||
        !sameNames(form.tool_names, saved.tool_names)),
  )
  const dirty = technicalDirty || extrasDirty || skillsDirty || documents !== null

  const { updateConfigField, selectModel, toggleTool, toggleSkill, toggleApproval } = page

  useEffect(() => {
    if (live) {
      return
    }
    if (page.canTechnical) {
      if (!form || !saved) {
        return
      }
      const pending = readAgentDraft(agentId)?.technical ?? null
      if (pending && !sameConfig(pending, form)) {
        applyTechnical(form, pending, {
          updateConfigField,
          selectModel,
          toggleTool,
          toggleSkill,
          toggleApproval,
        })
        return
      }
    }
    setLive(true)
  }, [
    agentId,
    form,
    live,
    page.canTechnical,
    saved,
    selectModel,
    toggleApproval,
    toggleSkill,
    toggleTool,
    updateConfigField,
  ])

  useEffect(() => {
    const technical = live
      ? (technicalDirty ? form : null)
      : (readAgentDraft(agentId)?.technical ?? null)
    const next: AgentDraft = {
      technical,
      skills: skillFields,
      connections: extras.connections,
      documents,
    }
    storeAgentDraft(agentId, next)
  }, [agentId, documents, extras, form, live, skillFields, technicalDirty])

  const restoreTechnical = () => {
    if (!form || !saved) {
      return
    }
    if (form.system_prompt !== saved.system_prompt) {
      page.updateConfigField('system_prompt', saved.system_prompt)
    }
    if (form.temperature !== saved.temperature) {
      page.updateConfigField('temperature', saved.temperature)
    }
    if (form.llm_provider !== saved.llm_provider || form.llm_model !== saved.llm_model) {
      page.selectModel(saved.llm_provider, saved.llm_model)
    }
    for (const name of form.tool_names) {
      if (!saved.tool_names.includes(name)) {
        page.toggleTool(name, false)
      }
    }
    for (const name of saved.tool_names) {
      if (!form.tool_names.includes(name)) {
        page.toggleTool(name, true)
      }
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4" aria-busy={page.savingConfig}>
      {eligibility.status === 'unknown' || eligibility.status === 'loading' ? (
        <LoadingRows label="Checking Instruction Skills access" rows={2} />
      ) : null}
      {eligibility.status === 'error' ? (
        <Notice
          tone="error"
          title="Could not load Instruction Skills"
          action={
            <Button type="button" size="sm" variant="outline" onClick={eligibility.retry}>
              Retry
            </Button>
          }
        >
          {eligibility.message}
        </Notice>
      ) : null}
      {page.canTechnical && form ? (
        <ConfigurationForm
          form={form}
          tools={detail?.tools ?? []}
          models={detail?.models ?? []}
          skills={detail?.skills ?? null}
          skillsUnavailable={detail?.skillsUnavailable ?? false}
          catalogError={detail?.catalogError ?? null}
          configError={page.configError}
          saving={page.savingConfig}
          onPrompt={(value) => {
            onPublished(false)
            page.updateConfigField('system_prompt', value)
          }}
          onTemperature={(value) => {
            onPublished(false)
            page.updateConfigField('temperature', value)
          }}
          onModel={(provider, model) => {
            onPublished(false)
            page.selectModel(provider, model)
          }}
          onTool={(name, enabled) => {
            onPublished(false)
            page.toggleTool(name, enabled)
          }}
          onSkill={page.toggleSkill}
          onApproval={page.toggleApproval}
          onSave={() => undefined}
        />
      ) : null}
      <ConfigureExtras
        key={draftKey}
        showConnections={page.canTechnical}
        saving={page.savingConfig}
        initialConnections={extras.connections}
        onSnapshot={onExtras}
        onDirtyChange={onExtrasDirty}
        between={
          eligibility.status === 'eligible' ? (
            <InstructionSkillsPanel
              key={draftKey}
              agentId={agentId}
              client={managementClient}
              initialItems={publishedSkills ?? eligibility.items}
              onBaselineChange={setPublishedSkills}
              onUnauthorized={onUnauthorized}
              showPublish={false}
              publishRef={skillsPublish}
              onDirtyChange={onSkillsDirty}
              draftFields={skillFields}
              onFieldsChange={onSkillFields}
            />
          ) : null
        }
      />
      {eligibility.status === 'eligible' ? (
        <KnowledgeReferencesPanel
          key={agentId}
          agentId={agentId}
          client={managementClient}
          onUnauthorized={onUnauthorized}
          baseline={publishedDocuments}
          draft={documents}
          disabled={publishing || page.savingConfig}
          onLoad={setPublishedDocuments}
          onDraftChange={(references) => {
            setDocuments(references)
            setPublishError(null)
            onPublished(false)
          }}
        />
      ) : null}
      {publishError ? <Notice tone="error" title="Could not publish knowledge references">{publishError}</Notice> : null}
      {detail?.configDenied ? <Notice tone="error">{detail.configDenied}</Notice> : null}
      <form
        aria-label="Publish agent configuration"
        className="sticky bottom-0 z-10 mt-auto ml-[calc(50%-50cqw)] w-[100cqw] max-w-none border-t border-border bg-card"
        onSubmit={(event) => {
          event.preventDefault()
          if (!dirty || publishing || page.savingConfig) {
            return
          }
          setPublishing(true)
          setPublishError(null)
          onPublished(false)
          void (async () => {
            try {
              if (page.canTechnical && technicalDirty && !(await page.saveConfiguration())) {
                return
              }
              if (skillsDirty && !(await skillsPublish.current?.())) {
                return
              }
              if (documents !== null) {
                const references = await managementClient.putKnowledgeReferences(agentId, documents)
                const pending = readAgentDraft(agentId)
                if (pending?.documents === documents) {
                  storeAgentDraft(agentId, { ...pending, documents: null })
                }
                setPublishedDocuments(references)
                setDocuments(null)
              }
              setSkillFields(null)
              setExtras({ connections: [] })
              onDraftKey(draftKey + 1)
              onPublished(true)
            } catch (caught) {
              if (isApiError(caught) && caught.status === 401) {
                onUnauthorized()
                return
              }
              setPublishError(isApiError(caught) ? caught.message : 'Try publishing again.')
            } finally {
              setPublishing(false)
            }
          })()
        }}
      >
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-end gap-2 px-4 py-3 sm:px-8">
          <div role="status" className="mr-auto">
            {published && !dirty ? <Badge tone="success">Published</Badge> : null}
          </div>
          {dirty ? (
            <Button type="button" variant="ghost" disabled={publishing || page.savingConfig} onClick={() => onDiscarding(true)}>
              Discard draft
            </Button>
          ) : null}
          <Button type="submit" disabled={publishing || page.savingConfig || !dirty}>
            {publishing || page.savingConfig ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {publishing || page.savingConfig ? 'Publishing…' : 'Publish'}
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={discarding}
        title="Discard draft?"
        confirmLabel="Discard draft"
        tone="danger"
        onCancel={() => onDiscarding(false)}
        onConfirm={() => {
          restoreTechnical()
          setSkillFields(null)
          setExtras({ connections: [] })
          setDocuments(null)
          setPublishError(null)
          clearAgentDraft(agentId)
          onDraftKey(draftKey + 1)
          onPublished(false)
          onDiscarding(false)
        }}
      >
        This restores the last published configuration for this agent.
      </ConfirmDialog>
    </div>
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
      <TextField label="Name" value={form.name} required onChange={(value) => onChange('name', value)} />
      <TextArea
        label="Description"
        value={form.description}
        onChange={(value) => onChange('description', value)}
        rows={3}
      />
    </>
  )
}
