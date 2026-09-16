import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession, connectToCore } from '@/state/session'
import { useToast } from '@/state/toast'
import { api, pingServer } from '@/api/client'
import { t } from '@/i18n/bn'
import { Field, Spinner } from '@/ui/components'

export function Login() {
  const { login } = useSession()
  const { toast } = useToast()
  const navigate = useNavigate()

  const [mode, setMode] = useState<'local' | 'server'>(localStorage.getItem('mq_login_mode') === 'server' ? 'server' : 'local')
  const [serverAddr, setServerAddr] = useState(() => localStorage.getItem('mq_server_addr') ?? '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [serverOk, setServerOk] = useState<null | boolean>(null)

  useEffect(() => { document.title = t('login') + ' — MERQO Retail Suite' }, [])

  const applyServer = async () => {
    if (!serverAddr.trim()) return
    let url = serverAddr.trim()
    if (!/^https?:\/\//.test(url)) url = `http://${url}`
    if (!/:\d+$/.test(url)) url += ':47612'
    setBusy(true); setErr('')
    const res = await pingServer(url)
    setBusy(false)
    if (!res.ok) {
      setServerOk(false)
      setErr(t('cannot_reach_server'))
      return
    }
    setServerOk(true)
    localStorage.setItem('mq_server_addr', url)
    localStorage.setItem('mq_login_mode', 'server')
    const { setBaseUrl } = await import('@/api/client')
    setBaseUrl(url)
    // a client session may already exist for this server
    try {
      const me = await api.get('/auth/me')
      if (me) { window.location.reload() }
    } catch { /* need login below */ }
  }

  const useLocal = async () => {
    localStorage.setItem('mq_login_mode', 'local')
    const bridge = (window as unknown as { merqo?: { setMode: (p: Record<string, unknown>) => Promise<unknown> } }).merqo
    if (bridge) { await bridge.setMode({ mode: 'standalone' }) }
    await connectToCore()
    setMode('local')
    setServerOk(null)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'server' && !serverOk) { void applyServer(); return }
    setBusy(true); setErr('')
    try {
      const me = await login(username.trim(), password)
      toast(`স্বাগতম, ${me.user.name}!`, 'success')
    } catch (ex) {
      const msg = (ex as Error).message || t('bad_credentials')
      setErr(msg === 'Failed to fetch' ? t('err_network') : msg)
    } finally { setBusy(false) }
  }

  return (
    <div className="login-wrap">
      <div className="login-card fade-in">
        <div className="login-logo">
          <div className="brand-mark" style={{ width: 40, height: 40, fontSize: 20, borderRadius: 11 }}>M<span className="brand-dot">.</span></div>
          <div>
            <div className="login-title">MERQO<span style={{ color: 'var(--primary)' }}>.</span> Retail Suite</div>
            <div className="login-sub">{t('login_title')}</div>
          </div>
        </div>

        <div className="mode-tabs">
          <button className={mode === 'local' ? 'active' : ''} onClick={() => void useLocal()}>{t('use_local_mode')}</button>
          <button className={mode === 'server' ? 'active' : ''} onClick={() => { setMode('server'); localStorage.setItem('mq_login_mode', 'server') }}>{t('client_mode')}</button>
        </div>

        {mode === 'server' ? (
          <div style={{ marginBottom: 16 }}>
            <Field label={t('server_address')} hint={t('client_mode_hint')} error={err || undefined}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  placeholder={t('server_address_ph')}
                  value={serverAddr}
                  onChange={(e) => { setServerAddr(e.target.value); setServerOk(null) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') void applyServer() }}
                />
                <button className="btn btn-secondary" onClick={() => void applyServer()} disabled={busy}>
                  {busy ? <Spinner size={14} /> : null}{t('connect')}
                </button>
              </div>
            </Field>
            {serverOk ? <div className="hint" style={{ color: 'var(--success-text)', marginTop: 6 }}>✓ সার্ভার পাওয়া গেছে — এবার লগইন করুন</div> : null}
          </div>
        ) : null}

        <form onSubmit={submit}>
          <div className="flex flex-col gap-3">
            <Field label={t('username')} required>
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus={mode === 'local'} autoComplete="username" />
            </Field>
            <Field label={t('password')} required error={mode === 'local' ? err : undefined}>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
            <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy || !username || !password}>
              {busy ? <Spinner size={15} /> : null}{t('login_btn')}
            </button>
          </div>
        </form>

        <div className="login-foot">
          {t('powered_by')} · <a href="mailto:merqoonline@gmail.com">merqoonline@gmail.com</a>
        </div>
      </div>
    </div>
  )
}
