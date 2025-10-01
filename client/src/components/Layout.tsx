import { ReactNode, useEffect } from 'react'
import { Link, useLocation } from 'wouter'
import { Menu, X, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { useNavigation } from '@/contexts/NavigationContext'
import { navItems } from './nav-items'
import { useMediaQuery } from '@/hooks/use-media-query'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation()
  const { sidebarOpen, toggleSidebar, setSidebarOpen } = useNavigation()
  const isMobile = useMediaQuery('(max-width: 768px)')

  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false)
    }
  }, [isMobile, setSidebarOpen])

  const NavLinks = () => (
    <nav className="space-y-2 px-3 py-4">
      {navItems.map((item) => {
        const Icon = item.icon
        const isActive = location === item.href
        return (
          <Link key={item.key} href={item.href}>
            <a
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
                isActive && 'bg-accent text-accent-foreground'
              )}
              data-testid={item.testId}
              onClick={() => isMobile && setSidebarOpen(false)}
            >
              <Icon className="h-4 w-4" />
              {(!isMobile || sidebarOpen) && (
                <span className="text-sm font-medium">{item.label}</span>
              )}
            </a>
          </Link>
        )
      })}
    </nav>
  )

  return (
    <div className="min-h-screen bg-background">
      {/* Top Bar */}
      <header className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="flex items-center justify-between h-16 px-4">
          <div className="flex items-center gap-4">
            {isMobile ? (
              <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    data-testid="button-nav-toggle"
                    aria-label="Toggle navigation menu"
                  >
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-64 p-0">
                  <div className="flex flex-col h-full">
                    <div className="p-4 border-b border-border">
                      <h2 className="text-lg font-semibold">Midnight EPOS</h2>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                      <NavLinks />
                    </div>
                    <div className="p-4 border-t border-border">
                      <a href="/api/logout" className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent transition-colors" data-testid="nav-logout">
                        <LogOut className="h-4 w-4" />
                        <span className="text-sm font-medium">Sign Out</span>
                      </a>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                data-testid="button-nav-toggle"
                aria-label="Toggle sidebar"
              >
                {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            )}
            <h1 className="text-xl font-semibold">Midnight EPOS</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">Welcome back!</span>
            {!isMobile && (
              <a href="/api/logout" className="text-sm hover:underline" data-testid="header-logout">
                Sign Out
              </a>
            )}
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Desktop Sidebar */}
        {!isMobile && (
          <aside
            className={cn(
              'sticky top-16 h-[calc(100vh-4rem)] bg-card border-r border-border transition-all duration-300',
              sidebarOpen ? 'w-64' : 'w-16'
            )}
          >
            <div className="flex flex-col h-full">
              <div className="flex-1 overflow-y-auto">
                <NavLinks />
              </div>
              <div className="p-4 border-t border-border">
                <a
                  href="/api/logout"
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent transition-colors',
                    !sidebarOpen && 'justify-center px-0'
                  )}
                  data-testid="sidebar-logout"
                >
                  <LogOut className="h-4 w-4" />
                  {sidebarOpen && <span className="text-sm font-medium">Sign Out</span>}
                </a>
              </div>
            </div>
          </aside>
        )}

        {/* Main Content */}
        <main className="flex-1 min-w-0">
          {children}
        </main>
      </div>
    </div>
  )
}