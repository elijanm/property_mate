import { CALL_SOUND_KEY, NOTIFICATION_SOUND_KEY, WHATSAPP_SOUND_KEY } from '@/constants/storage'

/**
 * Plays a short notification tone using the Web Audio API (no audio files needed).
 * Checks localStorage NOTIFICATION_SOUND_KEY before playing.
 */
export function useSound() {
  function playNotificationSound() {
    if (localStorage.getItem(NOTIFICATION_SOUND_KEY) !== 'true') return
    try {
      const ctx = new AudioContext()
      const schedule = () => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.type = 'sine'
        osc.frequency.setValueAtTime(440, ctx.currentTime)
        osc.frequency.linearRampToValueAtTime(880, ctx.currentTime + 0.1)
        gain.gain.setValueAtTime(0.3, ctx.currentTime)
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15)
        osc.start(ctx.currentTime)
        osc.stop(ctx.currentTime + 0.15)
        osc.onended = () => ctx.close()
      }
      if (ctx.state === 'suspended') ctx.resume().then(schedule).catch(() => ctx.close())
      else schedule()
    } catch {
      // AudioContext not available (SSR / restricted env) — silently ignore
    }
  }

  /**
   * Plays an urgent phone-ring pattern (3 double-pulses) when an incoming call arrives.
   * Checks localStorage CALL_SOUND_KEY before playing.
   */
  function playCallSound() {
    if (localStorage.getItem(CALL_SOUND_KEY) !== 'true') return
    try {
      const ctx = new AudioContext()
      const t0 = ctx.currentTime
      // Three ring pulses: high burst → short pause → high burst, repeated
      for (let i = 0; i < 3; i++) {
        const start = t0 + i * 0.7
        for (let j = 0; j < 2; j++) {
          const pulseStart = start + j * 0.25
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.type = 'sine'
          osc.frequency.setValueAtTime(880, pulseStart)
          osc.frequency.linearRampToValueAtTime(440, pulseStart + 0.18)
          gain.gain.setValueAtTime(0, pulseStart)
          gain.gain.linearRampToValueAtTime(0.4, pulseStart + 0.02)
          gain.gain.linearRampToValueAtTime(0, pulseStart + 0.2)
          osc.start(pulseStart)
          osc.stop(pulseStart + 0.2)
          if (i === 2 && j === 1) {
            osc.onended = () => ctx.close()
          }
        }
      }
    } catch {
      // AudioContext not available — silently ignore
    }
  }

  /**
   * Plays a short WhatsApp-style pop when an incoming message arrives.
   * Checks localStorage WHATSAPP_SOUND_KEY before playing — off by default.
   * Handles suspended AudioContext (browser autoplay policy) by resuming first.
   */
  function playWhatsAppMessageSound() {
    if (localStorage.getItem(WHATSAPP_SOUND_KEY) !== 'true') return
    try {
      const ctx = new AudioContext()
      const scheduleNotes = () => {
        const notes = [880, 660]
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.type = 'sine'
          const t = ctx.currentTime + i * 0.12
          osc.frequency.setValueAtTime(freq, t)
          gain.gain.setValueAtTime(0, t)
          gain.gain.linearRampToValueAtTime(0.2, t + 0.01)
          gain.gain.linearRampToValueAtTime(0, t + 0.1)
          osc.start(t)
          osc.stop(t + 0.1)
          if (i === notes.length - 1) osc.onended = () => ctx.close()
        })
      }
      if (ctx.state === 'suspended') {
        ctx.resume().then(scheduleNotes).catch(() => ctx.close())
      } else {
        scheduleNotes()
      }
    } catch {
      // AudioContext not available — silently ignore
    }
  }

  /**
   * Plays a soft "ready" double-chime — used when a QR code becomes available.
   * Always plays (no opt-in required — contextual UI feedback).
   */
  function playQrReadySound() {
    try {
      const ctx = new AudioContext()
      const notes = [660, 880]
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.type = 'sine'
        const t = ctx.currentTime + i * 0.18
        osc.frequency.setValueAtTime(freq, t)
        gain.gain.setValueAtTime(0, t)
        gain.gain.linearRampToValueAtTime(0.25, t + 0.02)
        gain.gain.linearRampToValueAtTime(0, t + 0.14)
        osc.start(t)
        osc.stop(t + 0.14)
        if (i === notes.length - 1) osc.onended = () => ctx.close()
      })
    } catch {
      // AudioContext not available — silently ignore
    }
  }

  return { playNotificationSound, playCallSound, playQrReadySound, playWhatsAppMessageSound }
}
