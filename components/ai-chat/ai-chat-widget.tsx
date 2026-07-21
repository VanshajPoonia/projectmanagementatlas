'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Bot, X, Send, Trash2, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface AiChatWidgetProps {
  userId: string
}

export default function AiChatWidget({ userId }: AiChatWidgetProps) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const supabase = createClient()
  const endRef = useRef<HTMLDivElement>(null)
  const loadedRef = useRef(false)

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    const { data } = await supabase
      .from('ai_chat_messages')
      .select('id, role, content')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(50)
    if (data) setMessages(data as AiMessage[])
    setLoadingHistory(false)
  }, [supabase, userId])

  useEffect(() => {
    if (open && !loadedRef.current) {
      loadedRef.current = true
      loadHistory()
    }
  }, [open, loadHistory])

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open, sending])

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || sending) return

    setInput('')
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: 'user', content: text }])
    setSending(true)

    try {
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to reach the assistant')
      setMessages((prev) => [...prev, { id: `local-${Date.now()}-r`, role: 'assistant', content: data.reply }])
    } catch (err: any) {
      toast.error(err.message || 'The assistant is unavailable right now.')
      setMessages((prev) => prev.slice(0, -1))
      setInput(text)
    } finally {
      setSending(false)
    }
  }

  const handleClear = async () => {
    await supabase.from('ai_chat_messages').delete().eq('user_id', userId)
    setMessages([])
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend(e as unknown as React.FormEvent)
    }
  }

  return (
    <>
      {open && (
        <div className="fixed bottom-36 right-4 z-50 flex h-[32rem] max-h-[70vh] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl md:bottom-20 sm:w-96">
          <div className="flex items-center justify-between border-b p-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <Bot className="h-4 w-4 text-primary-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold leading-tight">Assistant</p>
                <p className="text-xs text-muted-foreground leading-tight">General help & questions</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleClear}
                aria-label="Clear conversation"
                title="Clear conversation"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setOpen(false)}
                aria-label="Close assistant"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            {loadingHistory && (
              <div className="flex justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loadingHistory && messages.length === 0 && (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                Ask me anything — I can help you use the app or answer general questions.
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm',
                    m.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-secondary-foreground'
                  )}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-secondary px-3 py-2 text-sm text-secondary-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={handleSend} className="flex items-end gap-2 border-t p-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              rows={1}
              className="max-h-24 min-h-9 flex-1 resize-none py-2"
              disabled={sending}
            />
            <Button type="submit" size="icon" disabled={sending || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      )}

      <Button
        onClick={() => setOpen((v) => !v)}
        size="icon"
        className="fixed bottom-20 right-4 z-50 h-12 w-12 rounded-full shadow-lg md:bottom-4"
        aria-label={open ? 'Close assistant' : 'Open assistant'}
      >
        {open ? <X className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
      </Button>
    </>
  )
}
