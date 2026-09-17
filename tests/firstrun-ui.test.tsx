/**
 * FIRST-RUN UI — a fresh (unseeded) install must open into the setup wizard,
 * never into a login screen, and never with demo credentials.
 *
 * Needs a FRESH QA server (no seed) — default http://127.0.0.1:8081:
 *   MQ_QA_FRESH=1 MQ_QA_PORT=8081 node out/qa/server.cjs
 * Skipped automatically when the server is not running.
 */
const FRESH = process.env.MQ_QA_FRESH_URL ?? 'http://127.0.0.1:8081'
let up = false
try { up = (await fetch(`${FRESH}/api/meta`, { signal: AbortSignal.timeout(2500) })).ok } catch { up = false }

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import React from 'react'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

describe.skipIf(!up)('first-run experience (fresh install)', () => {
  it('lands on the setup wizard with zero demo credentials', async () => {
    class RO { observe(): void { /* */ } unobserve(): void { /* */ } disconnect(): void { /* */ } }
    ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = RO
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener() { /* */ }, removeListener() { /* */ }, addEventListener() { /* */ }, removeEventListener() { /* */ }, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
    ;(window as unknown as { merqo: unknown }).merqo = { serverInfo: async () => ({ mode: 'standalone', port: 8081, lanServer: false, lanPort: 47612, serverUrl: FRESH, version: '1.0.0', electron: 'jsdom', platform: 'linux', dbFile: 'qa' }) }

    const { setToken, setBaseUrl } = await import('../src/renderer/src/api/client')
    setBaseUrl(FRESH)
    setToken(null)
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    const { ToastProvider } = await import('../src/renderer/src/state/toast')
    const { SessionProvider } = await import('../src/renderer/src/state/session')
    const { AppRouter } = await import('../src/renderer/src/app/router')

    const qc = new QueryClient({ defaultOptions: { queries: { retry: 1 } } })
    const { container } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/']}>
          <ToastProvider><SessionProvider><AppRouter /></SessionProvider></ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>
    )
    await waitFor(() => { expect(container.textContent ?? '').toContain('সেটআপ') }, { timeout: 10_000 })
    const txt = container.textContent ?? ''
    expect(txt).not.toContain('merqo123')
    expect(txt).toContain('মালিকের অ্যাকাউন্ট')
  })
})
