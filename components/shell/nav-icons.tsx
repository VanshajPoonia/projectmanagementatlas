import {
  Bell,
  Calendar,
  CalendarClock,
  Clock,
  Crown,
  FileBarChart,
  Hash,
  History,
  Home,
  Kanban,
  LayoutDashboard,
  Link2,
  ListChecks,
  Lock,
  Megaphone,
  MessageSquare,
  Plus,
  Search,
  Shield,
  SlidersHorizontal,
  Star,
  type LucideIcon,
} from 'lucide-react'

// Maps nav-model icon keys (plain strings, so the model stays dependency-free) to
// concrete lucide components. A missing key falls back to a neutral list icon.
const ICONS: Record<string, LucideIcon> = {
  'inbox-check': ListChecks,
  kanban: Kanban,
  bell: Bell,
  calendar: Calendar,
  appointments: CalendarClock,
  'project-ids': Hash,
  megaphone: Megaphone,
  lock: Lock,
  message: MessageSquare,
  shield: Shield,
  crown: Crown,
  home: Home,
  overview: LayoutDashboard,
  reports: FileBarChart,
  statuses: SlidersHorizontal,
  history: History,
  // Command-palette-only keys (commands.ts), not used by any nav item.
  plus: Plus,
  search: Search,
  clock: Clock,
  link: Link2,
  star: Star,
}

export function navIcon(key: string): LucideIcon {
  return ICONS[key] ?? ListChecks
}
