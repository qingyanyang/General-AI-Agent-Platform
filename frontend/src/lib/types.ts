export type ChatMessage = {
  role: string
  content: string
}

export type Agent = {
  id: string
  name: string
  description: string | null
  status: string
}

export type AgentList = {
  items: Agent[]
  next_cursor: string | null
}

export type ChatSession = {
  id: string
  agent_id: string
  title: string
}

export type ChatSessionList = {
  items: ChatSession[]
  next_cursor: string | null
}

export type PendingApproval = {
  execution_id: string
  interrupt_id: string
  checkpoint_id: string
  tool_call_id: string
  tool_name: string
  arguments: Record<string, unknown>
}

export type StreamEvent =
  | { type: 'message.delta'; execution_id: string; content: string }
  | {
      type: 'tool.start'
      execution_id: string
      tool_call_id: string
      name: string
    }
  | {
      type: 'tool.end'
      execution_id: string
      tool_call_id: string
      name: string
      content: string
    }
  | {
      type: 'approval.required'
      execution_id: string
      interrupt_id: string
      checkpoint_id: string
      tool_call_id: string
      tool_name: string
      arguments: Record<string, unknown>
    }
  | { type: 'done'; execution_id: string; message: ChatMessage }
  | { type: 'error'; execution_id: string; message: string }

export type StreamTerminal =
  | { kind: 'done' }
  | { kind: 'approval' }
  | { kind: 'error' }
  | { kind: 'interrupted' }
  | { kind: 'aborted' }

export type ApprovalDecisionResult =
  | { status: 200; executionId: string; message: ChatMessage }
  | { status: 202; approval: PendingApproval }

export type ApprovalDecisionName = 'approve' | 'reject'

export interface ChatClient {
  listAgents(cursor?: string): Promise<AgentList>
  listSessions(cursor?: string): Promise<ChatSessionList>
  createSession(agentId: string, title?: string): Promise<ChatSession>
  deleteSession(sessionId: string): Promise<void>
  listMessages(sessionId: string): Promise<ChatMessage[]>
  listApprovals(sessionId: string): Promise<PendingApproval[]>
  streamMessage(
    sessionId: string,
    content: string,
    signal: AbortSignal,
    onEvent: (event: StreamEvent) => void,
  ): Promise<StreamTerminal>
  decideApproval(
    sessionId: string,
    interruptId: string,
    decision: ApprovalDecisionName,
    toolCallId: string,
  ): Promise<ApprovalDecisionResult>
}
