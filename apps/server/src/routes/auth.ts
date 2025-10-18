import { Router } from 'express'

const router = Router()

router.get('/session', (req, res) => {
  if ((req as any).session?.user) {
    res.json({ user: (req as any).session.user })
  } else if ((req as any).user) {
    res.json({ user: (req as any).user })
  } else {
    res.status(401).json({ user: null })
  }
})

// Redirect to login (stubbed)
router.get('/login', (req, res) => {
  if (process.env.NODE_ENV === 'development') {
    // Set session in development
    (req as any).session = (req as any).session || {}
    ;(req as any).session.user = { id: 'dev-user', name: 'Dev Mode User' }
    res.json({ message: 'Dev mode: pretend login', user: { id: 'dev-user' } })
  } else {
    res.redirect('https://replit.com/login')
  }
})

// OAuth callback (stubbed)
router.get('/callback', (req, res) => {
  if (process.env.NODE_ENV === 'development') {
    const fakeUser = { id: 'dev-user', name: 'Dev Mode User' }
    ;(req as any).session = (req as any).session || {}
    ;(req as any).session.user = fakeUser
    return res.json({ message: 'Dev login complete', user: fakeUser })
  } else {
    // TODO: Exchange code with Replit OIDC
    // const { code } = req.query
    // fetch('https://replit.com/oauth/token', { ... })
    //   -> get user info
    //   -> set session
    return res.json({ message: 'OIDC login callback not yet implemented' })
  }
})

// Logout and destroy session
router.post('/logout', (req, res) => {
  if ((req as any).session) {
    (req as any).session.destroy((err: any) => {
      if (err) {
        console.error('[Auth] Session destruction error:', err)
        res.clearCookie('connect.sid') // Clear cookie anyway
        return res.status(500).json({ error: 'Logout failed', message: err.message })
      }
      res.clearCookie('connect.sid')
      return res.json({ message: 'Logged out' })
    })
  } else {
    res.clearCookie('connect.sid') // Clear cookie even if no session
    res.json({ message: 'No session' })
  }
})

export default router