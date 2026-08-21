'use client'

import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { composeDictation, foldSpeechResults } from '@/lib/dictation'

interface VoiceInputButtonProps {
  /** Current text of the field being dictated into. */
  value: string
  /**
   * Called with the field's complete next value, live on every result the engine emits. It is a
   * whole value rather than a chunk to append: an interim result is a guess that gets revised, so
   * the field has to be recomputed each time. See lib/dictation.ts.
   */
  onChange: (next: string) => void
  className?: string
  title?: string
}

// The Web Speech API isn't in the standard DOM typings; keep a minimal local shape.
type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((e: any) => void) | null
  onend: (() => void) | null
  onerror: ((e: any) => void) | null
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null
}

/**
 * Mic button that dictates into a text field via the browser's Web Speech API. Works on
 * Chrome/Edge/Safari (desktop + mobile); on unsupported browsers it renders nothing, so callers
 * can drop it next to any input without a fallback branch. Requested by Bobby (voice-to-text on
 * the task level, "from a PC or mobile device").
 *
 * Words appear as they are spoken. This used to set `interimResults = false` and keep only
 * finalized results, so nothing reached the field until the engine decided a phrase was over -
 * which is seconds of an empty box while you talk, and was reported as the mic "not doing
 * realtime dictation as we talk".
 */
export function VoiceInputButton({ value, onChange, className, title = 'Dictate' }: VoiceInputButtonProps) {
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  // Dictation runs across many events while the component re-renders underneath it. These refs
  // hold the session's own state so a handler registered once still sees current values.
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const baseRef = useRef('')
  const finalRef = useRef('')
  const interimRef = useRef('')

  valueRef.current = value
  onChangeRef.current = onChange

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null)
    return () => {
      try { recognitionRef.current?.stop() } catch { /* already stopped */ }
    }
  }, [])

  if (!supported) return null

  const toggle = () => {
    if (listening) {
      // stop() asks the engine to finalize what it has heard, unlike abort(). onend settles the
      // field either way, so a phrase it never commits is still kept.
      try { recognitionRef.current?.stop() } catch { /* noop */ }
      setListening(false)
      return
    }
    const Ctor = getRecognitionCtor()
    if (!Ctor) return
    const recognition = new Ctor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    // Everything already in the field is the anchor for this session. Text typed by hand while
    // the mic is live is not merged, because a running transcript has no way to know where in
    // the field it went.
    baseRef.current = valueRef.current
    finalRef.current = ''
    interimRef.current = ''

    recognition.onresult = (e: any) => {
      const results = Array.from({ length: e.results?.length ?? 0 }, (_, i) => ({
        isFinal: Boolean(e.results[i]?.isFinal),
        transcript: String(e.results[i]?.[0]?.transcript ?? ''),
      }))
      const { finalText, interimText } = foldSpeechResults(finalRef.current, results, e.resultIndex ?? 0)
      finalRef.current = finalText
      interimRef.current = interimText
      onChangeRef.current(composeDictation(baseRef.current, finalText, interimText))
    }

    recognition.onend = () => {
      setListening(false)
      // Keep any guess the engine never got round to committing: losing a spoken sentence is
      // worse than storing one the user can correct.
      onChangeRef.current(composeDictation(baseRef.current, finalRef.current, interimRef.current))
    }

    recognition.onerror = (e: any) => {
      setListening(false)
      const err = e?.error
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        toast.error('Microphone access denied', { description: 'Allow mic access in your browser to dictate.' })
      } else if (err && err !== 'aborted' && err !== 'no-speech') {
        toast.error('Voice input error', { description: String(err) })
      }
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
    } catch {
      setListening(false)
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={(e) => { e.stopPropagation(); toggle() }}
      className={className}
      aria-label={listening ? 'Stop dictation' : title}
      title={listening ? 'Stop dictation' : title}
      aria-pressed={listening}
    >
      {listening
        ? <MicOff className="h-4 w-4 animate-pulse text-red-500" />
        : <Mic className="h-4 w-4" />}
    </Button>
  )
}
