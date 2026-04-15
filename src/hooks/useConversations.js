import { useState, useCallback } from 'react'
import { MOCK_CONVERSATIONS } from '../utils/mockData.js'
import { generateId } from '../utils/helpers.js'

/**
 * Manages the conversations list for the admin dashboard.
 * In production, replace the initial state + mutations with API calls.
 */
export function useConversations() {
  const [conversations, setConversations] = useState(MOCK_CONVERSATIONS)
  const [selected, setSelected] = useState(MOCK_CONVERSATIONS[0] || null)

  const selectConversation = useCallback((id) => {
    const conv = conversations.find((c) => c.id === id)
    if (conv) setSelected(conv)
  }, [conversations])

  const markResolved = useCallback((id) => {
    setConversations((prev) =>
      prev.map((c) => c.id === id ? { ...c, status: 'resolved' } : c)
    )
    setSelected((prev) =>
      prev?.id === id ? { ...prev, status: 'resolved' } : prev
    )
  }, [])

  const addEscalationNote = useCallback((convId, note) => {
    const msg = {
      id: generateId(),
      role: 'escalation',
      content: note,
      ts: new Date(),
    }
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? { ...c, escalated: true, status: 'escalated', messages: [...c.messages, msg], lastMessage: new Date() }
          : c
      )
    )
    setSelected((prev) =>
      prev?.id === convId
        ? { ...prev, escalated: true, status: 'escalated', messages: [...prev.messages, msg] }
        : prev
    )
  }, [])

  return { conversations, selected, selectConversation, markResolved, addEscalationNote }
}
