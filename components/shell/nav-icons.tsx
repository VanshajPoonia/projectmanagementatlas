import {
  Bell,
  Calendar,
  Crown,
  Kanban,
  ListChecks,
  Lock,
  Megaphone,
  MessageSquare,
  Shield,
  type LucideIcon,
} from 'lucide-react'

// Maps nav-model icon keys (plain strings, so the model stays dependency-free) to
// concrete lucide components. A missing key falls back to a neutral list icon.
const ICONS: Record<string, LucideIcon> = {
  'inbox-check': ListChecks,
  kanban: Kanban,
  bell: Bell,
  calendar: Calendar,
  megaphone: Megaphone,
  lock: Lock,
  message: MessageSquare,
  shield: Shield,
  crown: Crown,
}

export function navIcon(key: string): LucideIcon {
  return ICONS[key] ?? ListChecks
}
