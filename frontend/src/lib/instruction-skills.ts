/** Client-side validation mirroring backend Instruction Skills limits (Issue 5). */

export const NAME_MAX_LENGTH = 120
export const DESCRIPTION_MAX_LENGTH = 2_000
export const INSTRUCTIONS_MAX_LENGTH = 20_000
export const MAX_ITEMS = 50
export const AGGREGATE_MAX_LENGTH = 50_000

export type InstructionSkillDraftFields = {
  name: string
  description: string
  instructions: string
}

/** Trim + casefold stand-in for uniqueness checks (matches Python `str.casefold` for ASCII). */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

export function aggregateLength(items: readonly InstructionSkillDraftFields[]): number {
  return items.reduce(
    (total, item) => total + item.name.length + item.description.length + item.instructions.length,
    0,
  )
}

export function validateDraftItems(
  items: readonly InstructionSkillDraftFields[],
): string | null {
  if (items.length > MAX_ITEMS) {
    return `At most ${MAX_ITEMS} instruction skills are allowed.`
  }

  const seen = new Set<string>()
  for (const item of items) {
    const trimmedName = item.name.trim()
    if (!trimmedName) {
      return 'Each instruction skill needs a non-empty name.'
    }
    if (trimmedName.length > NAME_MAX_LENGTH) {
      return `Skill names must be at most ${NAME_MAX_LENGTH} characters.`
    }
    const key = normalizeName(item.name)
    if (seen.has(key)) {
      return 'Instruction skill names must be unique (case-insensitive).'
    }
    seen.add(key)

    if (item.description.trim().length > DESCRIPTION_MAX_LENGTH) {
      return `Descriptions must be at most ${DESCRIPTION_MAX_LENGTH.toLocaleString()} characters.`
    }

    if (!item.instructions || item.instructions.trim() === '') {
      return 'Instructions must contain non-whitespace content.'
    }
    if (item.instructions.length > INSTRUCTIONS_MAX_LENGTH) {
      return `Instructions must be at most ${INSTRUCTIONS_MAX_LENGTH.toLocaleString()} characters.`
    }
  }

  if (aggregateLength(items) > AGGREGATE_MAX_LENGTH) {
    return (
      `Combined name, description, and instructions length must be ` +
      `at most ${AGGREGATE_MAX_LENGTH.toLocaleString()} characters.`
    )
  }

  return null
}

export function moveItem<T>(
  items: readonly T[],
  index: number,
  direction: 'up' | 'down',
): T[] {
  const next = [...items]
  const target = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) {
    return next
  }
  const [removed] = next.splice(index, 1)
  next.splice(target, 0, removed)
  return next
}
