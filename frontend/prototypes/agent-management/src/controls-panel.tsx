/** PROTOTYPE-ONLY Demo controls. Not a production role switcher. */
import { RotateCcw } from 'lucide-react'
import { useId } from 'react'

import { cn } from '@/lib/utils'

import { resetMockData } from './mock/client'
import { setOptions, useOptions, useRequestLog, type Scenario, type StreamFailure } from './mock/options'
import { PERSONAS } from './mock/roles'
import { Button, Dialog } from './ui'

const SCENARIOS: { value: Scenario; label: string; detail: string }[] = [
  { value: 'normal', label: 'Normal', detail: '350 ms per mock request.' },
  { value: 'empty', label: 'Empty', detail: 'No visible agents, conversations, groups, or executions.' },
  {
    value: 'slow',
    label: 'Slow network',
    detail: '1.8 s per request and slower streaming, to see loading and stale-response handling.',
  },
  {
    value: 'errors',
    label: 'API errors',
    detail: 'Agent list, conversations, groups, executions, and tool catalog fail.',
  },
]

const STREAM_FAILURES: { value: StreamFailure; label: string; detail: string }[] = [
  { value: 'none', label: 'Streams normally', detail: 'Scripted reply with tool activity and approvals.' },
  { value: 'interrupt', label: 'Interrupt the stream', detail: 'Connection closes mid-reply with no final event.' },
  { value: 'error', label: 'Agent error', detail: 'Stream ends with an error event.' },
  { value: 'forbidden', label: 'Execute denied (403)', detail: 'Shows the permission-denied state.' },
]

function Toggle({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string
  detail: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  const id = useId()
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        className="mt-1 size-4 accent-[var(--color-primary)]"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label htmlFor={id} className="text-sm">
        <span className="font-medium">{label}</span>
        <span className="block text-muted-foreground">{detail}</span>
      </label>
    </div>
  )
}

export function ControlsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const options = useOptions()
  const log = useRequestLog()
  return (
    <Dialog
      open={open}
      onRequestClose={onClose}
      variant="drawer"
      title="Demo controls"
      description="Prototype-only. Switch among people and the three fixed platform roles. This is not a product role switcher."
    >
      <div className="space-y-6 text-foreground">
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold">Signed-in person (Auth0 mapping mock)</legend>
          <p className="mb-2 text-xs text-muted-foreground">
            Platform roles: Super Admin, Admin, User. Multiple User people exercise different group leadership.
          </p>
          {PERSONAS.map((persona) => (
            <label
              key={persona.personaKey}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-2xl border px-3 py-2.5',
                options.persona === persona.personaKey ? 'border-primary/50 bg-primary-soft' : 'border-border',
              )}
            >
              <input
                type="radio"
                name="persona"
                className="mt-1 accent-[var(--color-primary)]"
                checked={options.persona === persona.personaKey}
                onChange={() => setOptions({ persona: persona.personaKey })}
              />
              <span className="min-w-0 text-sm">
                <span className="font-medium">
                  {persona.displayName} · {persona.label}
                </span>
                <span className="block text-muted-foreground">{persona.summary}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold">Data scenario</legend>
          {SCENARIOS.map((scenario) => (
            <label key={scenario.value} className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="radio"
                name="scenario"
                className="mt-1 accent-[var(--color-primary)]"
                checked={options.scenario === scenario.value}
                onChange={() => setOptions({ scenario: scenario.value })}
              />
              <span>
                <span className="font-medium">{scenario.label}</span>
                <span className="block text-muted-foreground">{scenario.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="space-y-3">
          <p className="text-sm font-semibold">Failure toggles</p>
          <Toggle
            label="Skill catalog returns 403"
            detail="Configuration stays editable; saved skills are kept."
            checked={options.skillsForbidden}
            onChange={(skillsForbidden) => setOptions({ skillsForbidden })}
          />
          <Toggle
            label="Fail the next save with 422"
            detail="Applies once to create, edit, configuration, or access saves."
            checked={options.failNextSave}
            onChange={(failNextSave) => setOptions({ failNextSave })}
          />
          <Toggle
            label="LangSmith project URL configured"
            detail="Shows the optional project link in execution details."
            checked={options.projectLink}
            onChange={(projectLink) => setOptions({ projectLink })}
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold">Next stream</legend>
          {STREAM_FAILURES.map((item) => (
            <label key={item.value} className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="radio"
                name="stream"
                className="mt-1 accent-[var(--color-primary)]"
                checked={options.nextStreamFailure === item.value}
                onChange={() => setOptions({ nextStreamFailure: item.value })}
              />
              <span>
                <span className="font-medium">{item.label}</span>
                <span className="block text-muted-foreground">{item.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="space-y-3">
          <p className="text-sm font-semibold">Chat simulation</p>
          <Toggle
            label="Next approval decision returns 409"
            detail="As if another tab already decided. The conversation reloads from history."
            checked={options.nextApprovalConflict}
            onChange={(nextApprovalConflict) => setOptions({ nextApprovalConflict })}
          />
          <Toggle
            label="Show demo prompts above the composer"
            detail="Clearly labeled PROTOTYPE chips that fill the composer."
            checked={options.demoPrompts}
            onChange={(demoPrompts) => setOptions({ demoPrompts })}
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold">How mock replies are chosen</p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>“multiply”, “add”, or “echo” run that tool, if the agent’s configuration has it.</li>
            <li>Tools listed under “Needs approval” pause for Approve / Reject.</li>
            <li>“…then double it” asks for a second multiply call (a second approval).</li>
            <li>“table” or “code” return Markdown tables or code blocks.</li>
          </ul>
        </div>

        <Button
          variant="outline"
          onClick={() => {
            resetMockData()
          }}
        >
          <RotateCcw className="size-4" aria-hidden />
          Reset mock data
        </Button>

        <div>
          <p className="mb-1 text-sm font-semibold">Mock request log</p>
          <p className="mb-2 text-xs text-muted-foreground">Every request below is answered in memory. Nothing leaves the browser.</p>
          {log.length === 0 ? (
            <p className="text-xs text-muted-foreground">No requests yet.</p>
          ) : (
            <ol className="max-h-48 space-y-1 overflow-y-auto font-mono text-[11px]">
              {log.map((entry) => (
                <li key={entry.id} className="flex gap-2 break-all">
                  <span className="shrink-0 text-muted-foreground">{entry.time}</span>
                  <span className="shrink-0 font-semibold">{entry.method}</span>
                  <span className="min-w-0 flex-1">{entry.path}</span>
                  <span
                    className={cn(
                      'shrink-0',
                      typeof entry.status === 'number' && entry.status >= 400 && 'text-danger',
                      entry.status === 'stale' && 'text-warning',
                    )}
                  >
                    {entry.status}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Not simulated: Auth0 sign-in, the 401 sign-out redirect, and live profile registration. Chat replies are
          scripted. Access is company-wide or group-based. Instruction Skills follow the agent’s managing group. Switching
          persona remounts the app and clears restricted screens.
        </p>
      </div>
    </Dialog>
  )
}
