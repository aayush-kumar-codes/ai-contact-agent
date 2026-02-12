'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import ChatArea from '@/components/ChatArea'
import InputArea from '@/components/InputArea'

const INITIAL_MESSAGES = [
  {
    id: '1',
    content: 'Hello! How can I help you today?',
    role: 'assistant' as const,
    timestamp: new Date(Date.now() - 3600000),
  },
  {
    id: '2',
    content: 'I\'d like to learn about machine learning. Can you explain the basics?',
    role: 'user' as const,
    timestamp: new Date(Date.now() - 3500000),
  },
  {
    id: '3',
    content: 'Machine learning is a subset of artificial intelligence that enables systems to learn and improve from experience without being explicitly programmed. Here are the key concepts:\n\n**Supervised Learning**: Training with labeled data where inputs are paired with correct outputs.\n\n**Unsupervised Learning**: Finding patterns in unlabeled data without predefined outputs.\n\n**Deep Learning**: Using neural networks with multiple layers to process complex patterns.\n\nWould you like me to dive deeper into any of these areas?',
    role: 'assistant' as const,
    timestamp: new Date(Date.now() - 3400000),
  },
  {
    id: '4',
    content: 'Can you explain neural networks in more detail?',
    role: 'user' as const,
    timestamp: new Date(Date.now() - 3300000),
  },
  {
    id: '5',
    content: 'Neural networks are inspired by biological neurons in the human brain. They consist of interconnected nodes (artificial neurons) organized in layers:\n\n**Input Layer**: Receives data\n**Hidden Layers**: Process information through weighted connections\n**Output Layer**: Produces predictions\n\nEach connection has a weight that gets adjusted during training through a process called backpropagation. This allows the network to learn patterns from data and make increasingly accurate predictions.',
    role: 'assistant' as const,
    timestamp: new Date(Date.now() - 3200000),
  },
]

export default function Home() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setMessages(INITIAL_MESSAGES)
    setIsMounted(true)
  }, [])

  const handleSendMessage = (text: string) => {
    if (!text.trim()) return

    // Add user message
    const userMessage = {
      id: Date.now().toString(),
      content: text,
      role: 'user' as const,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    // Simulate AI response delay
    setTimeout(() => {
      const responses = [
        'That\'s a great question! Let me think about that...',
        'I understand what you\'re asking. Here\'s what I know about that topic...',
        'That\'s an interesting perspective. I\'d like to add a few thoughts...',
        'Thanks for asking! This is an important concept in the field...',
      ]

      const assistantMessage = {
        id: (Date.now() + 1).toString(),
        content: responses[Math.floor(Math.random() * responses.length)],
        role: 'assistant' as const,
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, assistantMessage])
      setIsLoading(false)
    }, 500)
  }

  if (!isMounted) {
    return (
      <div className="flex h-screen bg-background text-foreground overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <ChatArea messages={messages} isLoading={isLoading} />
        <InputArea input={input} setInput={setInput} onSend={handleSendMessage} isLoading={isLoading} />
      </div>
    </div>
  )
}
