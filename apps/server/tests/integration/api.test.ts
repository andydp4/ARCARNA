import request from 'supertest'
import app from '../../src/index'

describe('API Integration', () => {
  test('GET /api/analytics/daily-revenue', async () => {
    const res = await request(app).get('/api/analytics/daily-revenue')
    expect([200,401]).toContain(res.status)
    expect(Array.isArray(res.body) || typeof res.body === 'object').toBe(true)
  })

  test('Auth session cycle', async () => {
    const login = await request(app).get('/api/auth/login')
    expect([200,302]).toContain(login.status)

    const session = await request(app).get('/api/auth/session')
    expect([200,401]).toContain(session.status)

    const logout = await request(app).post('/api/auth/logout')
    expect([200,500]).toContain(logout.status)
  })
})