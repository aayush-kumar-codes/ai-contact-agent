'use client'

import { useEffect, useRef } from 'react'
import { MessageSquare } from 'lucide-react'
import MessageBubble from './MessageBubble'

interface Message {
  id: string
  content: string
  role: 'user' | 'assistant'
  timestamp: Date
}

interface ChatAreaProps {
  messages: Message[]
  isLoading: boolean
}

export default function ChatArea({ messages, isLoading }: ChatAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isLoading])

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto px-6 py-12 space-y-6" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full pt-32">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-secondary rounded-full mx-auto flex items-center justify-center">
                <MessageSquare size={32} className="text-foreground" />
              </div>
              <div>
                <h1 className="text-3xl font-semibold text-foreground mb-2">How can I help?</h1>
                <p className="text-muted-foreground text-sm">Start a conversation or ask any question</p>
              </div>
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex gap-2 py-3 px-4">
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
