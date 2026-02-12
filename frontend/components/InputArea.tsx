'use client'

import { Send } from 'lucide-react'
import { useRef, useEffect } from 'react'

interface InputAreaProps {
  input: string
  setInput: (value: string) => void
  onSend: (message: string) => void
  isLoading: boolean
}

export default function InputArea({ input, setInput, onSend, isLoading }: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [input])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend(input)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSend(input)
  }

  return (
    <div className="border-t border-border bg-background p-6">
      <div className="max-w-3xl mx-auto">
        <form onSubmit={handleSubmit} className="relative">
          <div className="flex gap-3 items-end">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask me anything..."
                disabled={isLoading}
                className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-foreground focus:ring-1 focus:ring-foreground transition-colors resize-none max-h-48 disabled:opacity-50 disabled:cursor-not-allowed"
                rows={1}
              />
            </div>
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="flex items-center justify-center w-9 h-9 bg-foreground text-background rounded-md hover:bg-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Send message"
            >
              <Send size={18} />
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
