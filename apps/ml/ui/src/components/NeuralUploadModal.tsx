import { useState, useEffect, useRef } from 'react'
import {
  ShieldCheck, ShieldAlert, Loader2, X, Play, Volume2, VolumeX,
  Terminal, CheckCircle2, ArrowUpRight, Clock, AlertTriangle, Sparkles,
} from 'lucide-react'
import clsx from 'clsx'
import { streamSubmissionStatus, trainerSubmissionsApi } from '@/api/trainerSubmissions'
import type { TrainerSubmission } from '@/types/trainerSubmission'

// ── Sound helpers ─────────────────────────────────────────────────────────────

const SOUND_KEY = 'ml_scan_sound_enabled'

export function isSoundEnabled(): boolean {
  const v = localStorage.getItem(SOUND_KEY)
  return v === null || v === 'true'
}

export function setSoundEnabled(on: boolean) {
  localStorage.setItem(SOUND_KEY, on ? 'true' : 'false')
}

export function playApprovalSound() {
  if (!isSoundEnabled()) return
  try {
    const ctx = new AudioContext()
    const t = ctx.currentTime
    const freqs = [523.25, 659.25, 783.99] // C5, E5, G5 — ascending chime
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'sine'; osc.frequency.value = freq
      gain.gain.setValueAtTime(0, t + i * 0.13)
      gain.gain.linearRampToValueAtTime(0.16, t + i * 0.13 + 0.04)
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.13 + 0.45)
      osc.start(t + i * 0.13); osc.stop(t + i * 0.13 + 0.5)
    })
  } catch {}
}

export function playErrorSound() {
  if (!isSoundEnabled()) return
  try {
    const ctx = new AudioContext()
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(280, t)
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.3)
    gain.gain.setValueAtTime(0.13, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35)
    osc.start(t); osc.stop(t + 0.4)
  } catch {}
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  submission: TrainerSubmission
  fileName: string
  isUpgrade: boolean
  upgradeFrom?: string         // current active version name if upgrade
  onClose: () => void
  onApproved: () => void
  /** Called when user clicks "Run in background" — parent takes over the stream */
  onBackground: (subId: string, closeStream: () => void) => void
}

type Phase = 'scanning' | 'approved' | 'pending' | 'flagged' | 'rejected'

// ── Log line component ────────────────────────────────────────────────────────

