import { createContext, useContext, useState, type ReactNode } from 'react'

import { useChatWorkspace } from '@/components/chat/use-chat-workspace'
import type { ChatClient } from '@/lib/types'

export type ChatStore = ReturnType<typeof useChatWorkspace> & {
  lastChatPath: string
  setLastChatPath: (path: string) => void
}

const ChatContext = createContext<ChatStore | null>(null)

export function ChatProvider({
  client,
  onUnauthorized,
  children,
}: {
  client: ChatClient
  onUnauthorized: () => void
  children: ReactNode
}) {
  const chat = useChatWorkspace(client, onUnauthorized)
  const [lastChatPath, setLastChatPath] = useState('/chat')
  return (
    <ChatContext.Provider value={{ ...chat, lastChatPath, setLastChatPath }}>
      {children}
    </ChatContext.Provider>
  )
}

export function useChat(): ChatStore {
  const value = useContext(ChatContext)
  if (!value) {
    throw new Error('useChat must be used inside ChatProvider')
  }
  return value
}

export function useChatOptional(): ChatStore | null {
  return useContext(ChatContext)
}
