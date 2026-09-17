/**
 * UI smoke — mounts the REAL renderer app (all 30 routes) inside jsdom against
 * the live QA server (scripts/qa-server.ts on :8080, seeded by scripts/qa-seed.sh).
 *
 * Catches: route→endpoint mismatches (LoadError appears), runtime render
 * crashes, permission-denial regressions. Requires the QA server running:
 *   node out/qa/server.cjs
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import React from 'react'
import { render, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const QA = process.env.MQ_QA_URL ?? 'http://127.0.0.1:8080'
let qaUp = false
let token = ''
try {
  qaUp = (await fetch(`${QA}/api/meta`, { signal: AbortSignal.timeout(3000) })).ok
} catch { qaUp = false }

/* ── browser polyfills jsdom lacks ── */
class RO { observe() { /* noop */ } unobserve() { /* noop */ } disconnect() { /* noop */ } }
if (!(window as unknown as { ResizeObserver?: unknown }).ResizeObserver) {
  ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = RO
}
if (!window.matchMedia) {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null,
    addListener() { /* noop */ }, removeListener() { /* noop */ },
    addEventListener() { /* noop */ }, removeEventListener() { /* noop */ },
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia
}
if (!(window.scrollTo as unknown)) window.scrollTo = (() => { /* noop */ }) as typeof window.scrollTo
if (!(SVGElement.prototype as unknown as { getBBox?: unknown }).getBBox) {
  ;(SVGElement.prototype as unknown as { getBBox: () => { x: number; y: number; width: number; height: number } }).getBBox =
    () => ({ x: 0, y: 0, width: 100, height: 20 })
}

/* fake electron bridge → pins the API base at the QA server */
const bridgeInfo = { mode: 'standalone', port: 8080, lanServer: false, lanPort: 47612, serverUrl: QA, version: '1.0.0', electron: 'jsdom', platform: 'linux', dbFile: 'qa' }
;(window as unknown as { merqo: unknown }).merqo = { serverInfo: async () => bridgeInfo }

