import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react'
import { readPinned, writePinned } from '@/lib/sidebar'

interface NavigationContextType {
  /**
   * Open for now: hovered, focused or tapped open (or the phone sheet showing).
   * Not remembered — a sidebar left open on the last visit would cover the
   * board on the next one.
   */
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
  /** Pinned open, pushing the page aside. Remembered on this device. */
  pinned: boolean
  setPinned: (pinned: boolean) => void
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined)

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [pinned, setPinnedState] = useState(readPinned)

  const setPinned = useCallback((next: boolean) => {
    setPinnedState(next)
    writePinned(next)
  }, [])

  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), [])

  const value = useMemo(
    () => ({ sidebarOpen, setSidebarOpen, toggleSidebar, pinned, setPinned }),
    [sidebarOpen, toggleSidebar, pinned, setPinned],
  )

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
}

export function useNavigation() {
  const context = useContext(NavigationContext)
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider')
  }
  return context
}
