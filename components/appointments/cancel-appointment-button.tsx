'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CheckCircle2, Loader2 } from 'lucide-react'

export default function CancelAppointmentButton({ token }: { token: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  const handleCancel = async () => {
    setState('busy')
    setError(null)
    try {
      const res = await fetch(`/api/book/cancel/${token}`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || 'Could not cancel this appointment.')
        setState('idle')
        return
      }
      setState('done')
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
      setState('idle')
    }
  }

  if (state === 'done') {
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
        <p className="text-sm font-medium">This appointment has been cancelled.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Button variant="destructive" className="w-full" onClick={handleCancel} disabled={state === 'busy'}>
        {state === 'busy' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Cancel this appointment'}
      </Button>
      {error && (
        <p role="alert" className="text-center text-sm text-destructive">{error}</p>
      )}
    </div>
  )
}
