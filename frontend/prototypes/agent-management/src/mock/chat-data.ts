/**
 * PROTOTYPE MOCK CHAT DATA.
 * Fictional conversations per persona. Never shipped and never sent to the platform API.
 */
import type { ChatMessage, PendingApproval } from '@/lib/types'

import type { FixtureId } from '../chat/media'
import { INVOICE_REPLY } from '../chat/media'

import { mockUuid } from './data'

export type ToolStep = {
  tool: string
  args: Record<string, number | string>
  result: string
}

export type PendingRun = {
  executionId: string
  approval: PendingApproval
  current: ToolStep
  remaining: ToolStep[]
  finalText: string
}

export type MockSession = {
  id: string
  agent_id: string
  owner: string
  title: string
  messages: ChatMessage[]
  /** Fixture cards restored with a seeded user message. Indexed like `messages`. */
  messageFixtures?: FixtureId[][]
  pending: PendingRun | null
  unavailable?: boolean
}

const ADMIN = 'auth0|mock-admin'
const CHELSEA = 'auth0|mock-chelsea'
const MORGAN = 'auth0|mock-morgan'
const SAM = 'auth0|mock-sam'
const JORDAN = 'auth0|mock-jordan'

const REFUND_REPLY = `**Classification:** Billing · refund request · priority *normal*

| Field | Value |
| --- | --- |
| Customer | Harbour Fitouts |
| Issue | Duplicate March deposit |
| Amount | $4,800.00 |
| Next owner | Accounts receivable |

Draft reply:

Thanks for flagging the duplicate deposit. We’ll reverse the second $4,800 charge and confirm once it posts.`

const SCRIPT_REPLY = '```sql\nUPDATE invoices SET total = line_sum FROM …\n```'

function pendingInvoiceRun(sessionId: string): PendingRun {
  const executionId = mockUuid(7001)
  return {
    executionId,
    approval: {
      execution_id: executionId,
      interrupt_id: `int-${executionId}`,
      checkpoint_id: `chk-${executionId}`,
      tool_call_id: 'call-multiply-1',
      tool_name: 'multiply',
      arguments: { a: 1240, b: 1.1 },
    },
    current: { tool: 'multiply', args: { a: 1240, b: 1.1 }, result: '1364' },
    remaining: [{ tool: 'multiply', args: { a: 1364, b: 2 }, result: '2728' }],
    finalText: `GST-adjusted total then doubled is **2728**. (session ${sessionId.slice(0, 8)})`,
  }
}

const SEEDS: Omit<MockSession, 'id' | 'pending'>[] = [
  {
    agent_id: 'estimator-service-agent',
    owner: ADMIN,
    title: 'Refund request from Harbour Fitouts',
    messages: [
      { role: 'user', content: 'Customer paid the March deposit twice. Classify and draft a reply.' },
      { role: 'assistant', content: REFUND_REPLY },
    ],
  },
  {
    agent_id: 'estimator-service-agent',
    owner: ADMIN,
    title: 'Weekly ticket digest',
    messages: [
      { role: 'user', content: 'Summarize open tickets this week.' },
      { role: 'assistant', content: 'Three billing, one site access, two warranty follow-ups.' },
    ],
  },
  {
    agent_id: 'estimator-agent',
    owner: ADMIN,
    title: 'Travel meal caps',
    messages: [
      { role: 'user', content: 'What is the domestic meal cap?' },
      { role: 'assistant', content: 'Domestic meal cap is $75/day unless pre-approved.' },
    ],
  },
  {
    agent_id: 'estimator-service-agent',
    owner: CHELSEA,
    title: 'Line allocation check',
    messages: [
      { role: 'user', content: 'Add 120 and 80.' },
      { role: 'tool', content: '200' },
      { role: 'assistant', content: 'The lines total **200**.' },
    ],
  },
  {
    agent_id: 'estimator-agent',
    owner: CHELSEA,
    title: 'Expense policy (Finance leader)',
    messages: [
      { role: 'user', content: 'Can Finance approve a laptop over $2k?' },
      { role: 'assistant', content: 'Purchases over $2,000 need Admin approval outside Finance.' },
    ],
  },
  {
    agent_id: 'estimator-agent',
    owner: CHELSEA,
    title: 'Scaffold note (Project A member)',
    messages: [
      { role: 'user', content: 'Log: north scaffold cleared at 07:40' },
      { role: 'assistant', content: 'Noted for Project A: north scaffold cleared at 07:40.' },
    ],
  },
  {
    agent_id: 'estimator-agent',
    owner: MORGAN,
    title: 'Policy wording pass',
    messages: [
      { role: 'user', content: 'Tighten the receipt requirement sentence.' },
      {
        role: 'assistant',
        content: 'Revised: Keep itemized receipts for every expense over $25.',
      },
    ],
  },
  {
    agent_id: 'estimator-service-agent',
    owner: SAM,
    title: 'Deposit split check',
    messages: [
      { role: 'user', content: 'Split a $4,800 deposit across three lines.' },
      { role: 'assistant', content: 'Equal split is **$1,600** per line.' },
    ],
  },
  {
    agent_id: 'estimator-agent',
    owner: JORDAN,
    title: 'Delivery window',
    messages: [
      { role: 'user', content: 'Tiles arrive Thursday AM.' },
      { role: 'assistant', content: 'Logged for Project A: tile delivery Thursday morning.' },
    ],
  },
  {
    agent_id: 'estimator-agent',
    owner: CHELSEA,
    title: 'Shared checklist',
    messages: [
      { role: 'user', content: 'List the shared kickoff checklist.' },
      { role: 'assistant', content: '1. Confirm scope\n2. Assign leads\n3. Set review date' },
    ],
  },
  {
    agent_id: 'estimator-service-agent',
    owner: ADMIN,
    title: 'SQL rebuild totals',
    messages: [
      { role: 'user', content: 'Give me a SQL script to rebuild invoice totals.' },
      { role: 'assistant', content: SCRIPT_REPLY },
    ],
  },
  {
    agent_id: 'estimator-agent',
    owner: ADMIN,
    title: 'Sample invoice image',
    messages: [
      { role: 'user', content: 'What does this sample invoice show?' },
      { role: 'assistant', content: INVOICE_REPLY },
    ],
    messageFixtures: [['invoice']],
  },
]

export function seedSessions(): MockSession[] {
  return SEEDS.map((seed, index) => {
    const id = mockUuid(5001 + index)
    return {
      ...seed,
      id,
      pending: seed.title === 'Line allocation check' ? pendingInvoiceRun(id) : null,
    }
  })
}
