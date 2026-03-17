import { useState, useEffect, useCallback } from 'react'
import { trackPageView } from './utils/analytics'
import { trainersApi } from './api/trainers'
import { authApi } from './api/auth'
import type { ModelDeployment } from './types/trainer'
import ModelGrid from './components/ModelGrid'
import ModelWorkspace from './components/ModelWorkspace'
import LiveFeed from './components/LiveFeed'
import JobsPanel from './components/JobsPanel'
import TrainersPage from './components/TrainersPage'
import DeployPage from './components/DeployPage'
import TrainingPage from './components/TrainingPage'
import ConfigPage from './components/ConfigPage'
import InferenceLogsPage from './components/InferenceLogsPage'
import MonitoringPage from './components/MonitoringPage'
import SecurityPage from './components/SecurityPage'
import ABTestPage from './components/ABTestPage'
import AlertRulesPage from './components/AlertRulesPage'
import ApiKeysPage from './components/ApiKeysPage'
import BatchPage from './components/BatchPage'
import AuditLogPage from './components/AuditLogPage'
import ExperimentsPage from './components/ExperimentsPage'
import UsersPage from './components/UsersPage'
import WalletPage from './pages/WalletPage'
import AdminAnalyticsPage from './pages/AdminAnalyticsPage'
import BillingSettingsPage from './components/BillingSettingsPage'
import UsageTrackerPage from './pages/UsageTrackerPage'
import DatasetPage from './pages/DatasetPage'
import AnnotatePage from './pages/AnnotatePage'
import CodeEditorPage from './pages/CodeEditorPage'
import CollectPage from './pages/CollectPage'
import StaffPage from './pages/StaffPage'
import AnnotatorPortalPage from './pages/AnnotatorPortalPage'
import ClaimAccountPage from './pages/ClaimAccountPage'
import { walletApi } from './api/wallet'
import type { Wallet as WalletData } from './types/wallet'
import { useAuth } from './context/AuthContext'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import VerifyEmailPage from './pages/VerifyEmailPage'
import LandingPage from './pages/LandingPage'
import GettingStartedPage from './pages/GettingStartedPage'
import ApiDocsPage from './pages/ApiDocsPage'
import PrivacyPolicyPage from './pages/PrivacyPolicyPage'
import TermsPage from './pages/TermsPage'
import CookieConsent from './components/CookieConsent'
import {
  Brain, RefreshCw, Cpu, LayoutGrid, BookOpen,
  Upload, Play, Settings, List, Activity, Shield,
  FlaskConical, Bell, Key, Layers, ClipboardList, GitCompare,
  LogOut, User, Loader2, Users, Wallet, BarChart2, Database, Code2,
  ChevronRight, ChevronDown, DollarSign, Pencil, UserCheck,
} from 'lucide-react'
import Logo from './components/Logo'
import clsx from 'clsx'

// Read tokens once at module level — immune to StrictMode double-render and URL-cleanup effect race
const _params = new URLSearchParams(window.location.search)
const _RESET_TOKEN_FROM_URL  = _params.get('reset_token')
const _VERIFY_TOKEN_FROM_URL = _params.get('token') ?? _params.get('verify_token')
const _INVITE_TOKEN_FROM_URL = _params.get('invite')
// Store invite token for the register flow to pick up
if (_INVITE_TOKEN_FROM_URL) {
  sessionStorage.setItem('pending_invite_token', _INVITE_TOKEN_FROM_URL)
}

type Page = 'models' | 'trainers' | 'editor' | 'annotate' | 'deploy' | 'training' | 'jobs' | 'logs' | 'config' | 'monitoring' | 'security' | 'ab-tests' | 'alerts' | 'api-keys' | 'batch' | 'experiments' | 'audit' | 'users' | 'wallet' | 'analytics' | 'datasets' | 'billing' | 'usage' | 'staff'

