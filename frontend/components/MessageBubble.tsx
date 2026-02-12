'use client'

import { Copy, Check } from 'lucide-react'
import { useState } from 'react'

interface Message {
  id: string
  content: string
  role: 'user' | 'assistant'
  timestamp: Date
}

interface MessageBubbleProps {
  message: Message
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isUser = message.role === 'user'

  // Simple markdown-like formatting
  const formatContent = (text: string) => {
    return text.split('\n').map((line, idx) => {
      // Handle bold text
      const parts = line.split(/(\*\*.*?\*\*)/g)
      return (
        <div key={idx} className="mb-2 last:mb-0">
          {parts.map((part, i) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              return (
                <span key={i} className="font-semibold">
                  {part.slice(2, -2)}
                </span>
              )
            }
            return <span key={i}>{part}</span>
          })}
        </div>
      )
    })
  }

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`px-4 py-3 max-w-2xl group ${
          isUser
            ? 'bg-foreground text-background rounded-md'
            : 'bg-transparent text-foreground'
        }`}
      >
        <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
          {formatContent(message.content)}
        </div>

        {!isUser && (
          <button
            onClick={handleCopy}
            className="opacity-0 group-hover:opacity-100 transition-opacity mt-2 p-1 rounded text-muted-foreground hover:text-foreground"
            title="Copy message"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        )}
      </div>
    </div>
  )
}
