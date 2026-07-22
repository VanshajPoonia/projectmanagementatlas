'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Bot, X, Send, Trash2, Loader2, Paperclip, Globe, FolderKanban } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface Attachment {
  name: string
  mimeType: string
  data: string // base64, no data: prefix
  size: number
}

type ChatMode = 'workspace' | 'web'

interface AiChatWidgetProps {
  userId: string
}

const MODE_KEY = 'ai_chat_mode'
const MAX_FILES = 4
const MAX_BYTES = 3 * 1024 * 1024
const ALLOWED_MIME = /^(image\/|audio\/|video\/|text\/plain$|application\/pdf$)/

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const res = reader.result as string
      const comma = res.indexOf(',')
      resolve(comma === -1 ? res : res.slice(comma + 1))
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function AiChatWidget({ userId }: AiChatWidgetProps) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [mode, setMode] = useState<ChatMode>('workspace')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const supabase = createClient()
  const endRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const loadedRef = useRef(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODE_KEY)
      if (saved === 'web' || saved === 'workspace') setMode(saved)
    } catch { /* ignore */ }
  }, [])

  const changeMode = (next: ChatMode) => {
    setMode(next)
    try { localStorage.setItem(MODE_KEY, next) } catch { /* ignore */ }
  }

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

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const picked = Array.from(files)
    if (attachments.length + picked.length > MAX_FILES) {
      toast.error(`Up to ${MAX_FILES} files at a time.`)
      return
    }
    let total = attachments.reduce((s, a) => s + a.size, 0)
    const next = [...attachments]
    for (const f of picked) {
      if (!ALLOWED_MIME.test(f.type || '')) {
        toast.error(`${f.name}: unsupported type. Images, PDF, audio, video or text only.`)
        continue
      }
      if (f.size > MAX_BYTES) {
        toast.error(`${f.name} is over 3 MB — paste a YouTube link for long videos.`)
        continue
      }
      total += f.size
      if (total > MAX_BYTES) {
        toast.error('Attachments total over 3 MB.')
        break
      }
      try {
        const data = await readAsBase64(f)
        next.push({ name: f.name, mimeType: f.type, data, size: f.size })
      } catch {
        toast.error(`Could not read ${f.name}.`)
      }
    }
    setAttachments(next)
    if (fileRef.current) fileRef.current.value = ''
  }

  const removeAttachment = (i: number) => setAttachments((prev) => prev.filter((_, idx) => idx !== i))

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if ((!text && attachments.length === 0) || sending) return

    const sentAttachments = attachments
    const noteSuffix = sentAttachments.length > 0 ? `\n\n📎 ${sentAttachments.map((a) => a.name).join(', ')}` : ''

    setInput('')
    setAttachments([])
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: 'user', content: (text || '(file)') + noteSuffix }])
    setSending(true)

    try {
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          mode,
          attachments: sentAttachments.map(({ name, mimeType, data }) => ({ name, mimeType, data })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to reach the assistant')
      setMessages((prev) => [...prev, { id: `local-${Date.now()}-r`, role: 'assistant', content: data.reply }])
    } catch (err: any) {
      toast.error(err.message || 'The assistant is unavailable right now.')
      setMessages((prev) => prev.slice(0, -1))
      setInput(text)
      setAttachments(sentAttachments)
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
                <p className="text-xs text-muted-foreground leading-tight">
                  {mode === 'web' ? 'Web + general questions' : 'Your tasks, boards & calendar'}
                </p>
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

          {/* Mode toggle */}
          <div className="flex items-center gap-1 border-b p-2">
            {([
              { id: 'workspace' as ChatMode, label: 'Workspace', Icon: FolderKanban },
              { id: 'web' as ChatMode, label: 'Ask anything', Icon: Globe },
            ]).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => changeMode(id)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                  mode === id ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent'
                )}
                title={id === 'web' ? 'General questions with live web search' : 'Answers grounded in your tasks, boards and calendar'}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            {loadingHistory && (
              <div className="flex justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loadingHistory && messages.length === 0 && (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                {mode === 'web'
                  ? 'Ask me anything — I can search the web, read a link, or look at a file or YouTube video you share.'
                  : "Ask about your work — what's due this week, what's on a board, or your marketing calendar."}
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

          {/* Selected attachments */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-t px-3 pt-2">
              {attachments.map((a, i) => (
                <span key={i} className="flex max-w-[12rem] items-center gap-1 rounded border bg-muted px-1.5 py-0.5 text-xs">
                  <Paperclip className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{a.name}</span>
                  <button type="button" onClick={() => removeAttachment(i)} aria-label={`Remove ${a.name}`} className="text-muted-foreground hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <form onSubmit={handleSend} className="flex items-end gap-2 border-t p-3">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,application/pdf,audio/*,video/*,text/plain"
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="flex-shrink-0"
              onClick={() => fileRef.current?.click()}
              disabled={sending}
              aria-label="Attach a file"
              title="Attach an image, PDF, audio or video"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={mode === 'web' ? 'Ask anything, paste a link…' : 'Ask about your work…'}
              rows={1}
              className="max-h-24 min-h-9 flex-1 resize-none py-2"
              disabled={sending}
            />
            <Button type="submit" size="icon" disabled={sending || (!input.trim() && attachments.length === 0)}>
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
