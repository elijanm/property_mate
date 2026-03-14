import { describe, it, expect, beforeEach, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/mocks/server'
import { TOKEN_KEY, REFRESH_TOKEN_KEY, USER_KEY } from '@/constants/storage'

// Import client after setting up storage so interceptors pick up the right keys
let apiClient: typeof import('@/api/client').default

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const mod = await import('@/api/client')
  apiClient = mod.default
})

describe('apiClient interceptors', () => {
  it('attaches Authorization header when token is present', async () => {
    localStorage.setItem(TOKEN_KEY, 'my-token')

    let capturedAuth = ''
    server.use(
      http.get('/api/v1/test', ({ request }) => {
        capturedAuth = request.headers.get('Authorization') ?? ''
        return HttpResponse.json({ ok: true })
      }),
    )

    await apiClient.get('/test')
    expect(capturedAuth).toBe('Bearer my-token')
  })

  it('attempts token refresh on 401 and retries the original request', async () => {
    localStorage.setItem(TOKEN_KEY, 'expired-token')
    localStorage.setItem(REFRESH_TOKEN_KEY, 'mock-refresh-token')

    let callCount = 0
    server.use(
      http.get('/api/v1/protected', ({ request }) => {
        callCount++
        const auth = request.headers.get('Authorization')
        if (auth === 'Bearer expired-token') {
          return HttpResponse.json(
            { error: { code: 'UNAUTHORIZED', message: 'Token expired' } },
            { status: 401 },
          )
        }
        return HttpResponse.json({ data: 'secret' })
      }),
    )

    const res = await apiClient.get('/protected')
    expect(res.data).toEqual({ data: 'secret' })
    expect(callCount).toBe(2) // first attempt + retry after refresh
    expect(localStorage.getItem(TOKEN_KEY)).toBe('new-mock-jwt-token')
  })

  it('redirects to /login when refresh itself returns 401', async () => {
    const locationSpy = vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      href: '',
    } as Location)
    const hrefSetter = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, set href(v: string) { hrefSetter(v) } },
      writable: true,
    })

    localStorage.setItem(TOKEN_KEY, 'expired-token')
    localStorage.setItem(REFRESH_TOKEN_KEY, 'bad-refresh-token')

    server.use(
      http.get('/api/v1/sensitive', () =>
        HttpResponse.json(
          { error: { code: 'UNAUTHORIZED', message: 'Expired' } },
          { status: 401 },
        ),
      ),
    )

    await expect(apiClient.get('/sensitive')).rejects.toBeDefined()
    expect(hrefSetter).toHaveBeenCalledWith('/login')
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull()
    expect(localStorage.getItem(USER_KEY)).toBeNull()

    locationSpy.mockRestore()
  })
})
