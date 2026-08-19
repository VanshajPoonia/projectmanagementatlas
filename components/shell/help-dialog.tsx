'use client'

import { useEffect, useState } from 'react'
import { CircleHelp } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const FEATURE_GROUPS: { title: string; items: string[] }[] = [
  {
    title: 'Boards & tasks',
    items: [
      'Kanban boards with columns, subtasks, and inline edits',
      'Task detail view: assignees, due dates, priority, tags, comments, attachments',
      'Private boards - only members can see them',
      'Admin-managed statuses and an activity log on every task',
    ],
  },
  {
    title: 'Calendar & marketing',
    items: [
      'Shared team calendar built from task due dates',
      'Marketing content calendar: draggable scheduling, recurring posts, posted/missed tracking',
    ],
  },
  {
    title: 'Collaboration',
    items: [
      'Direct team chat with unread badges',
      'Bookmarks for quick links back to boards and tasks',
      'Global search (⌘K) across boards and tasks',
    ],
  },
  {
    title: 'Reporting & AI',
    items: [
      'Reports for a cross-board view of progress',
      'AI assistant that reads your real tasks, boards, and calendar, plus the web and files',
      '"What should I work on next?" suggestions on the home dashboard',
    ],
  },
]

const SHORTCUTS: { keys: string[]; description: string }[] = [
  { keys: ['⌘', 'K'], description: 'Open search / jump to a board or task' },
  { keys: ['?'], description: 'Open this help panel' },
  { keys: ['Esc'], description: 'Close a dialog or cancel an in-progress edit' },
  { keys: ['⌘', 'Enter'], description: 'Save while editing a description field' },
]

export function HelpDialog() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      e.preventDefault()
      setOpen(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      {/* Hidden below `sm`. It is opened with `?`, it lists keyboard shortcuts, and on a
          390px topbar it was the fifth icon squeezing the breadcrumb - the one control here
          that a phone has no use for. Still reachable by keyboard on any device that has one. */}
      <Button
        variant="outline"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label="Help: features and keyboard shortcuts"
        title="Help (press ?)"
        className="hidden sm:inline-flex"
      >
        <CircleHelp className="size-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CircleHelp className="h-4 w-4" /> Help
            </DialogTitle>
            <DialogDescription>What&apos;s in the app, and how to move around it faster.</DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="features">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="features">Features</TabsTrigger>
              <TabsTrigger value="shortcuts">Keyboard shortcuts</TabsTrigger>
            </TabsList>

            <TabsContent value="features" className="space-y-4 pt-3">
              {FEATURE_GROUPS.map(group => (
                <div key={group.title}>
                  <p className="text-sm font-semibold">{group.title}</p>
                  <ul className="mt-1 space-y-1">
                    {group.items.map(item => (
                      <li key={item} className="text-muted-foreground flex gap-2 text-sm">
                        <span aria-hidden="true">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="shortcuts" className="pt-3">
              <ul className="divide-y">
                {SHORTCUTS.map(shortcut => (
                  <li key={shortcut.description} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm">{shortcut.description}</span>
                    <span className="flex flex-shrink-0 items-center gap-1">
                      {shortcut.keys.map(key => (
                        <kbd
                          key={key}
                          className="bg-muted text-muted-foreground rounded border px-1.5 py-0.5 font-mono text-[10px]"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  )
}
