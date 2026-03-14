/**
 * XTermConsole — browser-based SSH terminal via xterm.js + WebSocket proxy.
 *
 * Connects to the IoT service WebSocket endpoint:
 *   ws(s)://{iotHost}/api/v1/devices/{deviceId}/console?token={jwt}&cols={c}&rows={r}
 *
 * Binary WS frames ↔ SSH stdin/stdout
 * JSON text frames → resize events: { type: "resize", cols: N, rows: N }
 */
import { useEffect, useRef } from 'react'
import { TOKEN_KEY } from '@/constants/storage'

// xterm.js and its FitAddon are loaded lazily to avoid including them in the
// initial bundle. They are only needed when this component is mounted.
// Types come from @xterm/xterm and @xterm/addon-fit — install with:
//   npm install @xterm/xterm @xterm/addon-fit

interface Props {
  deviceId: string
  /** Full IoT service base URL, e.g. http://localhost:8020/api/v1 */
  iotBaseUrl: string
  /** Render only when this is true; cleans up connection when false */
  active: boolean
}

export function XTermConsole({ deviceId, iotBaseUrl, active }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cleanupRef   = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!active || !containerRef.current) return

    let disposed = false

    async function init() {
      // Dynamic import — bundles lazily so the rest of the app stays fast
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ])
      // Import CSS once (Vite deduplicates repeated imports)
      await import('@xterm/xterm/css/xterm.css')

      if (disposed || !containerRef.current) return

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: '"Cascadia Code", "Fira Code", Menlo, Monaco, "Courier New", monospace',
        scrollback: 5000,
        theme: {
          background:          '#0d1117',
          foreground:          '#e6edf3',
          cursor:              '#e6edf3',
          selectionBackground: '#264f78',
          black:               '#484f58',
          red:                 '#ff7b72',
          green:               '#3fb950',
          yellow:              '#d29922',
          blue:                '#58a6ff',
          magenta:             '#bc8cff',
          cyan:                '#39c5cf',
          white:               '#b1bac4',
          brightBlack:         '#6e7681',
          brightRed:           '#ffa198',
          brightGreen:         '#56d364',
          brightYellow:        '#e3b341',
          brightBlue:          '#79c0ff',
          brightMagenta:       '#d2a8ff',
          brightCyan:          '#56d4dd',
          brightWhite:         '#f0f6fc',
        },
      })

      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(containerRef.current!)
      fit.fit()

      // Build the WebSocket URL (http→ws, https→wss)
      const token  = localStorage.getItem(TOKEN_KEY) ?? ''
      const wsBase = iotBaseUrl
        .replace(/^http:\/\//, 'ws://')
        .replace(/^https:\/\//, 'wss://')
        .replace(/\/api\/v1\/?$/, '')
      const url = `${wsBase}/api/v1/devices/${deviceId}/console`
        + `?token=${encodeURIComponent(token)}`
        + `&cols=${term.cols}&rows=${term.rows}`

      const ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'

      ws.onopen = () => {
        // nothing — server sends a "Connected" greeting
      }
      ws.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(ev.data))
        } else if (typeof ev.data === 'string') {
          term.write(ev.data)
        }
      }
      ws.onclose = (ev) => {
        if (!disposed) {
          term.write(`\r\n\x1b[33mConnection closed (${ev.code})\x1b[0m\r\n`)
        }
      }
      ws.onerror = () => {
        if (!disposed) {
          term.write('\r\n\x1b[31mWebSocket error — check IoT service logs.\x1b[0m\r\n')
        }
      }

      // Keyboard input → WebSocket
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(new TextEncoder().encode(data))
        }
      })

      // Resize → FitAddon + notify server
      const observer = new ResizeObserver(() => {
        if (disposed) return
        try { fit.fit() } catch { /* ignore */ }
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
        }
      })
      observer.observe(containerRef.current!)

      cleanupRef.current = () => {
        disposed = true
        observer.disconnect()
        try { ws.close() } catch { /* ignore */ }
        try { term.dispose() } catch { /* ignore */ }
      }
    }

    init().catch(console.error)

    return () => {
      disposed = true
      cleanupRef.current?.()
      cleanupRef.current = null
    }
  }, [active, deviceId, iotBaseUrl])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', minHeight: 420, background: '#0d1117' }}
    />
  )
}