function LogLine({ line, delay = 0 }: { line: string; delay?: number }) {
  const [show, setShow] = useState(delay === 0)
  useEffect(() => {
    if (delay > 0) {
      const t = setTimeout(() => setShow(true), delay)
      return () => clearTimeout(t)
    }
  }, [delay])
  if (!show) return null
  const isOk = line.startsWith('[OK]') || line.startsWith('✓')
  const isWarn = line.startsWith('[WARN]') || line.startsWith('⚠')
  const isErr = line.startsWith('[ERR]') || line.startsWith('✗')
  return (
    <div className={clsx('font-mono text-[11px] leading-5',
      isOk ? 'text-emerald-400' : isWarn ? 'text-amber-400' : isErr ? 'text-red-400' : 'text-gray-500'
    )}>
      {line}
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────

export default function NeuralUploadModal({
  submission: initialSub,
  fileName,
  isUpgrade,
  upgradeFrom,
  onClose,
  onApproved,
  onBackground,
}: Props) {
  const isFastPath = initialSub.fast_path === true

  const [sub, setSub] = useState<TrainerSubmission>(initialSub)
  const [phase, setPhase] = useState<Phase>(
    initialSub.status === 'approved' ? 'approved'
    : initialSub.status === 'flagged' ? 'flagged'
    : initialSub.status === 'rejected' ? 'rejected'
    : initialSub.status === 'pending_admin' ? 'pending'
    : 'scanning'
  )

  // Log lines: fast-path shows a "skipped scan" message; full scan shows progress
  const [logLines, setLogLines] = useState<string[]>(() => {
    if (isFastPath) {
      return [
        `[OK] File received: ${fileName}`,
        '[OK] Hash matches previously approved submission',
        '[OK] Security scan skipped — no changes detected',
        `✓ ${initialSub.trainer_name} is now active in your Neural Registry`,
      ]
    }
    return [
      `[OK] File received: ${fileName}`,
      '[OK] AST security gate: passed',
      '[..] Running security scan…',
    ]
  })
  const [soundOn, setSoundOn] = useState(isSoundEnabled)
  const closeStreamRef = useRef<(() => void) | null>(null)
  const soundFiredRef = useRef(false)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logLines])

  // Fast-path: already approved before modal opened — fire sound + callback immediately
  useEffect(() => {
    if (!isFastPath) return
    if (!soundFiredRef.current) {
      soundFiredRef.current = true
      playApprovalSound()
    }
    onApproved()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Open SSE stream (full scan path only)
  useEffect(() => {
    if (phase !== 'scanning' || isFastPath) return

    const close = streamSubmissionStatus(
      initialSub.id,
      (evt) => {
        setSub(prev => ({
          ...prev,
          status: evt.status,
          llm_scan_result: (evt.llm_scan_result ?? prev.llm_scan_result) as TrainerSubmission['llm_scan_result'],
        }))

        // Add log lines from scan events
        if (evt.message) {
          setLogLines(prev => [...prev, evt.message!])
        }
        if (evt.summary) {
          setLogLines(prev => [...prev, `[OK] ${evt.summary}`])
        }
      },
      (finalStatus) => {
        closeStreamRef.current = null
        setSub(prev => ({ ...prev, status: finalStatus }))

        const nextPhase: Phase =
          finalStatus === 'approved' ? 'approved'
          : finalStatus === 'flagged' ? 'flagged'
          : finalStatus === 'rejected' ? 'rejected'
          : 'pending'

        setPhase(nextPhase)

        if (nextPhase === 'approved') {
          setLogLines(prev => [
            ...prev,
            '[OK] LLM security scan: passed',
            '[OK] Registration complete',
            `✓ ${initialSub.trainer_name} is now active in your Neural Registry`,
          ])
          if (!soundFiredRef.current) {
            soundFiredRef.current = true
            playApprovalSound()
          }
          onApproved()
        } else {
          setLogLines(prev => [...prev, `[WARN] Scan result: ${finalStatus} — submitted for review`])
          if (!soundFiredRef.current) {
            soundFiredRef.current = true
            playErrorSound()
          }
        }
      },
      () => {
        // SSE connection dropped — poll for actual result instead of assuming pending
        setLogLines(prev => [...prev, '[..] Connection dropped — polling for result…'])
        let attempts = 0
        const maxAttempts = 10

        const applyTerminal = (status: TrainerSubmission['status'], scanResult?: TrainerSubmission['llm_scan_result']) => {
          setSub(prev => ({ ...prev, status, ...(scanResult ? { llm_scan_result: scanResult } : {}) }))
          const nextPhase: Phase =
            status === 'approved' ? 'approved'
            : status === 'flagged' ? 'flagged'
            : status === 'rejected' ? 'rejected'
            : 'pending'
          setPhase(nextPhase)
          if (nextPhase === 'approved') {
            setLogLines(prev => [
              ...prev,
              '[OK] LLM security scan: passed',
              '[OK] Registration complete',
              `✓ ${initialSub.trainer_name} is now active in your Neural Registry`,
            ])
            if (!soundFiredRef.current) { soundFiredRef.current = true; playApprovalSound() }
            onApproved()
          } else {
            setLogLines(prev => [...prev, `[WARN] Scan result: ${status} — submitted for review`])
            if (!soundFiredRef.current) { soundFiredRef.current = true; playErrorSound() }
          }
        }

        const poll = async () => {
          try {
            const latest = await trainerSubmissionsApi.get(initialSub.id)
            if (latest.status !== 'scanning') {
              applyTerminal(latest.status, latest.llm_scan_result)
              return
            }
          } catch {}
          attempts++
          if (attempts < maxAttempts) {
            setTimeout(poll, 3000)
          } else {
            applyTerminal('pending_admin')
            setLogLines(prev => [...prev, '[WARN] Could not confirm result — submitted for admin review'])
          }
        }

        setTimeout(poll, 2000)
      },
    )

    closeStreamRef.current = close
    return () => { close() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleBackground = () => {
    const close = closeStreamRef.current ?? (() => {})
    closeStreamRef.current = null
    onBackground(initialSub.id, close)
  }

  const scan = sub.llm_scan_result ?? {}
  const trainerName = sub.trainer_name

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-gray-950 border border-gray-800 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            {phase === 'scanning' && !isFastPath && <Loader2 size={18} className="text-brand-400 animate-spin" />}
            {phase === 'approved' && <ShieldCheck size={18} className="text-emerald-400" />}
            {(phase === 'flagged' || phase === 'pending') && <ShieldAlert size={18} className="text-amber-400" />}
            {phase === 'rejected' && <AlertTriangle size={18} className="text-red-400" />}
            <div>
              <div className="text-sm font-bold text-white">
                {phase === 'scanning' && 'Neural Security Scan'}
                {phase === 'approved' && (isUpgrade ? 'Neural Upgraded' : 'Neural Approved')}
                {phase === 'flagged' && 'Flagged for Review'}
                {phase === 'pending' && 'Pending Admin Review'}
                {phase === 'rejected' && 'Submission Rejected'}
              </div>
              <div className="text-[11px] text-gray-500 font-mono">{fileName}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Sound toggle */}
            <button
              onClick={() => { setSoundEnabled(!soundOn); setSoundOn(v => !v) }}
              className="p-1.5 rounded-lg text-gray-600 hover:text-gray-300 hover:bg-gray-800 transition-colors"
              title={soundOn ? 'Mute notifications' : 'Unmute notifications'}
            >
              {soundOn ? <Volume2 size={13} /> : <VolumeX size={13} />}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-600 hover:text-gray-300 hover:bg-gray-800 transition-colors">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Upgrade banner */}
        {isUpgrade && (
          <div className="mx-5 mt-4 flex items-center gap-3 bg-brand-900/30 border border-brand-800/50 rounded-xl px-4 py-2.5 flex-shrink-0">
            <ArrowUpRight size={14} className="text-brand-400 flex-shrink-0" />
            <div className="text-xs">
              <span className="text-brand-300 font-medium">Upgrade detected</span>
              {upgradeFrom && (
                <span className="text-brand-500 ml-1">
                  · replacing <span className="font-mono">{upgradeFrom}</span>
                </span>
              )}
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">

          {/* Approved state */}
          {phase === 'approved' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 bg-emerald-900/20 border border-emerald-800/40 rounded-xl px-4 py-3">
                <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-emerald-300">
                    {isUpgrade ? 'Neural upgraded successfully' : 'Neural is now active'}
                  </p>
                  <p className="text-[11px] text-emerald-500 mt-0.5 font-mono">{trainerName}</p>
                </div>
                {isUpgrade && <Sparkles size={14} className="text-brand-400 ml-auto" />}
              </div>
              {scan.summary && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 text-xs text-gray-400 leading-relaxed">
                  {scan.summary}
                </div>
              )}
            </div>
          )}

          {/* Flagged / Pending state */}
          {(phase === 'flagged' || phase === 'pending') && (
            <div className="space-y-3">
              <div className="flex items-start gap-3 bg-amber-900/20 border border-amber-800/40 rounded-xl px-4 py-3">
                <Clock size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-300">Submitted for admin review</p>
                  <p className="text-xs text-amber-500 mt-0.5">
                    {phase === 'flagged'
                      ? 'Security issues were detected. An admin will review and approve or reject your neural.'
                      : 'Your neural is awaiting manual review. You will be notified by email.'}
                  </p>
                </div>
              </div>
              {scan.summary && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 text-xs text-gray-400 leading-relaxed">
                  {scan.summary}
                </div>
              )}
              {(scan.issues as unknown[])?.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-1.5">Issues</p>
                  <div className="border-l-2 border-amber-800/50 pl-3 space-y-1">
                    {(scan.issues as unknown[]).map((issue, i) => (
                      <p key={i} className="text-xs text-amber-400">
                        · {typeof issue === 'string' ? issue : ((issue as Record<string, string>).detail || (issue as Record<string, string>).message)}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Rejected state */}
          {phase === 'rejected' && (
            <div className="flex items-start gap-3 bg-red-900/20 border border-red-800/40 rounded-xl px-4 py-3">
              <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-300">Submission Rejected</p>
                {sub.rejection_reason && (
                  <p className="text-xs text-red-400 mt-1 leading-relaxed">{sub.rejection_reason}</p>
                )}
              </div>
            </div>
          )}

          {/* Console log — always shown */}
          <div>
            <div className="flex items-center gap-1.5 text-[10px] text-gray-600 uppercase tracking-widest mb-2">
              <Terminal size={10} /> Console
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 space-y-0.5 min-h-[80px] max-h-40 overflow-y-auto">
              {logLines.map((line, i) => (
                <LogLine key={i} line={line} delay={phase === 'scanning' && i >= 3 ? (i - 2) * 200 : 0} />
              ))}
              {phase === 'scanning' && !isFastPath && (
                <div className="font-mono text-[11px] text-gray-600 flex items-center gap-1.5 mt-1">
                  <Loader2 size={9} className="animate-spin" /> scanning…
                </div>
              )}
              <div ref={logEndRef} />
            </div>
          </div>

          {scan.model_used && (
            <p className="text-[10px] text-gray-700 text-right">Scanned by: {scan.model_used}</p>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 pb-5 pt-3 border-t border-gray-800 flex items-center gap-3 flex-shrink-0">
          {phase === 'scanning' ? (
            <>
              <button
                onClick={handleBackground}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded-xl transition-colors"
              >
                <Play size={13} /> Run in background
              </button>
              <span className="text-xs text-gray-600">Modal will close — you'll be notified when done</span>
            </>
          ) : phase === 'approved' ? (
            <button
              onClick={onClose}
              className="flex-1 py-2 px-4 bg-brand-600 hover:bg-brand-500 text-white rounded-xl transition-colors text-sm font-medium"
            >
              {isUpgrade ? 'View in Neurals' : 'Got it'}
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="flex-1 py-2 px-4 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl transition-colors text-sm font-medium border border-gray-700"
              >
                Close
              </button>
              <a
                href="/submissions"
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-brand-400 hover:text-brand-300 transition-colors"
              >
                View submissions <ArrowUpRight size={12} />
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
