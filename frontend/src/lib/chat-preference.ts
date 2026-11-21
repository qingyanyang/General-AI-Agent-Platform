const AGENT_KEY = 'eap.preferredAgentId'

// Used when localStorage is blocked (private mode, or a test runtime without storage).
let memoryAgentId: string | null = null

function readStored(): string | null {
  try {
    return localStorage.getItem(AGENT_KEY)
  } catch {
    return memoryAgentId
  }
}

function writeStored(agentId: string | null) {
  memoryAgentId = agentId
  try {
    if (agentId === null) {
      localStorage.removeItem(AGENT_KEY)
    } else {
      localStorage.setItem(AGENT_KEY, agentId)
    }
  } catch {
    // The in-memory value still applies for this page.
  }
}

/** Last agent the user opened in chat. Missing means "use the first loaded agent". */
export function readPreferredAgentId(): string | null {
  const value = readStored()
  return value && value.trim() !== '' ? value : null
}

export function writePreferredAgentId(agentId: string) {
  writeStored(agentId)
}

export function clearPreferredAgentId() {
  writeStored(null)
}
