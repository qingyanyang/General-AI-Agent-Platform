import type { InstructionSkillItem } from '@/lib/management'

export type CachedEligibility =
  | { status: 'eligible'; items: InstructionSkillItem[] }
  | { status: 'forbidden' }

const eligibilityCache = new Map<string, CachedEligibility>()

export function readInstructionEligibility(agentId: string): CachedEligibility | null {
  return eligibilityCache.get(agentId) ?? null
}

export function writeInstructionEligibility(agentId: string, value: CachedEligibility) {
  eligibilityCache.set(agentId, value)
}

export function clearInstructionEligibility(agentId?: string) {
  if (agentId) {
    eligibilityCache.delete(agentId)
    return
  }
  eligibilityCache.clear()
}
