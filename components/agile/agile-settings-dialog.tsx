'use client'

// Per-board agile configuration: the opt-in, the vocabulary, the units, and the two
// warning/enforcement modes.
//
// ⚠️ THE WIP ENFORCEMENT MODE TELLS THE TRUTH ABOUT ITSELF. Enforcement is only real once
// migration 125 (a trigger on `tasks`) is applied, and that migration is deliberately NOT
// --allow-prod eligible. Where it is not applied, this dialog says so and the option describes
// what will actually happen. A control labelled working that does nothing is this repo's
// most-repeated defect - profiles.is_active, app_modules, board_members.role,
// crm_statuses.requires_reason - and the version of it that is hardest to find is the one
// where nothing fails.

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  ENFORCEMENT_MODES, ESTIMATE_UNITS, TERMINOLOGIES, sprintNounPluralTitle,
  type AgileSettings, type EnforcementMode, type EstimateUnit, type Terminology,
} from '@/lib/agile'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  boardTitle: string
  settings: AgileSettings
  /** False for a plain member: the board_agile_settings write policy is admin-only. */
  canManage: boolean
  /** Whether migration 125 is applied. Drives what the enforcement option promises. */
  wipEnforcementAvailable: boolean
  busy?: boolean
  onSave: (patch: Partial<Omit<AgileSettings, 'board_id'>>) => void
}

const MODE_COPY: Record<EnforcementMode, string> = {
  warning: 'Warn, but allow it',
  enforcement: 'Refuse it',
}

export function AgileSettingsDialog({
  open, onOpenChange, boardTitle, settings, canManage, wipEnforcementAvailable, busy, onSave,
}: Props) {
  const [draft, setDraft] = useState(settings)
  useEffect(() => { if (open) setDraft(settings) }, [open, settings])

  const set = <K extends keyof AgileSettings>(key: K, value: AgileSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Agile mode on {boardTitle}</DialogTitle>
          <DialogDescription>
            Per board, and off by default. Turning it off here leaves every {sprintNounPluralTitle(draft.terminology).toLowerCase()} and
            all their recorded numbers exactly where they are &mdash; it only stops this board showing them.
          </DialogDescription>
        </DialogHeader>

        {!canManage && (
          <p className="bg-muted text-muted-foreground rounded-md p-3 text-sm">
            Only an admin can change these. You are seeing them read-only.
          </p>
        )}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="agile-enabled">Agile mode</Label>
            <Select
              value={draft.is_enabled ? 'on' : 'off'}
              onValueChange={(v) => set('is_enabled', v === 'on')}
              disabled={!canManage}
            >
              <SelectTrigger id="agile-enabled"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off &mdash; this is an ordinary board</SelectItem>
                <SelectItem value="on">On &mdash; plan work in windows</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="agile-term">Call a window a</Label>
              <Select value={draft.terminology} onValueChange={(v) => set('terminology', v as Terminology)} disabled={!canManage}>
                <SelectTrigger id="agile-term"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TERMINOLOGIES.map((t) => (
                    <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                One underlying model &mdash; only the word on screen changes.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="agile-unit">Estimate in</Label>
              <Select value={draft.estimate_unit} onValueChange={(v) => set('estimate_unit', v as EstimateUnit)} disabled={!canManage}>
                <SelectTrigger id="agile-unit"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ESTIMATE_UNITS.map((u) => (
                    <SelectItem key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Existing estimates keep their numbers. Windows already closed keep the unit they were counted in.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agile-capacity-mode">When a window goes over capacity</Label>
            <Select value={draft.capacity_mode} onValueChange={(v) => set('capacity_mode', v as EnforcementMode)} disabled={!canManage}>
              <SelectTrigger id="agile-capacity-mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ENFORCEMENT_MODES.map((m) => (
                  <SelectItem key={m} value={m}>{MODE_COPY[m]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agile-wip-mode">When a column is at its work-in-progress limit</Label>
            <Select value={draft.wip_mode} onValueChange={(v) => set('wip_mode', v as EnforcementMode)} disabled={!canManage}>
              <SelectTrigger id="agile-wip-mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ENFORCEMENT_MODES.map((m) => (
                  <SelectItem key={m} value={m}>{MODE_COPY[m]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {draft.wip_mode === 'enforcement' && !wipEnforcementAvailable && (
              <p className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  The database rule that enforces this is not installed here, so a move into a full column
                  will still be allowed &mdash; the board will warn instead. Nothing about the limit itself changes.
                </span>
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              Set the limit itself on each column, from the board&apos;s column menu.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {canManage && (
            <Button disabled={busy} onClick={() => onSave({
              is_enabled: draft.is_enabled,
              terminology: draft.terminology,
              estimate_unit: draft.estimate_unit,
              capacity_mode: draft.capacity_mode,
              wip_mode: draft.wip_mode,
            })}>
              {busy ? 'Saving…' : 'Save settings'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
