'use client'

import { useState } from 'react'
import { MoreHorizontal, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'

export interface NavItem {
  value: string
  label: string
  icon: LucideIcon
  badge?: React.ReactNode
}

interface MobileBottomNavProps {
  items: NavItem[]
  moreItems?: NavItem[]
  activeTab: string
  onChange: (value: string) => void
}

export default function MobileBottomNav({ items, moreItems = [], activeTab, onChange }: MobileBottomNavProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const isMoreActive = moreItems.some((item) => item.value === activeTab)

  const renderButton = (item: NavItem, isActive: boolean, onClick: () => void) => {
    const Icon = item.icon
    return (
      <button
        key={item.value}
        onClick={onClick}
        className={cn(
          'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs font-medium transition-colors',
          isActive ? 'text-primary' : 'text-muted-foreground'
        )}
      >
        <span className="relative">
          <Icon className="w-5 h-5" />
          {item.badge}
        </span>
        <span className="leading-none">{item.label}</span>
      </button>
    )
  }

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch border-t bg-background/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]"
        aria-label="Primary"
      >
        {items.map((item) =>
          renderButton(item, activeTab === item.value, () => onChange(item.value))
        )}
        {moreItems.length > 0 &&
          renderButton(
            { value: '__more__', label: 'More', icon: MoreHorizontal },
            isMoreActive,
            () => setMoreOpen(true)
          )}
      </nav>

      {moreItems.length > 0 && (
        <Drawer open={moreOpen} onOpenChange={setMoreOpen}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>More</DrawerTitle>
            </DrawerHeader>
            <div className="grid grid-cols-3 gap-2 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {moreItems.map((item) => {
                const Icon = item.icon
                const isActive = activeTab === item.value
                return (
                  <button
                    key={item.value}
                    onClick={() => {
                      onChange(item.value)
                      setMoreOpen(false)
                    }}
                    className={cn(
                      'flex flex-col items-center justify-center gap-2 rounded-lg border p-4 text-sm font-medium transition-colors',
                      isActive ? 'border-primary text-primary bg-primary/5' : 'border-border text-foreground hover:bg-accent'
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    {item.label}
                  </button>
                )
              })}
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </>
  )
}
