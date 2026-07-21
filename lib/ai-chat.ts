// Gemini free tier: this key is shared across every user of the app, and the
// daily request cap is shared too (not per-user). We don't pre-track that quota
// ourselves — Gemini's own 429 is the source of truth; see the 429 handling in
// app/api/ai-chat/route.ts, which turns it into a friendly "try again" message.
//
// Model naming: Google regularly sunsets older model versions for new API keys
// (2.5-flash-lite already 404s as of mid-2026). If this model starts 404ing,
// check `GET /v1beta/models?key=...` for the current lineup before guessing.
export const AI_CHAT_MODEL = 'gemini-3.1-flash-lite'

export const AI_CHAT_SYSTEM_PROMPT = `You are the built-in assistant for "Project Manager," an internal project management web app. It has: Kanban-style task boards with customizable columns/statuses, a shared team calendar, a marketing content calendar (channels, companies, recurring events), private personal tasks, direct chat between teammates, bookmarks, and reports.

You do not have access to the current user's specific tasks, boards, or company data. If asked about their specific data, say you can't see that yet and point them to the relevant tab (Boards, Calendar, Marketing, Reports) instead of guessing. Otherwise, help with general questions, how to use the app, and everyday assistant tasks. Keep answers concise.`

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export class GeminiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function callGemini(history: ChatTurn[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new GeminiError('GEMINI_API_KEY is not configured', 500)
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${AI_CHAT_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: AI_CHAT_SYSTEM_PROMPT }] },
        contents: history.map((turn) => ({
          role: turn.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: turn.content }],
        })),
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
        },
      }),
    }
  )

  if (!res.ok) {
    throw new GeminiError(`Gemini request failed (${res.status})`, res.status)
  }

  const data = await res.json()
  const parts = data?.candidates?.[0]?.content?.parts ?? []
  // Skip any `thought: true` parts — thinking models can return an internal
  // reasoning trace alongside (or instead of, part-by-part) the real answer.
  const text = parts
    .filter((part: any) => !part.thought && typeof part.text === 'string')
    .map((part: any) => part.text)
    .join('')
    .trim()

  if (!text) {
    throw new GeminiError('Gemini returned no text', 502)
  }

  return text
}
