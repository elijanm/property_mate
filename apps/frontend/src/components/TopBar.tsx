import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import NotificationCenter from '@/components/NotificationCenter'
import UserAvatarMenu from '@/components/UserAvatarMenu'
import AskAIPanel from '@/components/AskAIPanel'

interface TopBarProps {
  /** Passed by PropertyWorkspaceLayout so the AI panel gets the correct property context */
  propertyId?: string
  propertyName?: string
}

export default function TopBar({ propertyId, propertyName }: TopBarProps) {
  const { logout } = useAuth()
  const [aiOpen, setAiOpen] = useState(false)

  return (
    <>
      <header className="h-14 bg-white border-b border-gray-100 flex items-center justify-end px-5 gap-2.5 shrink-0">
        {/* Ask AI */}
        <button
          onClick={() => setAiOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white rounded-lg bg-gradient-to-r from-violet-500 to-indigo-500 hover:opacity-90 transition-opacity"
        >
          <span className="text-[11px]">✦</span>
          Ask AI
        </button>

        {/* Notifications */}
        <NotificationCenter />

        {/* User avatar with wallet ring */}
        <UserAvatarMenu onLogout={logout} />
      </header>

      {aiOpen && (
        <AskAIPanel
          onClose={() => setAiOpen(false)}
          propertyId={propertyId}
          propertyName={propertyName}
        />
      )}
    </>
  )
}
