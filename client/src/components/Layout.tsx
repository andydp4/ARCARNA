import { ReactNode, useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { Link, useLocation, useSearch } from 'wouter'
import { Menu, X, LogOut, Pin, PinOff, Compass, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { useNavigation } from '@/contexts/NavigationContext'
import { centreForPath, centreTourKeyForPath, visibleCentres, visibleTabs, type Centre, type CentreKey, type NavItem } from './nav-items'
import { useMediaQuery } from '@/hooks/use-media-query'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { OrgSwitcher } from './OrgSwitcher'
import { useAuth } from '@/hooks/useAuth'
import { Badge } from '@/components/ui/badge'
import { NotificationCenter } from '@/components/NotificationCenter'
import { ProblemButton, ProblemSheet } from '@/components/problem/ProblemSheet'
import { StudyBanner, UsageRecorder } from '@/components/usage/UsageRecorder'
import { navigateToLogout } from '@/lib/orgCacheWipe'
import { PwaInstallBanner } from '@/components/PwaInstallBanner'
import { BrandLogo } from '@/components/BrandLogo'
import { BRAND_PRODUCT_NAME } from '@shared/brand'
import { isAtLeast } from '@shared/accessPolicy'
import { WhatsAppPanel } from '@/components/whatsapp/WhatsAppPanel'
import { ArcarnaAssistantBar } from '@/components/assistant/ArcarnaAssistantBar'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { PreviewRoleBanner, PreviewRoleMenu } from '@/components/PreviewRole'
import { CentreTour, startCentreTour } from '@/components/tour/CentreTour'
import { startOpsTour } from '@/components/operations/OpsTour'
import {
  HOVER_QUERY,
  PHONE_QUERY,
  SIDEBAR_CLOSE_DELAY_MS,
  closesOnOutsidePointer,
  closesOnToggleLeave,
  opensOnPointerEnter,
  sidebarLayout,
  sidebarMode,
} from '@/lib/sidebar'

interface LayoutProps {
  children: ReactNode
}

/** The Centre whose pages the menu shows for a route. The Control Centre has none, so it shows the main menu. */
function menuKeyFor(centre: Centre | undefined): CentreKey | null {
  if (!centre || centre.key === 'control') return null
  return centre.key
}

interface SidebarMenuProps {
  centres: Centre[]
  role: string | undefined
  menuCentreKey: CentreKey | null
  onMenuCentreChange: (key: CentreKey | null) => void
  routeCentreKey: CentreKey | undefined
  showLabels: boolean
  location: string
  search: string
  /** A page was chosen: tablets and phones put the menu away. */
  onNavigate: () => void
  onReplayTour: () => void
}

/**
 * The drill-down menu (v1.2 Phase 3). The main menu lists the Centres the
 * viewer can see; choosing one opens its landing page and switches the menu
 * to that Centre's pages, with "← Main menu" to go back.
 */
function SidebarMenu({
  centres,
  role,
  menuCentreKey,
  onMenuCentreChange,
  routeCentreKey,
  showLabels,
  location,
  search,
  onNavigate,
  onReplayTour,
}: SidebarMenuProps) {
  const centre = menuCentreKey ? centres.find((c) => c.key === menuCentreKey) : undefined
  const activeTab = new URLSearchParams(search).get('tab') ?? 'general'

  const linkClass = (active: boolean) =>
    cn('lm-nav-link flex items-center gap-3 rounded-lg px-3 py-2.5', active && 'lm-nav-link-active', !showLabels && 'justify-center px-0')

  const replay = (
    <button
      type="button"
      onClick={onReplayTour}
      className={cn(linkClass(false), 'w-full text-sm font-medium')}
      data-testid="nav-replay-tour"
      // On the icon rail this is an icon and nothing else.
      aria-label={showLabels ? undefined : 'Replay tour'}
      title={showLabels ? undefined : 'Replay tour'}
    >
      <Compass className="h-4 w-4 shrink-0" aria-hidden />
      {showLabels && <span>Replay tour</span>}
    </button>
  )

  if (!centre) {
    return (
      <nav className="space-y-1 px-3 py-4" aria-label="Main menu">
        <div className="space-y-1" data-testid="nav-main-list">
          {centres.map((c) => {
            const Icon = c.icon
            const landing = c.items[0].href
            const isHere = routeCentreKey === c.key
            return (
              <Link
                key={c.key}
                href={landing}
                className={linkClass(isHere)}
                data-testid={c.testId}
                aria-current={isHere ? 'true' : undefined}
                // Collapsed to the icon rail the link's only child is an icon;
                // the label is hidden, not absent, so it is given here.
                aria-label={showLabels ? undefined : c.label}
                title={showLabels ? undefined : c.label}
                onClick={() => {
                  const next = menuKeyFor(c)
                  onMenuCentreChange(next)
                  // A Centre with no pages of its own is a page: put the menu away.
                  if (!next) onNavigate()
                }}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {showLabels && <span className="text-sm font-medium">{c.label}</span>}
              </Link>
            )
          })}
        </div>
        <div className="pt-4">{replay}</div>
      </nav>
    )
  }

  return (
    <nav className="space-y-1 px-3 py-4" aria-label={centre.label}>
      <button
        type="button"
        onClick={() => onMenuCentreChange(null)}
        className={cn(linkClass(false), 'w-full text-sm font-medium')}
        data-testid="nav-main-menu"
        aria-label={showLabels ? undefined : 'Main menu'}
        title={showLabels ? undefined : 'Main menu'}
      >
        {showLabels ? <span>{'←'} Main menu</span> : <ArrowLeft className="h-4 w-4" aria-hidden />}
      </button>
      {showLabels && (
        <p
          className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-metal-muted"
          data-testid="nav-centre-title"
        >
          {centre.label}
        </p>
      )}
      <div className="space-y-1" role="group" aria-label={centre.label} data-testid="nav-centre-menu">
        {centre.items.map((item) => {
          const Icon = item.icon
          const isActive = location === item.href
          const tabs = showLabels ? visibleTabs(item, role) : []
          return (
            <div key={item.key}>
              <Link
                href={item.href}
                className={linkClass(isActive && tabs.length === 0)}
                data-testid={item.testId}
                aria-current={isActive ? 'page' : undefined}
                aria-label={showLabels ? undefined : item.label}
                title={showLabels ? undefined : item.label}
                onClick={onNavigate}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {showLabels && <span className="text-sm font-medium">{item.label}</span>}
              </Link>
              {tabs.length > 0 && (
                <div className="ml-7 mt-1 space-y-0.5 border-l border-border pl-2">
                  {tabs.map((tab) => {
                    const active = isActive && activeTab === tab.tab
                    return (
                      <Link
                        key={tab.key}
                        href={tabHref(item, tab.tab)}
                        className={cn('lm-nav-link flex items-center rounded-md px-3 py-1.5 text-sm', active && 'lm-nav-link-active')}
                        data-testid={tab.testId}
                        aria-current={active ? 'page' : undefined}
                        onClick={onNavigate}
                      >
                        {tab.label}
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="pt-4">{replay}</div>
    </nav>
  )
}

function tabHref(item: NavItem, tab: string): string {
  return `${item.href}?tab=${encodeURIComponent(tab)}`
}

export function Layout({ children }: LayoutProps) {
  const [location, navigate] = useLocation()
  const search = useSearch()
  const { sidebarOpen, setSidebarOpen, pinned, setPinned } = useNavigation()
  const isPhone = useMediaQuery(PHONE_QUERY)
  const canHover = useMediaQuery(HOVER_QUERY)
  const mode = sidebarMode({ isPhone, canHover })
  const reducedMotion = usePrefersReducedMotion()
  const { user, devAuthBypass } = useAuth()
  // Staff only: a shop account (CUSTOMER) never reaches the Layout, but be sure.
  const isStaff = isAtLeast(user?.role, 'CASHIER')
  const role = user?.role
  const centres = useMemo(() => visibleCentres(role), [role])
  const routeCentre = centreForPath(location)
  const routeCentreKey = routeCentre?.key
  // Only a Centre this viewer may open, on a page they may open.
  const tourCentreKey = centreTourKeyForPath(location, role)
  const { expanded, pushesContent } = sidebarLayout({ mode, pinned, open: sidebarOpen })

  // A deep link opens the right Centre: the menu follows the route. Keyed on
  // the Centre, not the path, so moving between two pages of one Centre does
  // not undo a "← Main menu" the viewer just chose.
  const [menuCentreKey, setMenuCentreKey] = useState<CentreKey | null>(() => menuKeyFor(routeCentre))
  useEffect(() => {
    setMenuCentreKey(menuKeyFor(centreForPath(location)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeCentreKey])

  const asideRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  const pointerInside = useRef(false)

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== undefined) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = undefined
    }
  }, [])

  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = undefined
      setSidebarOpen(false)
    }, SIDEBAR_CLOSE_DELAY_MS)
  }, [cancelClose, setSidebarOpen])

  useEffect(() => cancelClose, [cancelClose])

  // Crossing into or out of phone width (or rotating a tablet) must not leave
  // a sheet or an overlay stranded open.
  useEffect(() => {
    setSidebarOpen(false)
  }, [mode, setSidebarOpen])

  // Escape closes it from anywhere, not only with focus inside.
  useEffect(() => {
    if (!sidebarOpen || mode === 'phone') return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelClose()
        setSidebarOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sidebarOpen, mode, cancelClose, setSidebarOpen])

  // A tap (tablet) or click (mouse) outside the open overlay puts it away.
  useEffect(() => {
    if (!sidebarOpen || !closesOnOutsidePointer(mode, pinned)) return
    const onDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (asideRef.current?.contains(target) || toggleRef.current?.contains(target)) return
      cancelClose()
      setSidebarOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [sidebarOpen, mode, pinned, cancelClose, setSidebarOpen])

  const onPointerEnter = (event: PointerEvent<HTMLElement>) => {
    pointerInside.current = true
    if (!opensOnPointerEnter(mode, event.pointerType)) return
    cancelClose()
    setSidebarOpen(true)
  }

  const onPointerLeave = (event: PointerEvent<HTMLElement>) => {
    pointerInside.current = false
    if (mode !== 'hover' || event.pointerType === 'touch') return
    scheduleClose()
  }

  // Keyboard focus opens it. Only keyboard focus (:focus-visible): a tap or
  // click also focuses what it lands on, and opening then would flash the
  // menu open on the way to another page.
  const onFocus = (event: FocusEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    let keyboard = true
    try {
      keyboard = target.matches(':focus-visible')
    } catch {
      // An engine without :focus-visible: treat focus as keyboard focus.
    }
    if (!keyboard) return
    cancelClose()
    setSidebarOpen(true)
  }

  const onBlur = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget as Node | null
    if (next && asideRef.current?.contains(next)) return
    // Tabbing out closes it; a mouse still over it keeps it (the leave timer handles that).
    if (!pointerInside.current) setSidebarOpen(false)
  }

  const onAsideKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      cancelClose()
      setSidebarOpen(false)
    }
  }

  const onNavigate = useCallback(() => {
    // A mouse still over the menu keeps it open; tablets and phones put it away.
    if (mode !== 'hover') setSidebarOpen(false)
  }, [mode, setSidebarOpen])

  const onReplayTour = useCallback(() => {
    if (mode !== 'hover') setSidebarOpen(false)
    if (routeCentreKey === 'operations') {
      if (location === '/operations') {
        startOpsTour()
      } else {
        navigate('/operations')
        // The board and its tour are still loading: the request waits for
        // the tour to mount and its steps to render (tourReplay.ts).
        startOpsTour()
      }
      return
    }
    startCentreTour()
  }, [mode, routeCentreKey, location, navigate, setSidebarOpen])

  const togglePinned = () => {
    const next = !pinned
    setPinned(next)
    // Unpinning with the pointer elsewhere: fold straight back to the rail.
    if (!next && !pointerInside.current) setSidebarOpen(false)
  }

  const menu = (showLabels: boolean) => (
    <SidebarMenu
      centres={centres}
      role={role}
      menuCentreKey={menuCentreKey}
      onMenuCentreChange={setMenuCentreKey}
      routeCentreKey={routeCentreKey}
      showLabels={showLabels}
      location={location}
      search={search}
      onNavigate={onNavigate}
      onReplayTour={onReplayTour}
    />
  )

  const logoutButtonClass = cn(
    'lm-nav-link flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium'
  )

  const headerButtonClass =
    'min-h-[44px] min-w-[44px] text-metal-warm-white hover:bg-metal-charcoal/60 hover:text-metal-warm-white'

  const motionClass = reducedMotion ? undefined : 'transition-[width] duration-200 ease-out motion-reduce:transition-none'

  return (
    <div className="liquid-metal min-h-screen bg-background">
      <header className="lm-shell-header sticky top-0 z-50 border-b border-border">
        <div className="flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-4">
            {mode === 'phone' ? (
              <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={headerButtonClass}
                    data-testid="button-nav-toggle"
                    aria-label="Open menu"
                  >
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="liquid-metal w-64 border-metal-edge bg-metal-gunmetal p-0">
                  <SheetTitle className="sr-only">Menu</SheetTitle>
                  <div className="flex h-full flex-col">
                    <div className="border-b border-border p-4">
                      <Link href="/" className="flex items-center gap-3" onClick={() => setSidebarOpen(false)}>
                        <BrandLogo variant="mark" size="sm" alt="" className="rounded-lg" />
                        <h2 className="text-lg font-semibold tracking-tight text-metal-warm-white">{BRAND_PRODUCT_NAME}</h2>
                      </Link>
                    </div>
                    <div className="flex-1 overflow-y-auto">{menu(true)}</div>
                    <div className="border-t border-border p-4">
                      <button type="button" onClick={navigateToLogout} className={logoutButtonClass} data-testid="nav-logout">
                        <LogOut className="h-4 w-4" /><span>Sign Out</span>
                      </button>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            ) : (
              <Button
                ref={toggleRef}
                variant="ghost"
                size="icon"
                className={headerButtonClass}
                onClick={() => {
                  cancelClose()
                  if (pinned) {
                    setPinned(false)
                    setSidebarOpen(false)
                    return
                  }
                  setSidebarOpen(!sidebarOpen)
                }}
                data-testid="button-nav-toggle"
                onPointerEnter={cancelClose}
                onPointerLeave={(event) => {
                  if (sidebarOpen && closesOnToggleLeave(mode, pinned, event.pointerType)) scheduleClose()
                }}
                aria-label={expanded ? 'Close menu' : 'Open menu'}
                aria-expanded={expanded}
                aria-controls="app-sidebar"
              >
                {expanded ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            )}
            <Link href="/" className="flex min-w-0 items-center gap-2">
              <BrandLogo variant="mark" size="sm" alt="" className="rounded-md" />
              <span className="truncate text-xl font-semibold tracking-tight text-metal-warm-white">{BRAND_PRODUCT_NAME}</span>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <OrgSwitcher />
            <PreviewRoleMenu />
            {isStaff && <ProblemButton />}
            <NotificationCenter />
            {devAuthBypass && (
              <Badge variant="secondary" className="hidden border-metal-edge bg-metal-charcoal text-xs text-metal-muted sm:inline-flex" data-testid="dev-auth-badge">Dev bypass</Badge>
            )}
            <span className="hidden max-w-[120px] truncate text-sm text-metal-muted md:inline">{user?.firstName || user?.email || "Welcome"}</span>
            {mode !== 'phone' && (
              <button type="button" onClick={navigateToLogout} className="min-h-[44px] px-2 text-sm text-metal-muted transition-colors hover:text-metal-warm-white" data-testid="header-logout">Sign Out</button>
            )}
          </div>
        </div>
      </header>
      <PreviewRoleBanner />
      <PwaInstallBanner />
      <div className="flex">
        {mode !== 'phone' && (
          // The slot holds the rail's width in the page flow. Unpinned, the
          // open sidebar spills over the page rather than widening the slot,
          // so the board underneath never jumps; pinned, the slot widens and
          // the page moves aside.
          <div
            className={cn('relative shrink-0', pushesContent ? 'w-64' : 'w-16', motionClass)}
            data-testid="sidebar-slot"
          >
            <aside
              id="app-sidebar"
              ref={asideRef}
              aria-label="Menu"
              data-testid="sidebar"
              data-state={expanded ? 'open' : 'closed'}
              data-pinned={pinned ? 'true' : 'false'}
              data-mode={mode}
              onPointerEnter={onPointerEnter}
              onPointerLeave={onPointerLeave}
              onFocus={onFocus}
              onBlur={onBlur}
              onKeyDown={onAsideKeyDown}
              className={cn(
                'lm-shell-sidebar sticky top-16 z-40 h-[calc(100vh-4rem)] overflow-hidden',
                expanded ? 'w-64' : 'w-16',
                expanded && !pushesContent && 'shadow-2xl',
                motionClass,
              )}
            >
              <div className="flex h-full w-full flex-col">
                <div className={cn('flex border-b border-border p-2', expanded ? 'justify-end' : 'justify-center')}>
                  <button
                    type="button"
                    onClick={togglePinned}
                    className={cn(
                      'lm-nav-link flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
                      !expanded && 'w-11 justify-center px-0',
                    )}
                    aria-pressed={pinned}
                    aria-label={expanded ? undefined : pinned ? 'Unpin menu' : 'Pin menu open'}
                    title={pinned ? 'Unpin menu' : 'Pin menu open'}
                    data-testid="nav-pin"
                  >
                    {pinned ? <PinOff className="h-4 w-4" aria-hidden /> : <Pin className="h-4 w-4" aria-hidden />}
                    {expanded && <span>{pinned ? 'Unpin menu' : 'Pin menu open'}</span>}
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto overflow-x-hidden">{menu(expanded)}</div>
                <div className="border-t border-border p-4">
                  <button
                    type="button"
                    onClick={navigateToLogout}
                    className={cn(logoutButtonClass, !expanded && 'justify-center px-0')}
                    // Same reason as the nav links: on the icon rail this
                    // button is an icon and nothing else.
                    aria-label={expanded ? undefined : 'Sign Out'}
                    title={expanded ? undefined : 'Sign Out'}
                    data-testid="sidebar-logout"
                  >
                    <LogOut className="h-4 w-4" />{expanded && <span>Sign Out</span>}
                  </button>
                </div>
              </div>
            </aside>
          </div>
        )}
        <main className="min-w-0 flex-1">
          {/* Per-page boundary: a crash on one page no longer blanks the whole
              app (till included); navigating away clears it. */}
          <StudyBanner />
          <ErrorBoundary scope="page" resetKey={location}>{children}</ErrorBoundary>
        </main>
      </div>
      <WhatsAppPanel />
      <ArcarnaAssistantBar />
      {isStaff && <ProblemSheet />}
      {isStaff && <UsageRecorder />}
      {tourCentreKey && user && user.role !== 'CUSTOMER' && <CentreTour centre={tourCentreKey} />}
    </div>
  )
}
