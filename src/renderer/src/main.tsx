import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/hind-siliguri/400.css'
import '@fontsource/hind-siliguri/500.css'
import '@fontsource/hind-siliguri/600.css'
import '@fontsource/hind-siliguri/700.css'
import './ui/base.css'
import './ui/components.css'
import './app/shell.css'
import { AppRouter } from './app/router'
import { SessionProvider, connectToCore } from './state/session'
import { ToastProvider } from './state/toast'
import { pingServer, getBaseUrl } from './api/client'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false },
    mutations: { retry: 0 }
  }
})

/* ── Startup contract: renderer must never show an unexplained blank screen ──
 * 1. connect core URL (Electron bridge or same-origin)
 * 2. poll core health with backoff — branded Bengali progress, never blank
 * 3. on success → real app; on hard failure → Bengali recovery actions
 */
type BootState = 'connecting' | 'ok' | 'fail'

const merqoBridge = (): {
  rendererAlive?: () => void
  relaunchApp?: () => Promise<void>
} => (window as unknown as { merqo?: { rendererAlive?: () => void; relaunchApp?: () => Promise<void> } }).merqo ?? {}

function BootSplash({ state, attempt, onRetry }: { state: BootState; attempt: number; onRetry: () => void }) {
  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 14, background: '#f6f7f9', color: '#1a2332', fontFamily: "'Hind Siliguri','Nirmala UI',sans-serif"
    }}>
      <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 2 }}>MERQO<span style={{ color: '#0e7c66' }}>.</span></div>
      <div style={{ fontSize: 13, color: '#5a6675', marginBottom: 6 }}>Retail Suite</div>
      {state === 'connecting' && (
        <>
          <div className="spinner" style={{ width: 22, height: 22, border: '3px solid #d7dde6', borderTopColor: '#0e7c66', borderRadius: '50%', animation: 'merqo-spin 0.8s linear infinite' }} />
          <div style={{ fontSize: 14, color: '#40506a' }}>ব্যবসার পরিবেশ প্রস্তুত করা হচ্ছে…</div>
          {attempt > 2 && <div style={{ fontSize: 12, color: '#8a95a5' }}>প্রায় প্রস্তুত ({attempt})</div>}
        </>
      )}
      {state === 'fail' && (
        <>
          <div style={{ fontSize: 26 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>MERQO চালু করতে একটি সমস্যা হয়েছে।</div>
          <div style={{ fontSize: 13, color: '#5a6675', maxWidth: 420, textAlign: 'center' }}>
            অ্যাপ্লিকেশনের ভেতরের সার্ভারে সংযোগ করা যাচ্ছে না। ইন্টারনেট লাগবে না — নিচের বাটনে চাপ দিয়ে আবার চেষ্টা করুন।
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button onClick={onRetry} style={{ padding: '9px 18px', border: 'none', borderRadius: 8, background: '#0e7c66', color: '#fff', fontSize: 14, cursor: 'pointer' }}>পুনরায় চেষ্টা করুন</button>
            <button onClick={() => { void merqoBridge().relaunchApp?.() }} style={{ padding: '9px 18px', border: '1px solid #cfd6df', borderRadius: 8, background: '#fff', color: '#1a2332', fontSize: 14, cursor: 'pointer' }}>অ্যাপ্লিকেশন পুনরায় চালু করুন</button>
          </div>
          <div style={{ fontSize: 12, color: '#8a95a5', marginTop: 8 }}>সহায়তা: merqoonline@gmail.com</div>
        </>
      )}
      <style>{'@keyframes merqo-spin { to { transform: rotate(360deg) } }'}</style>
    </div>
  )
}

function RendererAlive() {
  React.useEffect(() => { merqoBridge().rendererAlive?.() }, [])
  return null
}

function boot() {
  let cancelled = false
  const root = ReactDOM.createRoot(document.getElementById('root')!)
  const render = (state: BootState, attempt = 0) => {
    if (cancelled) return
    if (state === 'ok') {
      root.render(
        <React.StrictMode>
          <QueryClientProvider client={queryClient}>
            <HashRouter>
              <ToastProvider>
                <SessionProvider>
                  <RendererAlive />
                  <AppRouter />
                </SessionProvider>
              </ToastProvider>
            </HashRouter>
          </QueryClientProvider>
        </React.StrictMode>
      )
    } else {
      root.render(<BootSplash state={state} attempt={attempt} onRetry={() => { cancelled = true; boot() }} />)
    }
  }
  render('connecting')
  void runConnect(render)
}

async function runConnect(render: (s: BootState, attempt?: number) => void): Promise<void> {
  try {
    await connectToCore()
    const url = getBaseUrl()
    // poll core health — first launch may need a few seconds to initialise the database
    for (let attempt = 1; attempt <= 40; attempt++) {
      try {
        const ping = await pingServer(url)
        if (ping.ok) { render('ok'); return }
      } catch { /* keep polling */ }
      await new Promise((r) => setTimeout(r, 500))
      if (attempt % 8 === 0) render('connecting', attempt)
    }
    render('fail')
  } catch {
    render('fail')
  }
}

boot()
