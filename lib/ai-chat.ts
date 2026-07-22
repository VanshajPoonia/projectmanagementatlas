import { AI_CHAT_TOOLS, executeTool, toolsForMode, type ToolContext, type ChatMode } from './ai-chat-tools'

// Gemini free tier: this key is shared across every user of the app, and the
// daily request cap is shared too (not per-user). We don't pre-track that quota
// ourselves — Gemini's own 429 is the source of truth; see the 429 handling in
// app/api/ai-chat/route.ts, which turns it into a friendly "try again" message.
//
// Model naming: Google regularly sunsets older model versions for new API keys
// (2.5-flash-lite already 404s as of mid-2026). If a model starts 404ing, check
// `GET /v1beta/models?key=...` for the current lineup before guessing. Both names
// are env-overridable (GEMINI_MODEL / GEMINI_MULTIMODAL_MODEL) so a rename can be
// fixed without a deploy, and callGemini falls back automatically on a 404.
export const AI_CHAT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'
// Used only when a turn carries files/images/video — flash-lite is cheap for text
// but the fuller flash model is the reliable multimodal path.
export const AI_CHAT_MULTIMODAL_MODEL = process.env.GEMINI_MULTIMODAL_MODEL || 'gemini-3.1-flash'
const MULTIMODAL_FALLBACK = 'gemini-2.5-flash'

export const AI_CHAT_SYSTEM_PROMPT = `You are the built-in assistant for "Project Manager," an internal project management web app. It has: Kanban-style task boards with customizable columns/statuses, a shared team calendar (task due dates), a marketing content calendar (channels, companies, recurring events), private personal tasks, direct chat between teammates, bookmarks, and reports.

You have tools to look up the current user's real data: get_tasks (Kanban tasks across boards), get_boards, get_personal_tasks (their private to-do list), and get_marketing_calendar. Use them whenever a question is about actual tasks, due dates, boards, or the marketing calendar — don't guess or make up data. If a tool comes back empty or with an error, say so plainly rather than inventing an answer. For anything else, help with general questions and how to use the app. Keep answers concise.`

export const AI_CHAT_SYSTEM_PROMPT_WEB = `You are a helpful general-purpose assistant embedded in the "Project Manager" web app, currently in "Ask anything" mode. Answer questions on any topic, not just this app.

You can use web_search to look things up on the public internet and fetch_url to read a specific page the user links. Prefer searching whenever the answer depends on current events, real-world facts, prices, or anything you're unsure about, rather than guessing — and cite the source links you used. If the user attaches files or images, or links a YouTube video, read/analyse them directly. Keep answers concise and well-structured.`

const ATTACHMENT_NOTE = `\n\nThe user may attach images, PDFs, audio, or link a video — these arrive as input parts; read them directly and refer to what they actually contain.`

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

// A file the user attached to the current turn: base64 payload + its mime type.
export interface ChatAttachment {
  mimeType: string
  data: string
  name?: string
}

export class GeminiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const MAX_TOOL_ROUNDS = 5

// Detect YouTube links so Gemini can "watch" them via a fileData part (no upload).
const YOUTUBE_RE =
  /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=[\w-]+|shorts\/[\w-]+)|youtu\.be\/[\w-]+)/gi

function extractYouTubeUrls(text: string): string[] {
  return Array.from(new Set(text.match(YOUTUBE_RE) ?? []))
}

// Gemini's function-calling contract (verified against the live API, not just
// docs): a functionCall part can carry a `thoughtSignature` sibling field, and
// omitting it on the follow-up request is a hard 400 ("missing thought_signature"),
// not a silent degradation — so we always echo the model's turn back verbatim
// (parts, ids, signatures and all) rather than reconstructing it. Multiple
// functionCall parts can arrive in one turn (parallel calls); their responses
// all go back together in a single `role: 'function'` turn.
export async function callGemini(
  history: ChatTurn[],
  toolContext: ToolContext,
  opts: { mode?: ChatMode; attachments?: ChatAttachment[] } = {}
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new GeminiError('GEMINI_API_KEY is not configured', 500)
  }

  const mode: ChatMode = opts.mode === 'web' ? 'web' : 'workspace'
  const attachments = opts.attachments ?? []

  const contents: any[] = history.map((turn) => ({
    role: turn.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: turn.content }],
  }))

  // Attach any files + linked YouTube videos to the current (last) user turn.
  const lastUserText = history.length > 0 ? history[history.length - 1].content : ''
  const youtubeUris = extractYouTubeUrls(lastUserText)
  const hasMedia = attachments.length > 0 || youtubeUris.length > 0
  if (hasMedia && contents.length > 0) {
    const last = contents[contents.length - 1]
    for (const a of attachments) {
      last.parts.push({ inlineData: { mimeType: a.mimeType, data: a.data } })
    }
    for (const uri of youtubeUris) {
      last.parts.push({ fileData: { fileUri: uri } })
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const basePrompt = mode === 'web' ? AI_CHAT_SYSTEM_PROMPT_WEB : AI_CHAT_SYSTEM_PROMPT
  const systemInstruction = {
    parts: [{ text: `${basePrompt}${ATTACHMENT_NOTE}\n\nToday's date is ${today}.` }],
  }

  const tools = [{ functionDeclarations: toolsForMode(mode) }]

  // Media needs the multimodal model; plain text stays on the cheaper one. On a
  // 404 (model renamed/sunset) fall back once rather than failing the whole chat.
  let model = hasMedia ? AI_CHAT_MULTIMODAL_MODEL : AI_CHAT_MODEL
  let fallbackTried = false

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction,
          contents,
          tools,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1024,
          },
        }),
      }
    )

    if (!res.ok) {
      if (res.status === 404 && hasMedia && !fallbackTried) {
        fallbackTried = true
        model = MULTIMODAL_FALLBACK
        round--
        continue
      }
      throw new GeminiError(`Gemini request failed (${res.status})`, res.status)
    }

    const data = await res.json()
    const parts = data?.candidates?.[0]?.content?.parts ?? []
    const functionCalls = parts.filter((part: any) => part.functionCall)

    if (functionCalls.length === 0) {
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

    contents.push({ role: 'model', parts })

    const responseParts = await Promise.all(
      functionCalls.map(async (part: any) => {
        const result = await executeTool(part.functionCall.name, part.functionCall.args ?? {}, toolContext)
        return {
          functionResponse: {
            name: part.functionCall.name,
            ...(part.functionCall.id ? { id: part.functionCall.id } : {}),
            response: result,
          },
        }
      })
    )
    contents.push({ role: 'function', parts: responseParts })
  }

  throw new GeminiError('Gemini did not produce a final answer in time', 502)
}

// Re-exported so callers that only import from this module keep working.
export { AI_CHAT_TOOLS }