type NavGroup = {
  id: string
  label: string
  icon: React.ReactNode  // for rail mode
  items: { id: Page; label: string; icon: React.ReactNode; roles?: string[] }[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'build',
    label: 'Build',
    icon: <Code2 size={16} />,
    items: [
      { id: 'datasets',    label: 'Datasets',     icon: <Database size={14} /> },
      { id: 'annotate',    label: 'Annotate',     icon: <Pencil size={14} /> },
      { id: 'editor',      label: 'Code Editor',  icon: <Code2 size={14} />, roles: ['engineer', 'admin'] },
      { id: 'trainers',    label: 'Trainers',     icon: <Brain size={14} />, roles: ['engineer', 'admin'] },
      { id: 'experiments', label: 'Experiments',  icon: <GitCompare size={14} />, roles: ['engineer', 'admin'] },
    ],
  },
  {
    id: 'deploy',
    label: 'Deploy',
    icon: <Upload size={16} />,
    items: [
      { id: 'models',   label: 'Models',  icon: <LayoutGrid size={14} /> },
      { id: 'deploy',   label: 'Deploy',  icon: <Upload size={14} />, roles: ['engineer', 'admin'] },
      { id: 'batch',    label: 'Batch',   icon: <Layers size={14} />, roles: ['engineer', 'admin'] },
    ],
  },
  {
    id: 'observe',
    label: 'Observe',
    icon: <Activity size={16} />,
    items: [
      { id: 'training',   label: 'Training',    icon: <Play size={14} /> },
      { id: 'jobs',       label: 'Jobs',         icon: <Cpu size={14} /> },
      { id: 'logs',       label: 'Inferences',   icon: <List size={14} /> },
      { id: 'monitoring', label: 'Monitoring',   icon: <Activity size={14} /> },
      { id: 'ab-tests',   label: 'A/B Tests',    icon: <FlaskConical size={14} /> },
      { id: 'alerts',     label: 'Alert Rules',  icon: <Bell size={14} /> },
      { id: 'usage',      label: 'Usage',         icon: <BarChart2 size={14} /> },
    ],
  },
  {
    id: 'team',
    label: 'Team',
    icon: <Users size={16} />,
    items: [
      { id: 'staff', label: 'Staff', icon: <UserCheck size={14} /> },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: <Shield size={16} />,
    items: [
      { id: 'users',     label: 'Users',     icon: <Users size={14} /> },
      { id: 'security',  label: 'Security',  icon: <Shield size={14} /> },
      { id: 'audit',     label: 'Audit Log', icon: <ClipboardList size={14} /> },
      { id: 'analytics', label: 'Analytics', icon: <BarChart2 size={14} /> },
      { id: 'billing',   label: 'Billing',   icon: <DollarSign size={14} /> },
      { id: 'api-keys',  label: 'API Keys',  icon: <Key size={14} /> },
      { id: 'config',    label: 'Config',    icon: <Settings size={14} /> },
    ],
  },
]

// Keep the old NAV for any legacy use - derive it from groups
const NAV = NAV_GROUPS.flatMap(g => g.items)

const PAGE_TITLE: Record<Page, string> = {
  models:      'Model Deployments',
  trainers:    'Trainer Plugins',
  editor:      'Code Editor',
  deploy:      'Deploy Model',
  training:    'Training',
  jobs:        'All Jobs',
  logs:        'Inference Logs',
  config:      'Training Config',
  monitoring:  'Model Monitoring',
  security:    'Security',
  'ab-tests':  'A/B Tests',
  alerts:      'Alert Rules',
  'api-keys':  'API Keys',
  batch:       'Batch Inference',
  experiments: 'Experiments',
  audit:       'Audit Log',
  users:       'User Management',
  analytics:   'Platform Analytics',
  datasets:    'Datasets',
  annotate:    'Auto-Annotate',
  wallet:      'Wallet',
  billing:     'Billing Settings',
  usage:       'Usage Tracker',
  staff:       'Staff Management',
}

export default function App() {
  const { user, logout, loading: authLoading, pendingEmail, clearPending, login } = useAuth()

  // Annotator session — stored separately from engineer/admin session
  const [annotatorUser, setAnnotatorUser] = useState(() => {
    try {
      const raw = localStorage.getItem('ml_annotator_user')
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  })
  const logoutAnnotator = () => {
    localStorage.removeItem('ml_annotator_token')
    localStorage.removeItem('ml_annotator_refresh')
    localStorage.removeItem('ml_annotator_user')
    setAnnotatorUser(null)
  }
  const [resetToken, setResetToken] = useState<string | null>(_RESET_TOKEN_FROM_URL)
  const [authPage, setAuthPage] = useState<'login' | 'register' | 'landing' | 'getting-started' | 'api-docs' | 'privacy' | 'terms' | 'forgot-password' | 'reset-password'>(
    _RESET_TOKEN_FROM_URL ? 'reset-password' : _INVITE_TOKEN_FROM_URL ? 'register' : 'landing'
  )
  const [docsSection, setDocsSection] = useState<string | undefined>()
  const [linkVerifying, setLinkVerifying] = useState(false)
  const [linkEmail, setLinkEmail] = useState('')

  // Clean URL of any token params on mount
  useEffect(() => {
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  // Handle ?token= query param for link-click activation
  useEffect(() => {
    if (!_VERIFY_TOKEN_FROM_URL) return
    setLinkVerifying(true)
    authApi.verifyToken(_VERIFY_TOKEN_FROM_URL)
      .then(res => { setLinkEmail(res.email); setLinkVerifying(false) })
      .catch(() => setLinkVerifying(false))
  }, [])

  const [deployments, setDeployments] = useState<ModelDeployment[]>([])
  const [selected, setSelected] = useState<ModelDeployment | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [page, setPage] = useState<Page>('models')
  const [trainingInitTrainer, setTrainingInitTrainer] = useState<string | undefined>()
  const [wallet, setWallet] = useState<WalletData | null>(null)
  const [navLayout, setNavLayout] = useState<1 | 2 | 3>(3)
  const [railActiveGroup, setRailActiveGroup] = useState<string>('build')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(['admin']))

  const refreshWallet = useCallback(() => {
    walletApi.get().then(setWallet).catch(() => {})
  }, [])

  const load = async () => {
    setRefreshing(true)
    try {
      const data = await trainersApi.listDeployments()
      setDeployments(data)
    } catch {}
    finally { setRefreshing(false); setLoading(false) }
  }

  useEffect(() => { load() }, [])
  useEffect(() => { if (user) refreshWallet() }, [user, refreshWallet])
  useEffect(() => {
    if (!user) return
    import('./api/config').then(m => {
      m.configApi.getUiConfig().then(d => setNavLayout(d.nav_layout as 1 | 2 | 3)).catch(() => {})
    })
  }, [user])

  const handleDeleteDeployment = async (id: string) => {
    await trainersApi.deleteDeployment(id)
    setDeployments(prev => prev.filter(d => d.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  const navigate = (p: Page) => {
    // Viewers cannot access editor page
    const target = (p === 'editor' && user?.role === 'viewer') ? 'models' : p
    setPage(target)
    setSelected(null)
    // sync rail active group to the group containing the page
    const group = NAV_GROUPS.find(g => g.items.some(i => i.id === target))
    if (group) setRailActiveGroup(group.id)
    if (target === 'wallet') refreshWallet()
    if (target === 'models') load()
    trackPageView(`/${target}`)
  }

  const handleTrainingCompleted = async (trainerName: string) => {
    setRefreshing(true)
    try {
      const data = await trainersApi.listDeployments()
      setDeployments(data)
      const newDep = data.find(d => d.trainer_name === trainerName && d.is_default)
        ?? data.find(d => d.trainer_name === trainerName)
      if (newDep) {
        setPage('models')
        setSelected(newDep)
      }
    } catch {}
    finally { setRefreshing(false) }
  }

  const title = selected ? selected.mlflow_model_name : PAGE_TITLE[page]
  const subtitle = selected
    ? `Trainer: ${selected.trainer_name}`
    : page === 'models'
      ? `${deployments.length} deployed model${deployments.length !== 1 ? 's' : ''}`
      : ''

  // Public collect page — /collect/<token> or #collect/<token>
  const collectToken = (() => {
    const hash = window.location.hash.replace('#', '')
    if (hash.startsWith('collect/')) return hash.slice(8)
    const path = window.location.pathname
    const m = path.match(/\/collect\/([^/]+)/)
    return m ? m[1] : null
  })()
  if (collectToken) return <CollectPage token={collectToken} />

  // Claim account page — /claim/<collector_token>
  const claimToken = (() => {
    const hash = window.location.hash.replace('#', '')
    if (hash.startsWith('claim/')) return hash.slice(6)
    const m = window.location.pathname.match(/\/claim\/([^/]+)/)
    return m ? m[1] : null
  })()
  if (claimToken) return <ClaimAccountPage token={claimToken} />

  // Reset password link — show form regardless of auth state
  if (resetToken && authPage === 'reset-password') {
    return <ResetPasswordPage token={resetToken} onDone={() => { setResetToken(null); setAuthPage('login') }} />
  }

  if (authLoading || linkVerifying) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-gray-600" />
      </div>
    )
  }

  // Link-click activated — show "all done, sign in"
  if (linkEmail) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 max-w-sm w-full text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-green-900/30 border border-green-700/40 flex items-center justify-center mx-auto">
            <span className="text-2xl">✓</span>
          </div>
          <div>
            <div className="text-white font-semibold text-lg">Account activated!</div>
            <div className="text-sm text-gray-500 mt-1">{linkEmail}</div>
          </div>
          <button
            onClick={() => { setLinkEmail(''); setAuthPage('login') }}
            className="w-full bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-lg py-2.5 transition-colors"
          >
            Sign in
          </button>
        </div>
      </div>
    )
  }

  if (!user) {
    // Annotator with separate session (no engineer login) → show annotator portal
    if (annotatorUser) {
      return <AnnotatorPortalPage onLogout={logoutAnnotator} />
    }
    if (pendingEmail) {
      return (
        <VerifyEmailPage
          email={pendingEmail}
          onVerified={() => { clearPending(); setAuthPage('login') }}
          onBack={() => { clearPending(); setAuthPage('login') }}
        />
      )
    }
    if (authPage === 'getting-started') {
      return (
        <GettingStartedPage
          onBack={() => setAuthPage('landing')}
          onSignIn={() => setAuthPage('login')}
          onApiDocs={(section) => { setDocsSection(section); setAuthPage('api-docs') }}
          onPrivacy={() => setAuthPage('privacy')}
          onTerms={() => setAuthPage('terms')}
        />
      )
    }
    if (authPage === 'api-docs') {
      return (
        <ApiDocsPage
          onBack={() => setAuthPage('landing')}
          onSignIn={() => setAuthPage('login')}
          onGettingStarted={() => setAuthPage('getting-started')}
          onPrivacy={() => setAuthPage('privacy')}
          onTerms={() => setAuthPage('terms')}
          initialSection={docsSection}
        />
      )
    }
    if (authPage === 'privacy') {
      return <PrivacyPolicyPage onBack={() => setAuthPage('landing')} onTerms={() => setAuthPage('terms')} />
    }
    if (authPage === 'terms') {
      return <TermsPage onBack={() => setAuthPage('landing')} onPrivacy={() => setAuthPage('privacy')} />
    }
    if (authPage === 'landing') {
      return (
        <>
          <LandingPage
            onSignIn={() => setAuthPage('login')}
            onGetStarted={() => setAuthPage('register')}
            onApiDocs={() => { setDocsSection(undefined); setAuthPage('api-docs') }}
            onGettingStarted={() => setAuthPage('getting-started')}
            onPrivacy={() => setAuthPage('privacy')}
            onTerms={() => setAuthPage('terms')}
          />
          <CookieConsent onViewPolicy={() => setAuthPage('privacy')} />
        </>
      )
    }
    if (authPage === 'forgot-password') {
      return <ForgotPasswordPage onBack={() => setAuthPage('login')} />
    }
    if (authPage === 'reset-password' && resetToken) {
      return <ResetPasswordPage token={resetToken} onDone={() => { setResetToken(null); setAuthPage('login') }} />
    }
    return authPage === 'login'
      ? <LoginPage onGoRegister={() => setAuthPage('register')} onForgotPassword={() => setAuthPage('forgot-password')} />
      : <RegisterPage onGoLogin={() => setAuthPage('login')} />
  }

  // Legacy: annotator token stored in main session — show annotator portal
  if (user?.role === 'annotator') {
    return <AnnotatorPortalPage onLogout={logout} />
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950">
      {/* Sidebar */}
      <aside className={clsx(
        'flex-shrink-0 border-r border-gray-800 flex flex-col',
        navLayout === 3 ? 'w-56' : 'w-52'
      )}>
        {/* Logo */}
        <div className="px-4 py-4 border-b border-gray-800">
          <Logo size="sm" tld={true} />
        </div>

        {/* Nav — layout 1: grouped flat */}
        {navLayout === 1 && (
          <nav className="flex-1 p-3 overflow-y-auto space-y-4">
            {NAV_GROUPS.filter(g => g.id !== 'admin' || user?.role === 'admin').map(group => (
              <div key={group.id}>
                <div className="px-3 pb-1 text-[10px] font-semibold text-gray-600 uppercase tracking-wider">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.items.filter(i => !i.roles || i.roles.includes(user?.role ?? '')).map(item => (
                    <button key={item.id} onClick={() => navigate(item.id)}
                      className={clsx('w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors',
                        page === item.id && !selected ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'
                      )}>
                      {item.icon} {item.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        )}

        {/* Nav — layout 2: collapsible groups */}
        {navLayout === 2 && (
          <nav className="flex-1 p-3 overflow-y-auto space-y-1">
            {NAV_GROUPS.filter(g => g.id !== 'admin' || user?.role === 'admin').map(group => {
              const isCollapsed = collapsedGroups.has(group.id)
              const hasActive = group.items.some(i => i.id === page)
              return (
                <div key={group.id}>
                  <button
                    onClick={() => setCollapsedGroups(prev => {
                      const next = new Set(prev)
                      next.has(group.id) ? next.delete(group.id) : next.add(group.id)
                      return next
                    })}
                    className={clsx(
                      'w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors',
                      hasActive ? 'text-brand-400' : 'text-gray-500 hover:text-gray-300'
                    )}
                  >
                    {isCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                    {group.label}
                  </button>
                  {!isCollapsed && (
                    <div className="space-y-0.5 mt-0.5 mb-1">
                      {group.items.filter(i => !i.roles || i.roles.includes(user?.role ?? '')).map(item => (
                        <button key={item.id} onClick={() => navigate(item.id)}
                          className={clsx('w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors',
                            page === item.id && !selected ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'
                          )}>
                          {item.icon} {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>
        )}

        {/* Nav — layout 3: icon rail + flyout panel */}
        {navLayout === 3 && (
          <div className="flex flex-1 min-h-0">
            {/* Rail */}
            <div className="w-12 flex-shrink-0 flex flex-col items-center py-2 gap-1 border-r border-gray-800">
              {NAV_GROUPS.filter(g => g.id !== 'admin' || user?.role === 'admin').map(group => {
                const isActive = railActiveGroup === group.id
                const hasPageActive = group.items.some(i => i.id === page)
                return (
                  <button
                    key={group.id}
                    onClick={() => setRailActiveGroup(group.id)}
                    title={group.label}
                    className={clsx(
                      'w-9 h-9 flex flex-col items-center justify-center rounded-lg transition-colors gap-0.5',
                      isActive
                        ? 'bg-gray-800 text-white'
                        : hasPageActive
                        ? 'text-brand-400 hover:bg-gray-900'
                        : 'text-gray-600 hover:bg-gray-900 hover:text-gray-300'
                    )}
                  >
                    {group.icon}
                    <span className="text-[8px] leading-none">{group.label}</span>
                  </button>
                )
              })}
            </div>
            {/* Flyout items */}
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {(NAV_GROUPS.find(g => g.id === railActiveGroup)?.items ?? []).filter(i => !i.roles || i.roles.includes(user?.role ?? '')).map(item => (
                <button key={item.id} onClick={() => navigate(item.id)}
                  className={clsx('w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors',
                    page === item.id && !selected ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'
                  )}>
                  {item.icon} {item.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Live feed */}
        <div className="border-t border-gray-800 h-56 overflow-hidden flex-shrink-0">
          <LiveFeed trainerFilter={selected?.trainer_name} />
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-800 space-y-2 flex-shrink-0">
          {/* Wallet balance */}
          {wallet && (
            <button onClick={() => navigate('wallet')}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-brand-700 transition-colors group mb-1">
              <div className="flex items-center gap-1.5">
                <Wallet size={11} className="text-gray-500 group-hover:text-brand-400 transition-colors" />
                <span className="text-[11px] text-gray-400 group-hover:text-gray-200 transition-colors">Wallet</span>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-semibold text-white">${wallet.balance.toFixed(2)} USD</div>
                <div className="text-[9px] text-gray-500 flex gap-1.5">
                  {wallet.standard_balance > 0 && (
                    <span className="text-sky-500">${wallet.standard_balance.toFixed(2)} std</span>
                  )}
                  {wallet.general_balance > 0 && (
                    <span className="text-violet-400">${wallet.general_balance.toFixed(2)} accel</span>
                  )}
                </div>
                {wallet.reserved > 0 && (
                  <div className="text-[9px] text-amber-500">${wallet.reserved.toFixed(2)} held</div>
                )}
              </div>
            </button>
          )}
          {/* User info */}
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full bg-brand-700 flex items-center justify-center flex-shrink-0">
              <User size={11} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-gray-300 truncate">{user.email}</div>
              <div className="text-[10px] text-gray-600 capitalize">{user.role}</div>
            </div>
            <button onClick={logout} title="Sign out" className="text-gray-600 hover:text-red-400 transition-colors">
              <LogOut size={12} />
            </button>
          </div>
          <a href="/plugin-guide.html" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-brand-400 transition-colors">
            <BookOpen size={11} /> Plugin Developer Guide
          </a>
          {user?.role === 'admin' && (
            <div className="space-y-1">
              <div className="text-[10px] text-gray-600 uppercase tracking-wider">Nav Layout</div>
              <div className="flex gap-1">
                {([1, 2, 3] as const).map(n => (
                  <button
                    key={n}
                    onClick={() => {
                      setNavLayout(n)
                      import('./api/config').then(m => m.configApi.updateConfig({ nav_layout: n }).catch(() => {}))
                    }}
                    title={n === 1 ? 'Grouped flat' : n === 2 ? 'Collapsible groups' : 'Icon rail'}
                    className={clsx(
                      'flex-1 py-1 text-[10px] rounded border transition-colors',
                      navLayout === n
                        ? 'bg-brand-900/50 border-brand-600 text-brand-300'
                        : 'bg-gray-900 border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-700'
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-[10px] text-gray-700">
            <Cpu size={10} /> PMS ML Service · port 8030
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
          <div className="flex items-center gap-3">
            {selected && (
              <button onClick={() => setSelected(null)} className="text-gray-500 hover:text-gray-300 text-xs flex items-center gap-1">
                Models <span className="text-gray-700">›</span>
              </button>
            )}
            <div>
              <h1 className="text-base font-bold text-white">{title}</h1>
              {subtitle && <p className="text-xs text-gray-600 mt-0.5">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Wallet chip */}
            {wallet && (
              <button onClick={() => navigate('wallet')}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                  page === 'wallet'
                    ? 'bg-brand-900/40 border-brand-700 text-brand-300'
                    : 'bg-gray-900 border-gray-700 text-gray-300 hover:border-brand-700 hover:text-brand-300'
                )}>
                <Wallet size={12} />
                ${wallet.balance.toFixed(2)} USD
                {wallet.standard_balance > 0 && (
                  <span className="text-[10px] text-sky-400 font-normal">{wallet.standard_balance.toFixed(2)} std</span>
                )}
                {wallet.reserved > 0 && (
                  <span className="text-[10px] text-amber-500 font-normal">·${wallet.reserved.toFixed(2)} held</span>
                )}
              </button>
            )}
            {page === 'models' && !selected && (
              <button onClick={load} disabled={refreshing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded-lg transition-colors disabled:opacity-40">
                <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
              </button>
            )}
          </div>
        </header>

        {/* Beta banner */}
        <div className="flex items-center gap-2.5 px-6 py-2 bg-amber-950/40 border-b border-amber-800/30 flex-shrink-0">
          <span className="text-[10px] font-bold text-amber-500 bg-amber-900/50 border border-amber-700/40 rounded px-1.5 py-0.5 flex-shrink-0">BETA</span>
          <p className="text-[11px] text-amber-200/50 flex-1">
            You're on an early beta — some features may be unstable.{' '}
            <a href="mailto:support@mldock.io?subject=MLDock%20Beta%20Report"
              className="text-amber-400/80 hover:text-amber-300 underline underline-offset-2 transition-colors">
              Report an issue
            </a>
          </p>
        </div>

        {/* Content */}
        <div className={clsx('flex-1 min-h-0', (page === 'editor' || page === 'annotate') && !selected ? 'overflow-hidden flex flex-col' : 'overflow-y-auto')}>
          {selected ? (
            <ModelWorkspace deployment={selected} onClose={() => setSelected(null)} />
          ) : page === 'editor' && user?.role !== 'viewer' ? (
            <CodeEditorPage />
          ) : page === 'annotate' ? (
            <div className="flex-1 min-h-0 p-6 overflow-hidden flex flex-col">
              <AnnotatePage />
            </div>
          ) : (
            <div className="p-6">
              {page === 'models' && (
                <ModelGrid deployments={deployments} onSelect={setSelected} onDelete={handleDeleteDeployment} loading={loading} />
              )}
              {page === 'trainers' && (
                <TrainersPage onStartTraining={(name) => { setTrainingInitTrainer(name); navigate('training') }} onGoDatasets={() => navigate('datasets')} />
              )}
              {page === 'deploy' && (
                <DeployPage onJobCreated={() => navigate('jobs')} />
              )}
              {page === 'training' && <TrainingPage onJobCompleted={handleTrainingCompleted} initialTrainer={trainingInitTrainer} />}
              {page === 'jobs' && <JobsPanel />}
              {page === 'logs' && <InferenceLogsPage />}
              {page === 'monitoring' && <MonitoringPage />}
              {page === 'security' && <SecurityPage />}
              {page === 'config' && <ConfigPage />}
              {page === 'ab-tests' && <ABTestPage />}
              {page === 'alerts' && <AlertRulesPage />}
              {page === 'api-keys' && <ApiKeysPage />}
              {page === 'batch' && <BatchPage />}
              {page === 'experiments' && <ExperimentsPage />}
              {page === 'audit' && <AuditLogPage />}
              {page === 'users' && <UsersPage />}
              {page === 'analytics' && <AdminAnalyticsPage />}
              {page === 'datasets' && <DatasetPage />}
              {page === 'wallet' && <WalletPage />}
              {page === 'billing' && <BillingSettingsPage />}
              {page === 'usage' && <UsageTrackerPage />}
              {page === 'staff' && <StaffPage />}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
