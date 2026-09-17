import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, setToken, setBaseUrl, hasToken } from '@/api/client'

export interface SessionUser { id: string; name: string; username: string }
export interface SessionBusiness {
  id: string
  name: string
  owner_name: string | null
  phone: string | null
  email: string | null
  address: string | null
  logo_data: string | null
  biz_type: string | null
  currency: string
}

interface MeResponse {
  user: SessionUser
  business: SessionBusiness | null
  businesses: SessionBusiness[]
  perms: string[]
  has_pin: boolean
}

interface SessionCtx {
  ready: boolean
  me: MeResponse | null
  perms: Set<string>
  can: (p: string) => boolean
  business: SessionBusiness | null
  businesses: SessionBusiness[]
  refresh: () => Promise<void>
  switchBusiness: (id: string) => Promise<void>
  login: (username: string, password: string, businessId?: string) => Promise<MeResponse>
  logout: () => Promise<void>
}

const Ctx = createContext<SessionCtx | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async () => {
    if (!hasToken()) { setMe(null); setReady(true); return }
    try {
      const data = await api.get<MeResponse>('/auth/me')
      setMe(data)
    } catch {
      setMe(null)
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    const onExpired = () => setMe(null)
    window.addEventListener('merqo:session-expired', onExpired)
    return () => window.removeEventListener('merqo:session-expired', onExpired)
  }, [])

  const login = useCallback(async (username: string, password: string, businessId?: string) => {
    const res = await api.post<{ token: string; expires_at: number }>('/auth/login', { username, password, business_id: businessId })
    setToken(res.token)
    const data = await api.get<MeResponse>('/auth/me')
    setMe(data)
    return data
  }, [])

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout') } catch { /* best effort */ }
    setToken(null)
    setMe(null)
  }, [])

  const switchBusiness = useCallback(async (id: string) => {
    await api.post('/auth/business', { business_id: id })
    await refresh()
  }, [refresh])

  const value = useMemo<SessionCtx>(() => ({
    ready,
    me,
    perms: new Set(me?.perms ?? []),
    can: (p) => me?.perms.includes(p) ?? false,
    business: me?.business ?? null,
    businesses: me?.businesses ?? [],
    refresh,
    switchBusiness,
    login,
    logout
  }), [ready, me, refresh, switchBusiness, login, logout])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession(): SessionCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSession outside provider')
  return ctx
}

/** Point the client at the embedded core once Electron reports the port. */
export async function connectToCore(): Promise<'standalone' | 'client'> {
  const bridge = (window as unknown as { merqo?: { serverInfo: () => Promise<ServerInfo> } }).merqo
  if (bridge) {
    const info = await bridge.serverInfo()
    if (info.mode === 'client' && info.serverUrl) {
      setBaseUrl(info.serverUrl)
      return 'client'
    }
    setBaseUrl(`http://127.0.0.1:${info.port}`)
    return 'standalone'
  }
  // browser fallback — when the SPA itself is served over http (LAN/dev/preview
  // the API lives on the same origin); file:// (packaged Electron) uses the
  // local core port.
  if (window.location.protocol.startsWith('http')) {
    setBaseUrl(window.location.origin)
  } else {
    setBaseUrl('http://127.0.0.1:47612')
  }
  return 'standalone'
}

export interface ServerInfo {
  mode: string
  port: number
  lanServer: boolean
  lanPort: number
  serverUrl: string
  version: string
  electron: string
  platform: string
  dbFile: string | null
}
