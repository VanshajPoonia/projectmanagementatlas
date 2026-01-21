'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowRight, CheckCircle, Users, Kanban, MessageSquare, Bell } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'

export default function HomePage() {
  const headerRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)
  const featureRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    // Header animation
    if (headerRef.current) {
      gsap.fromTo(
        headerRef.current,
        { y: -100, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.8, ease: 'power3.out' }
      )
    }

    // Hero section animation
    if (heroRef.current) {
      gsap.fromTo(
        heroRef.current.children,
        { y: 50, opacity: 0 },
        { 
          y: 0, 
          opacity: 1, 
          duration: 1, 
          stagger: 0.2,
          ease: 'power3.out',
          delay: 0.3
        }
      )
    }

    // Feature cards animation
    featureRefs.current.forEach((card, index) => {
      if (card) {
        gsap.fromTo(
          card,
          { y: 60, opacity: 0, scale: 0.9 },
          { 
            y: 0, 
            opacity: 1, 
            scale: 1,
            duration: 0.6, 
            delay: 0.8 + (index * 0.1),
            ease: 'back.out(1.4)'
          }
        )
      }
    })
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {/* Header */}
      <header ref={headerRef} className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg flex items-center justify-center">
              <Kanban className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">TaskFlow</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login">
              <Button variant="ghost">Sign In</Button>
            </Link>
            <Link href="/signup">
              <Button>Get Started</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20 text-center">
        <div ref={heroRef} className="max-w-3xl mx-auto space-y-6">
          <h2 className="text-5xl font-bold tracking-tight text-balance">
            Project Management Made Simple
          </h2>
          <p className="text-xl text-muted-foreground text-balance">
            Streamline your team's workflow with intuitive task management, real-time collaboration, and instant notifications
          </p>
          <div className="flex items-center justify-center gap-4 pt-4">
            <Link href="/signup">
              <Button size="lg" className="gap-2">
                Start Free Trial
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline">
                Sign In
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h3 className="text-3xl font-bold tracking-tight mb-3">Everything you need to manage projects</h3>
          <p className="text-muted-foreground">Powerful features to keep your team organized and productive</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 max-w-6xl mx-auto">
          <Card ref={el => featureRefs.current[0] = el} className="hover:shadow-lg transition-all hover:scale-105 cursor-pointer">
            <CardHeader>
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center mb-4">
                <Kanban className="w-6 h-6 text-white" />
              </div>
              <CardTitle>Kanban Boards</CardTitle>
              <CardDescription>
                Visualize your workflow with drag-and-drop task boards inspired by Trello
              </CardDescription>
            </CardHeader>
          </Card>

          <Card ref={el => featureRefs.current[1] = el} className="hover:shadow-lg transition-all hover:scale-105 cursor-pointer">
            <CardHeader>
              <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-green-600 rounded-lg flex items-center justify-center mb-4">
                <Users className="w-6 h-6 text-white" />
              </div>
              <CardTitle>Team Management</CardTitle>
              <CardDescription>
                Assign tasks to team members and track progress in real-time
              </CardDescription>
            </CardHeader>
          </Card>

          <Card ref={el => featureRefs.current[2] = el} className="hover:shadow-lg transition-all hover:scale-105 cursor-pointer">
            <CardHeader>
              <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg flex items-center justify-center mb-4">
                <MessageSquare className="w-6 h-6 text-white" />
              </div>
              <CardTitle>Real-time Chat</CardTitle>
              <CardDescription>
                Communicate with your team instantly with built-in chat and file sharing
              </CardDescription>
            </CardHeader>
          </Card>

          <Card ref={el => featureRefs.current[3] = el} className="hover:shadow-lg transition-all hover:scale-105 cursor-pointer">
            <CardHeader>
              <div className="w-12 h-12 bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-lg flex items-center justify-center mb-4">
                <Bell className="w-6 h-6 text-white" />
              </div>
              <CardTitle>Email Notifications</CardTitle>
              <CardDescription>
                Get notified instantly when tasks are assigned or updated
              </CardDescription>
            </CardHeader>
          </Card>

          <Card ref={el => featureRefs.current[4] = el} className="hover:shadow-lg transition-all hover:scale-105 cursor-pointer">
            <CardHeader>
              <div className="w-12 h-12 bg-gradient-to-br from-red-500 to-red-600 rounded-lg flex items-center justify-center mb-4">
                <CheckCircle className="w-6 h-6 text-white" />
              </div>
              <CardTitle>Admin Controls</CardTitle>
              <CardDescription>
                Powerful admin dashboard to manage users, boards, and permissions
              </CardDescription>
            </CardHeader>
          </Card>

          <Card ref={el => featureRefs.current[5] = el} className="hover:shadow-lg transition-all hover:scale-105 cursor-pointer">
            <CardHeader>
              <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg flex items-center justify-center mb-4">
                <Users className="w-6 h-6 text-white" />
              </div>
              <CardTitle>Access Control</CardTitle>
              <CardDescription>
                Restrict access to authorized emails only for enhanced security
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-20">
        <Card className="bg-gradient-to-br from-blue-600 to-blue-700 text-white border-none max-w-4xl mx-auto">
          <CardContent className="p-12 text-center space-y-6">
            <h3 className="text-3xl font-bold">Ready to get started?</h3>
            <p className="text-blue-100 text-lg">
              Join your team today and start managing projects more effectively
            </p>
            <Link href="/signup">
              <Button size="lg" variant="secondary" className="gap-2">
                Create Your Account
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </section>

      {/* Footer */}
      <footer className="border-t bg-white/50 backdrop-blur-sm py-8">
        <div className="container mx-auto px-4 text-center text-muted-foreground">
          <p>&copy; 2024 TaskFlow. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
