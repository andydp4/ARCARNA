import { Request, Response, NextFunction } from 'express'

// Simple requireAuth middleware
// In development: bypass auth
// In production: require header 'x-replit-user-id'
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV === 'development') {
    return next()
  }
  if (req.headers['x-replit-user-id']) {
    (req as any).user = { id: req.headers['x-replit-user-id'] }
    return next()
  }
  res.status(401).json({ error: 'Unauthorized' })
}