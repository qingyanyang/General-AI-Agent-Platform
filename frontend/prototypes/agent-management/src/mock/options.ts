/** PROTOTYPE controls state: persona, data scenario, failure toggles, and the mock request log. */
import { useSyncExternalStore } from 'react'

import { PERSONAS } from './roles'

export type Scenario = 'normal' | 'empty' | 'slow' | 'errors'

/** One-shot failure applied to the next streamed chat message. */
export type StreamFailure = 'none' | 'interrupt' | 'error' | 'forbidden'

export type PrototypeOptions = {
  /** Demo persona key (may be a person who shares the User platform role). */
  persona: string
  scenario: Scenario
  skillsForbidden: boolean
  failNextSave: boolean
  projectLink: boolean
  nextStreamFailure: StreamFailure
  nextApprovalConflict: boolean
  demoPrompts: boolean
}

export type LogEntry = {
  id: number
  time: string
  method: string
  path: string
  status: number | 'aborted' | 'stale'
}

const STORAGE_KEY = 'PROTOTYPE-agent-management-options-v3'

const DEFAULT_OPTIONS: PrototypeOptions = {
  persona: 'admin',
  scenario: 'normal',
  skillsForbidden: false,
  failNextSave: false,
  projectLink: true,
  nextStreamFailure: 'none',
  nextApprovalConflict: false,
  demoPrompts: true,
}

function readStored(): PrototypeOptions {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_OPTIONS
    }
    const merged = { ...DEFAULT_OPTIONS, ...(JSON.parse(raw) as Partial<PrototypeOptions>) }
    if (!PERSONAS.some((persona) => persona.personaKey === merged.persona)) {
      merged.persona = DEFAULT_OPTIONS.persona
    }
    return merged
  } catch {
    return DEFAULT_OPTIONS
  }
}

let options: PrototypeOptions = readStored()
let log: LogEntry[] = []
let logSeq = 0
let dataVersion = 0
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getOptions(): PrototypeOptions {
  return options
}

export function setOptions(patch: Partial<PrototypeOptions>) {
  options = { ...options, ...patch }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(options))
  emit()
}

export function appendLog(entry: Omit<LogEntry, 'id' | 'time'>) {
  logSeq += 1
  const time = new Date().toLocaleTimeString([], { hour12: false })
  log = [{ ...entry, id: logSeq, time }, ...log].slice(0, 40)
  emit()
}

export function bumpDataVersion() {
  dataVersion += 1
  log = []
  emit()
}

export function useOptions(): PrototypeOptions {
  return useSyncExternalStore(subscribe, () => options)
}

export function useRequestLog(): LogEntry[] {
  return useSyncExternalStore(subscribe, () => log)
}

/** Changes when persona, scenario, or a data reset should reload every screen. */
export function useDataKey(): string {
  const current = useSyncExternalStore(subscribe, () => options)
  const version = useSyncExternalStore(subscribe, () => dataVersion)
  return `${current.persona}:${current.scenario}:${version}`
}
