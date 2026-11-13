export const EXECUTION_STATUSES = [
  'running',
  'awaiting_approval',
  'succeeded',
  'failed',
  'cancelled',
] as const

export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number]

export function isExecutionStatus(value: string): value is ExecutionStatus {
  return (EXECUTION_STATUSES as readonly string[]).includes(value)
}

export function executionStatusLabel(status: ExecutionStatus): string {
  switch (status) {
    case 'running':
      return 'Running'
    case 'awaiting_approval':
      return 'Awaiting approval'
    case 'succeeded':
      return 'Succeeded'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}

export function displayExecutionStatus(status: string): string {
  if (!isExecutionStatus(status)) {
    return status
  }
  return executionStatusLabel(status)
}

export function isOpenExecution(status: string): boolean {
  return status === 'running' || status === 'awaiting_approval'
}
