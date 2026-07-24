'use client'

import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface VoiceInputButtonProps {
  /** Called with each finalized chunk of transcribed text (already trimmed). */
  onTranscript: (text: string) => void
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
 */
export function VoiceInputButton({ onTranscript, className, title = 'Dictate' }: VoiceInputButtonProps) {
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null)
    return () => {
      try { recognitionRef.current?.stop() } catch { /* already stopped */ }
    }
  }, [])

  if (!supported) return null

  const toggle = () => {
    if (listening) {
      try { recognitionRef.current?.stop() } catch { /* noop */ }
      setListening(false)
      return
    }
    const Ctor = getRecognitionCtor()
    if (!Ctor) return
    const recognition = new Ctor()
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = 'en-US'
    recognition.onresult = (e: any) => {
      let finalText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript
      }
      const clean = finalText.trim()
      if (clean) onTranscript(clean)
    }
    recognition.onend = () => setListening(false)
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
