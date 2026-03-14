import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { AuthContext } from '@/context/AuthContext'
import ProtectedRoute from '@/components/ProtectedRoute'
import type { AuthUser } from '@/types/auth'

function makeContext(user: AuthUser | null) {
  return {
    user,
    token: user ? 'mock-token' : null,
    login: () => {},
    logout: () => {},
  }
}

function renderWithRouter(user: AuthUser | null, allowedRoles: string[]) {
  return render(
    <AuthContext.Provider value={makeContext(user)}>
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route
            path="/protected"
            element={
              <ProtectedRoute allowedRoles={allowedRoles}>
                <div>Protected content</div>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<div>Login page</div>} />
          <Route path="/forbidden" element={<div>Forbidden page</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('ProtectedRoute', () => {
  it('redirects unauthenticated users to /login', () => {
    renderWithRouter(null, ['owner'])
    expect(screen.getByText('Login page')).toBeInTheDocument()
  })

  it('redirects authenticated users with wrong role to /forbidden', () => {
    const agent: AuthUser = { user_id: 'u1', org_id: 'org1', role: 'agent' }
    renderWithRouter(agent, ['owner'])
    expect(screen.getByText('Forbidden page')).toBeInTheDocument()
  })

  it('renders children for authenticated user with correct role', () => {
    const owner: AuthUser = { user_id: 'u1', org_id: 'org1', role: 'owner' }
    renderWithRouter(owner, ['owner'])
    expect(screen.getByText('Protected content')).toBeInTheDocument()
  })

  it('allows access when role is in multiple allowed roles', () => {
    const agent: AuthUser = { user_id: 'u1', org_id: 'org1', role: 'agent' }
    renderWithRouter(agent, ['owner', 'agent'])
    expect(screen.getByText('Protected content')).toBeInTheDocument()
  })
})
