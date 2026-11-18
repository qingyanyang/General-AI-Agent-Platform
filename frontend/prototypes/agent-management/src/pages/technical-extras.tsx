/** PROTOTYPE built-in tools, MCP connections, and knowledge documents on Configure. */
import { Trash2 } from 'lucide-react'
import { useEffect, useId, useReducer, useState, type FormEvent } from 'react'

import { formatDateTime } from '../format'
import { draftKnowledge, draftMcpServers, type DraftChange, type KnowledgeDraft, type McpConnectionDraft } from '../mock/configuration-draft'
import {
  assignedMcpTools,
  discoverMcpTools,
  listBuiltinTools,
  listMcpServers,
  type KnowledgeDocument,
  type McpAuth,
  type McpServer,
  type McpTool,
} from '../mock/product-state'
import {
  AddButton,
  Badge,
  Button,
  CheckRow,
  ConfirmDialog,
  FormDialog,
  IconButton,
  Notice,
  SectionCard,
  SelectField,
  TextField,
} from '../ui'

function toolLabel(name: string): string {
  const words: Record<string, string> = { pdf: 'PDF' }
  return name
    .split('-')
    .map((part) => words[part] ?? (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(' ')
}

export function ToolsSection({
  assigned,
  loading,
  error,
  onToggle,
  saving,
}: {
  assigned: string[] | null
  loading: boolean
  error: string | null
  onToggle: (name: string, enabled: boolean) => void
  saving: boolean
}) {
  const tools = listBuiltinTools()

  return (
    <SectionCard title="Built-in Tools">
      {error ? <Notice tone="error" className="mb-3">{error}</Notice> : null}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading tools…</p>
      ) : assigned !== null ? (
        <ul className="space-y-2">
          {tools.map((tool) => (
            <li key={tool.name}>
              <CheckRow
                label={toolLabel(tool.name)}
                description={tool.description}
                checked={assigned.includes(tool.name)}
                disabled={saving}
                onChange={(checked) => onToggle(tool.name, checked)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </SectionCard>
  )
}

function fileType(name: string): KnowledgeDocument['type'] | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.pdf')) {
    return 'pdf'
  }
  if (lower.endsWith('.docx')) {
    return 'docx'
  }
  if (lower.endsWith('.txt')) {
    return 'txt'
  }
  return null
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function statusLabel(status: KnowledgeDocument['status']): string {
  switch (status) {
    case 'processing':
      return 'Processing'
    case 'ready':
      return 'Ready'
    case 'failed':
      return 'Failed'
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}

export function KnowledgeSection({
  agentId,
  drafts,
  onDraftChange,
  saving,
}: {
  agentId: string
  drafts: Record<string, DraftChange<KnowledgeDraft>>
  onDraftChange: (id: string, change: DraftChange<KnowledgeDraft> | null) => void
  saving: boolean
}) {
  const documents = draftKnowledge(agentId, drafts)
  const [, refresh] = useReducer((count: number) => count + 1, 0)
  const [adding, setAdding] = useState(false)
  const [selected, setSelected] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<KnowledgeDocument | null>(null)
  const fileId = useId()
  const processing = documents.some((document) => !document.draft && document.status === 'processing')

  useEffect(() => {
    if (!processing) {
      return
    }
    const timer = window.setInterval(refresh, 900)
    return () => window.clearInterval(timer)
  }, [processing])

  const choose = (files: FileList | null) => {
    const next = [...(files ?? [])]
    const supported = next.filter((file) => fileType(file.name) !== null)
    setSelected(supported)
    setError(supported.length === next.length ? null : 'Only PDF, DOCX, and TXT files can be added.')
  }

  const closeAdd = () => {
    setAdding(false)
    setSelected([])
    setError(null)
  }

  const upload = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    for (const file of selected) {
      const type = fileType(file.name)
      if (type) {
        onDraftChange(`draft-document-${crypto.randomUUID()}`, {
          kind: 'added',
          value: { name: file.name, type, sizeBytes: file.size },
        })
      }
    }
    closeAdd()
  }

  return (
    <SectionCard
      title="Knowledge"
      description="Reference documents available to this agent."
      aside={<AddButton size="sm" disabled={saving} onClick={() => setAdding(true)}>Add documents</AddButton>}
    >
      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {documents.map((document) => (
            <li key={document.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{document.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {document.type.toUpperCase()} · {formatSize(document.sizeBytes)}
                  {document.draft ? null : ` · ${formatDateTime(document.uploadedAt)}`}
                </p>
              </div>
              <Badge tone={document.status === 'failed' ? 'danger' : document.status === 'processing' ? 'warning' : 'success'}>
                {document.draft ? 'Draft' : statusLabel(document.status)}
              </Badge>
              <IconButton
                label={`Delete ${document.name}`}
                className="size-8 text-danger hover:bg-danger-soft"
                disabled={saving}
                onClick={() => setPendingDelete(document)}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <FormDialog
        open={adding}
        title="Add documents"
        description="Choose PDF, DOCX, or TXT files for this agent."
        onClose={closeAdd}
        onSubmit={upload}
        submitLabel="Add to draft"
        busy={saving}
        dirty={selected.length > 0}
        disabled={selected.length === 0}
        error={error}
      >
        <div className="space-y-1.5">
          <label htmlFor={fileId} className="block text-sm font-medium">Files</label>
          <input
            id={fileId}
            type="file"
            accept=".pdf,.docx,.txt,application/pdf,text/plain"
            multiple
            className="block w-full rounded-xl border border-border-strong px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-2.5 file:py-1 file:font-medium file:text-primary"
            onChange={(event) => choose(event.target.files)}
          />
        </div>
        {selected.length > 0 ? (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {selected.map((file, index) => (
              <li key={`${file.name}-${index}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 break-words">{file.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatSize(file.size)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </FormDialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Remove document?"
        confirmLabel="Remove"
        tone="danger"
        busy={saving}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            onDraftChange(pendingDelete.id, drafts[pendingDelete.id]?.kind === 'added' ? null : { kind: 'removed' })
          }
          setPendingDelete(null)
        }}
      >
        {pendingDelete && drafts[pendingDelete.id]?.kind === 'added'
          ? `Remove ${pendingDelete.name} from the draft?`
          : `Publishing will remove ${pendingDelete?.name} from this agent.`}
      </ConfirmDialog>
    </SectionCard>
  )
}

function shortEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    return `${url.host}${url.pathname}`.replace(/\/$/, '')
  } catch {
    return endpoint
  }
}

const EMPTY_CONNECTION: McpConnectionDraft = { name: '', endpoint: '', auth: 'none' }

function connectionFields({ name, endpoint, auth }: McpConnectionDraft): McpConnectionDraft {
  return { name, endpoint, auth }
}

function sameConnection(first: McpConnectionDraft, second: McpConnectionDraft): boolean {
  return first.name === second.name && first.endpoint === second.endpoint && first.auth === second.auth
}

export function McpSection({
  agentId,
  drafts,
  toolChanges,
  onDraftChange,
  onToolChange,
  saving,
}: {
  agentId: string
  drafts: Record<string, DraftChange<McpConnectionDraft>>
  toolChanges: Record<string, boolean>
  onDraftChange: (id: string, change: DraftChange<McpConnectionDraft> | null) => void
  onToolChange: (id: string, enabled: boolean | null) => void
  saving: boolean
}) {
  const servers = draftMcpServers(drafts)
  const assigned = assignedMcpTools(agentId)
  const [editor, setEditor] = useState<{ id: string; server: McpServer | null } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<McpServer | null>(null)
  const tools = editor ? editor.server?.tools ?? discoverMcpTools(editor.id) : []

  return (
    <SectionCard
      title="MCP Connections"
      description="Each connection supplies tools you can enable for this agent."
      aside={
        <AddButton
          size="sm"
          disabled={saving}
          onClick={() => setEditor({ id: `draft-mcp-${crypto.randomUUID()}`, server: null })}
        >
          Add connection
        </AddButton>
      }
    >
      {servers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No MCP connections yet.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {servers.map((server) => (
            <li key={server.id} className="flex items-start gap-2 px-3 py-2.5">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-start rounded-lg px-1 py-1 text-left hover:bg-muted"
                aria-haspopup="dialog"
                aria-label={`Edit ${server.name}`}
                disabled={saving}
                onClick={() => setEditor({ id: server.id, server })}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{server.name}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">{shortEndpoint(server.endpoint)}</span>
                </span>
              </button>
              {drafts[server.id]?.kind !== 'added' ? (
                <Badge className="self-center" tone={server.status === 'connected' ? 'success' : 'neutral'}>
                  {server.status === 'connected' ? 'Connected' : 'Disabled'}
                </Badge>
              ) : null}
              <IconButton
                label={`Remove ${server.name}`}
                className="size-8 text-danger hover:bg-danger-soft"
                disabled={saving}
                onClick={() => setPendingDelete(server)}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      {editor ? (
        <ConnectionDialog
          server={editor.server}
          tools={tools}
          initialTools={tools.filter(({ id }) => toolChanges[id] ?? assigned.includes(id)).map(({ id }) => id)}
          saving={saving}
          onClose={() => setEditor(null)}
          onApply={(value, selectedTools) => {
            const published = listMcpServers().find((server) => server.id === editor.id)
            if (published) {
              onDraftChange(editor.id, sameConnection(value, published) ? null : { kind: 'edited', value })
            } else {
              onDraftChange(editor.id, { kind: 'added', value })
            }
            for (const { id } of tools) {
              const selected = selectedTools.has(id)
              const change = selected === assigned.includes(id) ? null : selected
              if (change !== (toolChanges[id] ?? null)) {
                onToolChange(id, change)
              }
            }
            setEditor(null)
          }}
        />
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Remove MCP connection?"
        confirmLabel="Remove"
        tone="danger"
        busy={saving}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            onDraftChange(pendingDelete.id, drafts[pendingDelete.id]?.kind === 'added' ? null : { kind: 'removed' })
            for (const tool of pendingDelete.tools) {
              if (toolChanges[tool.id] !== undefined) {
                onToolChange(tool.id, null)
              }
            }
          }
          setPendingDelete(null)
        }}
      >
        {pendingDelete && drafts[pendingDelete.id]?.kind === 'added'
          ? `Remove ${pendingDelete.name} from the draft?`
          : `Publishing will remove ${pendingDelete?.name} and its tools from every agent using it.`}
      </ConfirmDialog>
    </SectionCard>
  )
}

function ConnectionDialog({
  server,
  tools,
  initialTools,
  onApply,
  onClose,
  saving,
}: {
  server: McpServer | null
  tools: McpTool[]
  initialTools: string[]
  onApply: (value: McpConnectionDraft, selectedTools: ReadonlySet<string>) => void
  onClose: () => void
  saving: boolean
}) {
  const original = server ?? EMPTY_CONNECTION
  const [draft, setDraft] = useState(() => connectionFields(original))
  const [selected, setSelected] = useState(() => new Set(initialTools))
  const [apiKey, setApiKey] = useState('')
  const [previewTools, setPreviewTools] = useState(false)
  const keyId = useId()
  const needsKey = draft.auth === 'api-key' && original.auth !== 'api-key'
  const canApply = draft.name.trim() !== '' && draft.endpoint.trim() !== '' && (!needsKey || apiKey.trim() !== '')
  const dirty = !sameConnection(draft, original) || selected.size !== initialTools.length ||
    initialTools.some((id) => !selected.has(id))

  return (
    <FormDialog
      open
      title={server ? 'Edit MCP connection' : 'Add MCP connection'}
      submitLabel={server ? 'Update connection' : 'Add to draft'}
      busy={saving}
      onClose={onClose}
      onSubmit={() => onApply({ ...draft, name: draft.name.trim(), endpoint: draft.endpoint.trim() }, selected)}
      dirty={dirty}
      disabled={!canApply || !dirty}
    >
      <ConnectionFields draft={draft} onChange={(next) => {
        if (next.auth !== draft.auth) setApiKey('')
        setDraft(next)
      }} />
      {needsKey ? (
        <div className="space-y-1.5">
          <label htmlFor={keyId} className="block text-sm font-medium">API key</label>
          <input
            id={keyId}
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            aria-describedby={`${keyId}-hint`}
            required
            className="w-full rounded-xl border border-border-strong bg-card px-3 py-2 text-sm"
          />
          <p id={`${keyId}-hint`} className="text-xs text-muted-foreground">Use an example key for this prototype.</p>
        </div>
      ) : null}
      {server || previewTools ? (
        <fieldset className="space-y-2">
          <legend className="pb-2 text-sm font-medium">{server ? 'Available tools' : 'Sample tools'}</legend>
          {tools.map((tool) => (
            <CheckRow
              key={tool.id}
              label={tool.name}
              description={tool.description}
              checked={selected.has(tool.id)}
              disabled={server?.status === 'disabled'}
              onChange={(checked) => {
                const next = new Set(selected)
                if (checked) next.add(tool.id)
                else next.delete(tool.id)
                setSelected(next)
              }}
            />
          ))}
        </fieldset>
      ) : (
        <Button variant="outline" size="sm" disabled={!canApply} onClick={() => setPreviewTools(true)}>
          Preview tools
        </Button>
      )}
    </FormDialog>
  )
}

function ConnectionFields({
  draft,
  onChange,
}: {
  draft: McpConnectionDraft
  onChange: (draft: McpConnectionDraft) => void
}) {
  return (
    <div className="space-y-4">
      <TextField label="Connection name" value={draft.name} onChange={(name) => onChange({ ...draft, name })} required />
      <TextField
        label="Server URL"
        value={draft.endpoint}
        onChange={(endpoint) => onChange({ ...draft, endpoint })}
        placeholder="https://"
        required
      />
      <SelectField
        label="Authentication"
        value={draft.auth}
        onChange={(auth) => onChange({ ...draft, auth: auth as McpAuth })}
      >
        <option value="none">None</option>
        <option value="api-key">API key</option>
      </SelectField>
    </div>
  )
}
