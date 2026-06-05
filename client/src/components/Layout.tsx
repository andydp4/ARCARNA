import { ReactNode, useEffect } from 'react'
import { Link, useLocation } from 'wouter'
import { Menu, X, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { useNavigation } from '@/contexts/NavigationContext'
import { navItems } from './nav-items'
import { useMediaQuery } from '@/hooks/use-media-query'
import { OrgSwitcher } from './OrgSwitcher'
import { useAuth } from '@/hooks/useAuth'
import { Badge } from '@/components/ui/badge'
import { NotificationCenter } from '@/components/NotificationCenter'
import { navigateToLogout } from '@/lib/orgCacheWipe'
import { PwaInstallBanner } from '@/components/PwaInstallBanner'
import { BrandLogo } from '@/components/BrandLogo'
import { WhatsAppPanel } from '@/components/whatsapp/WhatsAppPanel'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation()
  const { sidebarOpen, toggleSidebar, setSidebarOpen } = useNavigation()
  const isMobile = useMediaQuery('(max-width: 768px)')
  const { user, devAuthBypass } = useAuth()
  const visibleNav = navItems.filter((item) => {
    if (item.key === 'user-access') {
      return user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN'
    }
    if (item.key === 'worker-logs' || item.key === 'audit-logs') {
      return user?.role === 'SUPER_ADMIN'
    }
    return true
  })

  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false)
    }
  }, [isMobile, setSidebarOpen])

  const NavLinks = () => (
    <nav className="space-y-1 px-3 py-4">
      {visibleNav.map((item) => {
        const Icon = item.icon
        const isActive = location === item.href
        return (
          <Link
            key={item.key}
            href={item.href}
            className={cn(
              'lm-nav-link flex items-center gap-3 rounded-lg px-3 py-2.5',
              isActive && 'lm-nav-link-active'
            )}
            data-testid={item.testId}
            onClick={() => isMobile && setSidebarOpen(false)}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {(!isMobile || sidebarOpen) && (
              <span className="text-sm font-medium">{item.label}</span>
            )}
          </Link>
        )
      })}
    </nav>
  )

  const logoutButtonClass = cn(
    'lm-nav-link flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium'
  )

  return (
    <div className="liquid-metal min-h-screen bg-background">
      <header className="lm-shell-header sticky top-0 z-50 border-b border-border">
        <div className="flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-4">
            {isMobile ? (
              <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="min-h-[44px] min-w-[44px] text-metal-warm-white hover:bg-metal-charcoal/60 hover:text-metal-warm-white"
                    data-testid="button-nav-toggle"
                    aria-label="Toggle navigation menu"
                  >
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="liquid-metal w-64 border-metal-edge bg-metal-gunmetal p-0">
                  <div className="flex h-full flex-col">
                    <div className="border-b border-border p-4">
                      <Link href="/" className="flex items-center gap-3" onClick={() => setSidebarOpen(false)}>
                        <BrandLogo variant="white-on-navy" size="sm" alt="" className="rounded-lg" />
                        <h2 className="text-lg font-semibold tracking-tight text-metal-warm-white">Midnight EPOS</h2>
                      </Link>
                    </div>
                    <div className="flex-1 overflow-y-auto"><NavLinks /></div>
                    <div className="border-t border-border p-4">
                      <button type="button" onClick={navigateToLogout} className={logoutButtonClass} data-testid="nav-logout">
                        <LogOut className="h-4 w-4" /><span>Sign Out</span>
                      </button>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            ) : (
              <Button variant="ghost" size="icon" className="min-h-[44px] min-w-[44px] text-metal-warm-white hover:bg-metal-charcoal/60 hover:text-metal-warm-white" onClick={toggleSidebar} data-testid="button-nav-toggle" aria-label="Toggle sidebar">
                {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            )}
            <Link href="/" className="flex min-w-0 items-center gap-2">
              <BrandLogo variant="white-on-navy" size="sm" alt="" className="rounded-md" />
              <span className="truncate text-xl font-semibold tracking-tight text-metal-warm-white">Midnight EPOS</span>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <OrgSwitcher />
            <NotificationCenter />
            {devAuthBypass && (
              <Badge variant="secondary" className="hidden border-metal-edge bg-metal-charcoal text-xs text-metal-muted sm:inline-flex" data-testid="dev-auth-badge">Dev bypass</Badge>
            )}
            <span className="hidden max-w-[120px] truncate text-sm text-metal-muted md:inline">{user?.firstName || user?.email || "Welcome"}</span>
            {!isMobile && (
              <button type="button" onClick={navigateToLogout} className="min-h-[44px] px-2 text-sm text-metal-muted transition-colors hover:text-metal-warm-white" data-testid="header-logout">Sign Out</button>
            )}
          </div>
        </div>
      </header>
      <PwaInstallBanner />
      <div className="flex">
        {!isMobile && (
          <aside className={cn('lm-shell-sidebar sticky top-16 h-[calc(100vh-4rem)] transition-all duration-300', sidebarOpen ? 'w-64' : 'w-16')}>
            <div className="flex h-full flex-col">
              <div className="flex-1 overflow-y-auto"><NavLinks /></div>
              <div className="border-t border-border p-4">
                <button type="button" onClick={navigateToLogout} className={cn(logoutButtonClass, !sidebarOpen && 'justify-center px-0')} data-testid="sidebar-logout">
                  <LogOut className="h-4 w-4" />{sidebarOpen && <span>Sign Out</span>}
                </button>
              </div>
            </div>
          </aside>
        )}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <WhatsAppPanel />
    </div>
  )
}