const { setToken } = await import('../src/renderer/src/api/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { ToastProvider } = await import('../src/renderer/src/state/toast')
const { SessionProvider } = await import('../src/renderer/src/state/session')
const { AppRouter } = await import('../src/renderer/src/app/router')

beforeAll(async () => {
  if (!qaUp) return
  const login = await (await fetch(`${QA}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: 'merqo123' })
  })).json()
  token = login.token
  localStorage.setItem('mq_token', token)
  setToken(token)
  const client = await import('../src/renderer/src/api/client')
  client.setBaseUrl(QA)
  console.log('[ui-smoke] base set →', client.getBaseUrl())
  try {
    const me = await (client.api as { get: (p: string) => Promise<{ user: { name: string } }> }).get('/auth/me')
    console.log('[ui-smoke] client /auth/me OK →', me.user.name)
  } catch (e) {
    console.log('[ui-smoke] client /auth/me FAIL →', (e as Error).message, '| cause:', String((e as { cause?: unknown }).cause).slice(0, 140))
  }
})

afterAll(() => { cleanup() })

const mount = (route: string) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false }, mutations: { retry: 0 } }
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <ToastProvider>
          <SessionProvider>
            <AppRouter />
          </SessionProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

/** ids for detail routes, fetched from the live seeded data */
const ids: Record<string, string> = {}

async function screenOk(route: string, expectText?: RegExp): Promise<string> {
  const consoleErrors: string[] = []
  const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    const msg = String(a[0] ?? '')
    if (!msg.includes('not wrapped in act') && !msg.includes('Warning:')) consoleErrors.push(msg)
  })
  // React 19 logs render errors through the ORIGINAL console (bypassing spies),
  // and rethrows uncaught — so also capture window-level failures.
  const onErr = (e: ErrorEvent) => consoleErrors.push(`window.error: ${e.message}`)
  const onRej = (e: PromiseRejectionEvent) => consoleErrors.push(`unhandled: ${String(e.reason).slice(0, 300)}`)
  window.addEventListener('error', onErr)
  window.addEventListener('unhandledrejection', onRej)
  try {
    const { container } = mount(route)
    await waitFor(() => {
      const txt = container.textContent ?? ''
      if (txt.includes('চালু হচ্ছে')) return
      expect(txt.length).toBeGreaterThan(80)
    }, { timeout: 15_000 })
    await new Promise((r) => setTimeout(r, 700)) // settle queries
    const txt = container.textContent ?? ''
    if (txt.includes('প্রবেশ করুন') && route !== '/login') {
      const { getBaseUrl } = await import('../src/renderer/src/api/client')
      console.log(`[ui-smoke] ${route} → LOGIN PAGE shown (base=${getBaseUrl()})`)
    }
    expect(txt.length).toBeGreaterThan(80)           // still mounted after settle (no crash-unmount)
    expect(txt).not.toContain('চালু হচ্ছে')          // session must be ready
    expect(txt).not.toContain('লোড করা যায়নি')      // no query may hard-fail
    expect(txt).not.toContain('অনুমতি নেই')          // owner sees everything
    if (expectText) {
      // data-dependent assertions must WAIT for real data — a cold CI server may need
      // longer than the fixed settle window (skeletons contain no digits)
      await waitFor(() => { expect(container.textContent ?? '').toMatch(expectText) }, { timeout: 15_000 })
    }
    expect(consoleErrors).toEqual([])
    return txt
  } finally {
    spy.mockRestore()
    window.removeEventListener('error', onErr)
    window.removeEventListener('unhandledrejection', onRej)
    cleanup()
  }
}

describe.skipIf(!qaUp)('ui smoke — every route mounts on live data', () => {
  beforeAll(async () => {
    const H = { authorization: `Bearer ${token}` }
    const j = async (u: string) => (await (await fetch(`${QA}/api${u}`, { headers: H })).json())
    const sale = await j('/sales?page=1&pageSize=1')
    ids.sale = sale.rows[0]?.id
    const pur = await j('/purchases?page=1&pageSize=1')
    ids.purchase = pur.rows[0]?.id
    const prod = await j('/products?page=1&pageSize=1')
    ids.product = prod.rows[0]?.id
    const cust = await j('/customers?page=1&pageSize=1')
    ids.customer = cust.rows[0]?.id
    const sup = await j('/suppliers?page=1&pageSize=1')
    ids.supplier = sup.rows[0]?.id
  })

  const routes: Array<[string, string]> = [
    ['/dashboard', 'ড্যাশবোর্ড'],
    ['/pos', ''],
    ['/sales', ''],
    ['/sales/SALE', ''],
    ['/returns', ''],
    ['/purchases', ''],
    ['/purchases/new', ''],
    ['/purchases/PURCHASE', ''],
    ['/products', ''],
    ['/products/new', ''],
    ['/products/PRODUCT', ''],
    ['/inventory', ''],
    ['/customers', ''],
    ['/customers/CUSTOMER', ''],
    ['/suppliers', ''],
    ['/suppliers/SUPPLIER', ''],
    ['/accounts', ''],
    ['/payments', ''],
    ['/expenses', ''],
    ['/finance', ''],
    ['/mfs', ''],
    ['/reports', ''],
    ['/documents', ''],
    ['/staff', ''],
    ['/notifications', ''],
    ['/data', ''],
    ['/audit', ''],
    ['/settings', ''],
    ['/settings/business/new', ''],
    ['/about', '']
  ]

  it('all 30 routes render without errors', { timeout: 180_000 }, async () => {
    const failures: string[] = []
    for (const [route] of routes) {
      const real = route.replace('/sales/SALE', `/sales/${ids.sale}`)
        .replace('/purchases/PURCHASE', `/purchases/${ids.purchase}`)
        .replace('/products/PRODUCT', `/products/${ids.product}`)
        .replace('/customers/CUSTOMER', `/customers/${ids.customer}`)
        .replace('/suppliers/SUPPLIER', `/suppliers/${ids.supplier}`)
      try {
        await screenOk(real)
        console.log(`  ✓ ${real}`)
      } catch (e) {
        failures.push(`${real}: ${(e as Error).message.split('\n')[0]}`)
        console.log(`  ✗ ${real}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('dashboard shows real seeded numbers', async () => {
    await screenOk('/dashboard', /৳|[0-9]/)
  })

  it('products page lists seeded Bengali product', async () => {
    const txt = await screenOk('/products')
    expect(txt).toContain('প্রাণ মিনারেল ওয়াটার')
  })

  it('sale detail shows invoice number', async () => {
    const txt = await screenOk(`/sales/${ids.sale}`)
    expect(txt).toContain('INV-')
  })
})
