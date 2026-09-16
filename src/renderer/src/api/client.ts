/**
 * API client — talks to the MERQO core over HTTP.
 * Standalone mode: http://127.0.0.1:<port>. Client mode: the configured server.
 */

export interface ApiError extends Error {
  code: string
  status: number
}

let baseUrl = 'http://127.0.0.1:47612'
let token: string | null = localStorage.getItem('mq_token')

export function setBaseUrl(url: string): void {
  baseUrl = url.replace(/\/$/, '')
}

export function getBaseUrl(): string {
  return baseUrl
}

export function setToken(t: string | null): void {
  token = t
  if (t) localStorage.setItem('mq_token', t)
  else localStorage.removeItem('mq_token')
}

export function hasToken(): boolean {
  return !!token
}

export class ApiFailure extends Error implements ApiError {
  code: string
  status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

async function request<T>(method: string, path: string, body?: unknown, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(baseUrl + '/api' + path)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url.toString(), {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })

  if (res.status === 204) return undefined as T
  let data: unknown = null
  try {
    data = await res.json()
  } catch { /* non-json */ }

  if (!res.ok) {
    const d = data as { error?: string; message?: string } | null
    if (res.status === 401 && token && path !== '/auth/login') {
      // session expired — force re-login on next guarded route
      setToken(null)
      window.dispatchEvent(new CustomEvent('merqo:session-expired'))
    }
    throw new ApiFailure(d?.error ?? 'HTTP_' + res.status, d?.message ?? 'কাজটি সম্পন্ন হয়নি — আবার চেষ্টা করুন।', res.status)
  }
  return data as T
}

export const api = {
  get: <T>(path: string, params?: Record<string, string | number | undefined>) => request<T>('GET', path, undefined, params),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body)
}

/* ─────────────────────── typed helpers used across pages ─────────────────────── */

export interface Paged<T> { rows: T[]; total: number }

export async function pingServer(url: string): Promise<{ ok: boolean; initialized?: boolean; version?: string }> {
  try {
    const res = await fetch(url.replace(/\/$/, '') + '/api/meta', { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return { ok: false }
    const data = (await res.json()) as { initialized?: boolean; app?: string }
    return { ok: true, initialized: data.initialized, version: data.app }
  } catch {
    return { ok: false }
  }
}
