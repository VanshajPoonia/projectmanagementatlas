import React from "react"
import type { Metadata } from 'next'
import { Inter, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { Toaster } from 'sonner'
import { ThemeProvider } from '@/components/theme-provider'
import { AccentBoot } from '@/components/theme/accent-boot'
import './globals.css'

const _inter = Inter({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'Project Manager',
  description: 'Internal project management dashboard for task boards, collaboration, and team communication.',
  icons: {
    icon: '/favicon.ico',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`font-sans antialiased`}>
        {/* enableSystem was off, which left "follow my OS" unreachable and pinned everyone to
            light on first load. ThemeControls offers the three modes next-themes supports, so
            the provider has to actually resolve System; defaultTheme stays light so nothing
            changes for an existing user who has never opened the picker. */}
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          {/* Wraps everything, including the Toaster, because the accent is written to
              document.documentElement - portaled overlays are outside the app tree but still
              inherit from :root. */}
          <AccentBoot>
            {children}
            <footer className="py-3 text-center text-xs text-muted-foreground">
              Powered by{' '}
              <a
                href="https://kreativvantage.com"
                target="_blank"
                rel="noreferrer"
                className="font-medium underline-offset-2 hover:underline"
              >
                Kreativ Vantage
              </a>
            </footer>
            <Toaster richColors position="top-right" />
          </AccentBoot>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  )
}
