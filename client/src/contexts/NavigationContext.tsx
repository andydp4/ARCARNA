import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

interface NavigationContextType {
  sidebarOpen: boolean
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined)

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const stored = localStorage.getItem('sidebar-open')
    return stored ? JSON.parse(stored) : true
  })

  useEffect(() => {
    localStorage.setItem('sidebar-open', JSON.stringify(sidebarOpen))
  }, [sidebarOpen])

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen)

  return (
    <NavigationContext.Provider value={{ sidebarOpen, toggleSidebar, setSidebarOpen }}>
      {children}
    </NavigationContext.Provider>
  )
}

export function useNavigation() {
  const context = useContext(NavigationContext)
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider')
  }
  return context
}