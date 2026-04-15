/**
 * CalendlyModal — inline Calendly embed inside a modal overlay.
 *
 * Usage:
 *   <CalendlyModal open={open} onClose={() => setOpen(false)} />
 *
 * Update CALENDLY_URL below with your actual Calendly link.
 */

import { useEffect } from 'react'

const CALENDLY_URL = import.meta.env.VITE_CALENDLY_URL as string | undefined

interface Props {
  open: boolean
  onClose: () => void
}

export default function CalendlyModal({ open, onClose }: Props) {
  // Prevent body scroll while modal is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!open) return null

  if (!CALENDLY_URL) {
    console.warn('CalendlyModal: VITE_CALENDLY_URL is not set in your .env file.')
    return null
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-2xl"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <p className="text-sm font-bold text-gray-900">Book a Demo</p>
            <p className="text-xs text-gray-500 mt-0.5">30-minute walkthrough with our team. Pick a time that works for you.</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Calendly iframe */}
        <div style={{ height: 'calc(90vh - 72px)' }}>
          <iframe
            src={`${CALENDLY_URL}?hide_gdpr_banner=1&primary_color=1d4ed8`}
            width="100%"
            height="100%"
            frameBorder="0"
            title="Book a demo with FahariCloud"
          />
        </div>
      </div>
    </div>
  )
}
