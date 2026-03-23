import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { authApi } from '../api/auth'

interface User {
  email: string
  full_name: string
  role: string
  org_id: string
  is_onboarded: boolean
}

interface AuthCtx {
  user: User | null
  token: string | null
  pendingEmail: string | null   // set after register — triggers verification screen
  login: (email: string, password: string) => Promise<void>
  loginWithToken: (accessToken: string, refreshToken: string, user: User) => void
  register: (email: string, password: string, full_name: string, coupon_code?: string) => Promise<void>
  logout: () => void
  clearPending: () => void
  setOnboarded: () => void     // flip is_onboarded = true in state + localStorage
  loading: boolean
}

const Ctx = createContext<AuthCtx>({} as AuthCtx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const t = localStorage.getItem('ml_token')
    const u = localStorage.getItem('ml_user')
    if (t && u) {
      try { setToken(t); setUser(JSON.parse(u)) } catch {}
    }
    setLoading(false)
  }, [])

  const login = async (email: string, password: string) => {
    const res = await authApi.login(email, password)
    localStorage.setItem('ml_token', res.access_token)
    localStorage.setItem('ml_refresh', res.refresh_token)
    localStorage.setItem('ml_user', JSON.stringify(res.user))
    setToken(res.access_token)
    setUser(res.user)
    setPendingEmail(null)
  }

  const loginWithToken = (accessToken: string, refreshToken: string, userData: User) => {
    localStorage.setItem('ml_token', accessToken)
    localStorage.setItem('ml_refresh', refreshToken)
    localStorage.setItem('ml_user', JSON.stringify(userData))
    setToken(accessToken)
    setUser(userData)
    setPendingEmail(null)
  }

  const register = async (email: string, password: string, full_name: string, coupon_code = '') => {
    const res = await authApi.register(email, password, full_name, coupon_code)
    if (res.pending_verification) {
      setPendingEmail(email)
    } else {
      // Admin-created or skip_verification path
      await login(email, password)
    }
  }

  const logout = () => {
    localStorage.removeItem('ml_token')
    localStorage.removeItem('ml_refresh')
    localStorage.removeItem('ml_user')
    setToken(null)
    setUser(null)
    setPendingEmail(null)
  }

  const clearPending = () => setPendingEmail(null)

  const setOnboarded = () => {
    if (!user) return
    const updated = { ...user, is_onboarded: true }
    localStorage.setItem('ml_user', JSON.stringify(updated))
    setUser(updated)
  }

  return (
    <Ctx.Provider value={{ user, token, pendingEmail, login, loginWithToken, register, logout, clearPending, setOnboarded, loading }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() {
  return useContext(Ctx)
}
