import { useEffect, useState } from 'react'

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    fetch('/api/auth/session')
      .then(r => r.ok ? r.json() : null)
      .then(data => { setUser(data?.user || null); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-white p-10">Loading...</div>
  if (!user) {
    return (
      <div className="text-white p-10 space-y-4">
        <p>You must log in to view this dashboard.</p>
        <button
          onClick={() => window.location.href = '/api/auth/login'}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white font-semibold"
        >
          Login with Replit
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-end p-4">
        <button
          onClick={() => {
            fetch('/api/auth/logout', { method: 'POST' })
              .then(() => window.location.reload())
          }}
          className="px-3 py-1 bg-red-600 hover:bg-red-500 rounded text-white text-sm"
        >
          Logout
        </button>
      </div>
      {children}
    </div>
  )
}