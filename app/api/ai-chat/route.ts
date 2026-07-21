import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { callGemini, GeminiError, type ChatTurn } from '@/lib/ai-chat'

const HISTORY_LIMIT = 20
const MAX_MESSAGE_LENGTH = 4000

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!checkRateLimit(`ai-chat:${user.id}`, 15, 60 * 60 * 1000)) {
      return NextResponse.json({ error: "You've hit the hourly message limit — try again in a bit." }, { status: 429 })
    }

    const { message } = await request.json()
    if (typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }
    const content = message.trim().slice(0, MAX_MESSAGE_LENGTH)

    const { data: recent } = await supabase
      .from('ai_chat_messages')
      .select('role, content')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT - 1)
    const history = ((recent ?? []) as ChatTurn[]).slice().reverse()

    await supabase.from('ai_chat_messages').insert({ user_id: user.id, role: 'user', content })

    let reply: string
    try {
      reply = await callGemini([...history, { role: 'user', content }], { supabase, userId: user.id })
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
