/**
 * Instruction-skills edit eligibility from probing GET /agents/{id}/instruction-skills.
 *
 * Mapping:
 * - 200 → `eligible` (caller may load/edit the published collection)
 * - 403 → `forbidden` (signed in, but not allowed to edit; stay on page)
 * - network failure or 5xx → `error`
 *
 * `unknown` / `loading` are UI states before and during the probe.
 */
export type InstructionEligibility =
  | 'unknown'
  | 'loading'
  | 'eligible'
  | 'forbidden'
  | 'error'
