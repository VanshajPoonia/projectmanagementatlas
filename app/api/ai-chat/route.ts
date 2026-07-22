import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { callGemini, GeminiError, type ChatTurn, type ChatAttachment } from '@/lib/ai-chat'

// Tool rounds + Gemini + a web search can take a while; give it room (Hobby allows 60s).
export const maxDuration = 60

const HISTORY_LIMIT = 20
const MAX_MESSAGE_LENGTH = 4000

// Uploads travel as base64 inside the JSON body, and Vercel caps that body at
// ~4.5MB — base64 inflates ~33%, so keep the raw total to ~3MB. Anything larger
// (long videos) should be shared as a YouTube link, which needs no upload.
const MAX_ATTACHMENTS = 4
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 3 * 1024 * 1024
const ALLOWED_MIME = /^(image\/|audio\/|video\/|text\/plain$|application\/pdf$)/

function base64Bytes(data: string): number {
  const len = data.length
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return Math.floor((len * 3) / 4) - padding
}

// Validate + normalise client attachments. Returns an error string if anything is
// off, so we reject the whole request rather than send junk to Gemini.
function parseAttachments(raw: unknown): { attachments: ChatAttachment[] } | { error: string } {
  if (raw == null) return { attachments: [] }
  if (!Array.isArray(raw)) return { error: 'Invalid attachments.' }
  if (raw.length > MAX_ATTACHMENTS) return { error: `Too many files (max ${MAX_ATTACHMENTS}).` }

  const attachments: ChatAttachment[] = []
  let total = 0
  for (const item of raw) {
    const mimeType = typeof item?.mimeType === 'string' ? item.mimeType : ''
    let data = typeof item?.data === 'string' ? item.data : ''
    if (!mimeType || !data) return { error: 'A file is missing its type or data.' }
    if (!ALLOWED_MIME.test(mimeType)) return { error: `Unsupported file type: ${mimeType}.` }
    // Tolerate a data: URL prefix if the client left it on.
    const comma = data.indexOf(',')
    if (data.startsWith('data:') && comma !== -1) data = data.slice(comma + 1)
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data.slice(0, 128))) return { error: 'A file is not valid base64.' }

    const bytes = base64Bytes(data)
    if (bytes > MAX_ATTACHMENT_BYTES) return { error: 'A file is too large (max 3 MB — link a YouTube URL for long videos).' }
    total += bytes
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) return { error: 'Attachments total too large (max 3 MB).' }

    attachments.push({ mimeType, data, name: typeof item?.name === 'string' ? item.name.slice(0, 120) : undefined })
  }
  return { attachments }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Overall hourly cap (all modes).
    if (!checkRateLimit(`ai-chat:${user.id}`, 15, 60 * 60 * 1000)) {
      return NextResponse.json({ error: "You've hit the hourly message limit — try again in a bit." }, { status: 429 })
    }

    const body = await request.json()
    const { message, mode: rawMode, attachments: rawAttachments } = body ?? {}

    const parsed = parseAttachments(rawAttachments)
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const attachments = parsed.attachments

    // A message is required unless the user sent files with no text.
    const hasText = typeof message === 'string' && message.trim().length > 0
    if (!hasText && attachments.length === 0) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }
    const content = hasText ? message.trim().slice(0, MAX_MESSAGE_LENGTH) : '(see attached file)'
    const mode = rawMode === 'web' ? 'web' : 'workspace'

    // Tighter, separate caps on the expensive paths so the shared free quota
    // (Tavily searches, multimodal tokens) can't be drained from one account.
    if (mode === 'web' && !checkRateLimit(`ai-chat-web:${user.id}`, 25, 60 * 60 * 1000)) {
      return NextResponse.json({ error: "You've hit the hourly limit for Ask-anything mode — try again in a bit." }, { status: 429 })
    }
    if (attachments.length > 0 && !checkRateLimit(`ai-chat-media:${user.id}`, 15, 60 * 60 * 1000)) {
      return NextResponse.json({ error: "You've hit the hourly file/attachment limit — try again in a bit." }, { status: 429 })
    }

    const { data: recent } = await supabase
      .from('ai_chat_messages')
      .select('role, content')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT - 1)
    const history = ((recent ?? []) as ChatTurn[]).slice().reverse()

    // Persist just the text (+ a small note if files were attached); we don't store
    // the file bytes, so follow-ups about a file need it re-attached.
    const storedContent = attachments.length > 0 ? `${content}\n\n[${attachments.length} attachment(s)]` : content
    await supabase.from('ai_chat_messages').insert({ user_id: user.id, role: 'user', content: storedContent })

    let reply: string
    try {
      reply = await callGemini([...history, { role: 'user', content }], { supabase, userId: user.id }, { mode, attachments })
    } catch (err) {
      console.error('Gemini call failed:', err)
      const isQuota = err instanceof GeminiError && err.status === 429
      return NextResponse.json(
        {
          error: isQuota
            ? 'The assistant has hit its shared daily limit — try again tomorrow.'
            : 'The assistant is unavailable right now — try again shortly.',
        },
        { status: 502 }
      )
    }

    await supabase.from('ai_chat_messages').insert({ user_id: user.id, role: 'assistant', content: reply })

    return NextResponse.json({ reply })
  } catch (error) {
    console.error('AI chat route error:', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
