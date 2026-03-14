import Logo from './Logo'

interface Props {
  onPrivacy?: () => void
  onTerms?: () => void
  onApiDocs?: () => void
  onGettingStarted?: () => void
}

export default function PageFooter({ onPrivacy, onTerms, onApiDocs, onGettingStarted }: Props) {
  const year = new Date().getFullYear()
  return (
    <footer className="border-t border-gray-800 bg-gray-950 mt-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          {/* Brand */}
          <div className="flex flex-col gap-1.5">
            <Logo size="sm" />
            <div className="text-[10px] text-gray-700 pl-[38px]">Kreateyou Technologies Ltd, Kenya</div>
          </div>

          {/* Links */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-500">
            {onGettingStarted && (
              <button onClick={onGettingStarted} className="hover:text-gray-300 transition-colors">Getting Started</button>
            )}
            {onApiDocs && (
              <button onClick={onApiDocs} className="hover:text-gray-300 transition-colors">API Docs</button>
            )}
            {onPrivacy && (
              <button onClick={onPrivacy} className="hover:text-gray-300 transition-colors">Privacy Policy</button>
            )}
            {onTerms && (
              <button onClick={onTerms} className="hover:text-gray-300 transition-colors">Terms of Service</button>
            )}
            <a href="mailto:legal@kreateyou.com" className="hover:text-gray-300 transition-colors">Contact</a>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-gray-800/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px] text-gray-700">
          <span>© {year} Kreateyou Technologies Ltd. All rights reserved.</span>
          <span>Registered in Kenya · Built for Africa</span>
        </div>
      </div>
    </footer>
  )
}
