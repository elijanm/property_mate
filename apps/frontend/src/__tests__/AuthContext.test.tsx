import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import { AuthProvider, AuthContext } from '@/context/AuthContext'
import { useContext } from 'react'
import { TOKEN_KEY, REFRESH_TOKEN_KEY, USER_KEY } from '@/constants/storage'
import type { AuthUser } from '@/types/auth'

const mockUser: AuthUser = { user_id: 'u1', org_id: 'org1', role: 'owner', email: 'owner@test.com' }

function TestConsumer() {
  const ctx = useContext(AuthContext)!
  return (
    <div>
      <span data-testid="role">{ctx.user?.role ?? 'none'}</span>
      <span data-testid="token">{ctx.token ?? 'none'}</span>
      <button onClick={() => ctx.login('tok', mockUser, 'ref-tok')}>Login</button>
      <button onClick={ctx.logout}>Logout</button>
    </div>
  )
}

beforeEach(() => localStorage.clear())

describe('AuthContext', () => {
  it('starts with null user and token when localStorage is empty', () => {
    render(<AuthProvider><TestConsumer /></AuthProvider>)
    expect(screen.getByTestId('role').textContent).toBe('none')
    expect(screen.getByTestId('token').textContent).toBe('none')
  })

  it('reads initial state from localStorage', () => {
    localStorage.setItem(TOKEN_KEY, 'existing-token')
    localStorage.setItem(USER_KEY, JSON.stringify(mockUser))
    render(<AuthProvider><TestConsumer /></AuthProvider>)
    expect(screen.getByTestId('role').textContent).toBe('owner')
    expect(screen.getByTestId('token').textContent).toBe('existing-token')
  })

  it('login stores token, refresh token and user in localStorage', async () => {
    render(<AuthProvider><TestConsumer /></AuthProvider>)
    await userEvent.click(screen.getByText('Login'))
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok')
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('ref-tok')
    expect(JSON.parse(localStorage.getItem(USER_KEY)!)).toEqual(mockUser)
    expect(screen.getByTestId('role').textContent).toBe('owner')
  })

  it('logout clears all keys from localStorage and resets state', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok')
    localStorage.setItem(REFRESH_TOKEN_KEY, 'ref-tok')
    localStorage.setItem(USER_KEY, JSON.stringify(mockUser))
    render(<AuthProvider><TestConsumer /></AuthProvider>)

    await act(async () => {
      await userEvent.click(screen.getByText('Logout'))
    })

    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull()
    expect(localStorage.getItem(USER_KEY)).toBeNull()
    expect(screen.getByTestId('role').textContent).toBe('none')
  })
})
