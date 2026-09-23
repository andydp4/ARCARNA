import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import { resolveAppPath } from '@/lib/appPaths'
import { orgOnlyHeaders } from '@/lib/orgScope'
import { setPreviewRole, type PreviewableRole } from '@/lib/previewRole'

const LABEL: Record<PreviewableRole, string> = { MANAGER: 'Manager', CASHIER: 'Cashier' }

function usePreviewSwitch() {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const run = async (role: PreviewableRole | null) => {
    setBusy(true)
    try {
      await setPreviewRole(role, orgOnlyHeaders(), (p) => window.location.assign(p), resolveAppPath('/'))
    } catch (err) {
      setBusy(false)
      toast({ title: 'Could not start the preview', description: (err as Error).message, variant: 'destructive' })
    }
  }
  return { busy, run }
}

/**
 * "Preview as" menu for admins (CMP-09). Shown only to a real SUPER_ADMIN or
 * ADMIN; the server refuses the header from anyone else regardless.
 */
export function PreviewRoleMenu() {
  const { user } = useAuth()
  const { busy, run } = usePreviewSwitch()
  const realRole = user?.preview?.realRole ?? user?.role
  if (realRole !== 'SUPER_ADMIN' && realRole !== 'ADMIN') return null
  const current = user?.preview?.role ?? null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="hidden min-h-[44px] items-center gap-1 px-2 text-sm text-metal-muted transition-colors hover:text-metal-warm-white sm:inline-flex"
        disabled={busy}
        data-testid="button-preview-role"
      >
        <Eye className="h-4 w-4" aria-hidden="true" />
        Preview as
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>See the app as another role</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(['MANAGER', 'CASHIER'] as const).map((role) => (
          <DropdownMenuItem
            key={role}
            disabled={current === role}
            onSelect={() => void run(role)}
            data-testid={`menu-preview-${role.toLowerCase()}`}
          >
            {LABEL[role]}
          </DropdownMenuItem>
        ))}
        {current && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void run(null)} data-testid="menu-preview-exit">
              Exit preview
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Stays on screen for the whole preview, so nobody forgets they are in one. */
export function PreviewRoleBanner() {
  const { user } = useAuth()
  const { busy, run } = usePreviewSwitch()
  const preview = user?.preview
  if (!preview) return null
  return (
    <div
      role="status"
      className="sticky top-16 z-40 flex flex-wrap items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-black"
      data-testid="banner-preview-role"
    >
      <span>
        Previewing as {LABEL[preview.role]}. You see what a {LABEL[preview.role].toLowerCase()} sees; nothing can be
        changed until you exit.
      </span>
      <button
        type="button"
        onClick={() => void run(null)}
        disabled={busy}
        className="inline-flex min-h-[36px] items-center gap-1 rounded border border-black/40 px-3 hover:bg-black/10"
        data-testid="button-exit-preview"
      >
        <EyeOff className="h-4 w-4" aria-hidden="true" />
        Exit preview
      </button>
    </div>
  )
}
