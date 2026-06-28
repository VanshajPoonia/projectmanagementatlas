'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowRight, LayoutDashboard } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'

export default function HomePage() {
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (contentRef.current) {
      gsap.fromTo(
        contentRef.current,
        { y: 20, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.6, ease: 'power3.out' }
      )
    }
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div ref={contentRef} className="flex flex-col items-center text-center gap-6 max-w-sm">
        <div className="w-14 h-14 bg-primary rounded-xl flex items-center justify-center">
          <LayoutDashboard className="w-7 h-7 text-primary-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Project Manager</h1>
          <p className="text-muted-foreground">Sign in to manage your team's tasks and boards.</p>
        </div>
        <Link href="/login">
          <Button size="lg" className="gap-2">
            Sign In
            <ArrowRight className="w-4 h-4" />
          </Button>
        </Link>
      </div>
    </div>
  )
}
