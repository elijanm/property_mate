import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

export const handlers = [
  http.post('/api/v1/auth/login', async ({ request }) => {
    const body = await request.json() as { email?: string; password?: string }
    if (body.email === 'owner@test.com' && body.password === 'password') {
      return HttpResponse.json({
        token: 'mock-jwt-token',
        refresh_token: 'mock-refresh-token',
        user: { user_id: 'u1', org_id: 'org1', role: 'owner', email: 'owner@test.com' },
      })
    }
    return HttpResponse.json(
      { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } },
      { status: 401 },
    )
  }),

  http.post('/api/v1/auth/refresh', async ({ request }) => {
    const body = await request.json() as { refresh_token?: string }
    if (body.refresh_token === 'mock-refresh-token') {
      return HttpResponse.json({ token: 'new-mock-jwt-token' })
    }
    return HttpResponse.json(
      { error: { code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token is invalid' } },
      { status: 401 },
    )
  }),
]

export const server = setupServer(...handlers)
