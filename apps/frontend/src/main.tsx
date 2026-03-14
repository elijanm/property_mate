import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { OrgProvider } from './context/OrgContext'
import { ToastProvider } from './context/ToastContext'
import { useAuth } from './hooks/useAuth'
import './index.css'

function OrgProviderBridge({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  return <OrgProvider orgId={user?.org_id}>{children}</OrgProvider>
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <OrgProviderBridge>
          <ToastProvider>
            <App />
          </ToastProvider>
        </OrgProviderBridge>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
