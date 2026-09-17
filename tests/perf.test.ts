/**
 * PERFORMANCE GATE — realistic retail volume through the real HTTP core.
 * 1,000 products · 1,000 customers · 300 suppliers · 5,000 sales · stock
 * movements in the thousands. Every UI-critical query must answer fast.
 * Correctness is asserted (not sacrificed): final stock + ledger must reconcile.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { makeWorld, assertLedgerConsistent, type World } from './setup'
import { startCore, type CoreHandle } from '@core/index'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let world: World
let core: CoreHandle
let base = ''
let token = ''

const api = async (method: string, url: string) => {
  let res: Response
  try {
    res = await fetch(base + url, { headers: { authorization: `Bearer ${token}` } })
  } catch (e) {
    // one transparent retry — undici keep-alive can drop after the bulk seed
    res = await fetch(base + url, { headers: { authorization: `Bearer ${token}` } })
  }
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}
const timed = async (label: string, fn: () => Promise<unknown>, maxMs: number) => {
  const t0 = Date.now()
  await fn()
  const dt = Date.now() - t0
  console.log(`  ⏱ ${label}: ${dt}ms (limit ${maxMs}ms)`)
  expect(dt).toBeLessThan(maxMs)
}

beforeAll(async () => {
  world = makeWorld()
  core = startCore({ db: world.db as never, port: 0, host: '127.0.0.1', backupDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mq-perf-')) })
  for (let i = 0; i < 50 && core.port === 0; i++) await new Promise((r) => setTimeout(r, 20))
  base = `http://127.0.0.1:${core.port}/api`
  token = (await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'owner', password: 'secret1' }) })).json()).token
}, 60_000)

afterAll(() => core.close())

describe('performance at realistic volume', () => {
  let productIds: string[] = []

  it('seed: 1000 products · 1000 customers · 300 suppliers · 5000 sales (bulk, direct service calls)', async () => {
    const t0 = Date.now()
    const products = await import('@core/services/products')
    const parties = await import('@core/services/parties')
    const salesSvc = await import('@core/services/sales')
    const ctx = { userId: world.ownerId, userName: 'owner' }

    for (let i = 0; i < 1000; i++) {
      products.createProduct(world.db, ctx, world.businessId, {
        name: `পারফরম্যান্স পণ্য ${i + 1}`, sku: `PRF-${String(i + 1).padStart(4, '0')}`,
        barcode: `99${String(i).padStart(10, '0')}`,
        purchase_price: 5000 + (i % 50) * 100, selling_price: 6000 + (i % 50) * 150,
        opening_stock: 100, min_stock: 10
      })
    }
    for (let i = 0; i < 1000; i++) parties.createCustomer(world.db, ctx, world.businessId, { name: `পারফরম্যান্স গ্রাহক ${i + 1}`, phone: `017${String(i).padStart(8, '0')}` })
    for (let i = 0; i < 300; i++) parties.createSupplier(world.db, ctx, world.businessId, { name: `পারফরম্যান্স সরবরাহক ${i + 1}` })

    const prodRows = world.db.prepare(`SELECT id, selling_price FROM products WHERE business_id=? LIMIT 1000`).all(world.businessId) as Array<{ id: string; selling_price: number }>
    productIds = prodRows.map((p) => p.id)
    const custRows = world.db.prepare(`SELECT id FROM customers WHERE business_id=? LIMIT 1000`).all(world.businessId) as Array<{ id: string }>

    // 5000 sales, 3 lines each, mixed paid/due — direct service = fast seeding
    for (let s = 0; s < 5000; s++) {
      const items = [0, 1, 2].map((k) => {
        const p = prodRows[(s * 3 + k) % 1000]
        return { product_id: p.id, qty: 1, unit_price: p.selling_price, discount: 0 }
      })
      // every 5th sale is CREDIT (customer, no payment); the rest are full cash
      const credit = s % 5 === 0
      salesSvc.createSale(world.db, ctx, world.businessId, {
        items,
        customer_id: credit ? custRows[s % 1000].id : undefined,
        payments: credit ? [] : [{ account_id: world.cashId, amount: items.reduce((a, x) => a + x.unit_price, 0), method: 'cash' }]
      })
    }
    console.log(`  ⏱ seed wall time: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    const count = (world.db.prepare(`SELECT COUNT(*) c FROM sales WHERE business_id=?`).get(world.businessId) as { c: number }).c
    expect(count).toBeGreaterThanOrEqual(5000)
  }, 300_000)

  it('dashboard answers < 1500ms at 5k sales / 1k products', async () => {
    await timed('GET /dashboard', () => api('GET', '/dashboard'), 1500)
  })

  it('product search (Bengali + sku + barcode) < 500ms', async () => {
    await timed('GET /products?search=পারফরম্যান্স পণ্য ৯৯', () => api('GET', '/products?search=' + encodeURIComponent('পারফরম্যান্স পণ্য ৯৯')), 500)
    await timed('GET /products?search=PRF-0999', () => api('GET', '/products?search=PRF-0999'), 500)
  })

  it('barcode lookup < 200ms', async () => {
    await timed('GET /products/barcode/9900000000999', () => api('GET', '/products/barcode/9900000000999'), 200)
  })

  it('sales list page-1 < 600ms with sums', async () => {
    await timed('GET /sales?page=1', () => api('GET', '/sales?page=1&pageSize=30'), 600)
  })

  it('customers list < 500ms', async () => {
    await timed('GET /customers?page=1', () => api('GET', '/customers?page=1&pageSize=50'), 500)
  })

  it('reports (top-products, pnl, daily-series) < 1500ms each', async () => {
    await timed('GET /reports/top-products', () => api('GET', '/reports/top-products?from=0&to=99999999999999'), 1500)
    await timed('GET /reports/pnl', () => api('GET', '/reports/pnl?from=0&to=99999999999999'), 1500)
    await timed('GET /reports/daily-series', () => api('GET', '/reports/daily-series?from=0&to=99999999999999'), 1500)
  })

  it('inventory valuation + movements < 1500ms', async () => {
    await timed('GET /inventory/valuation', () => api('GET', '/inventory/valuation'), 1500)
    await timed('GET /inventory/movements?page=1', () => api('GET', '/inventory/movements?page=1&pageSize=50'), 1500)
  })

  it('data stays correct at volume — ledger + stock reconcile', async () => {
    const s = await api('GET', '/sales?page=1&pageSize=1')
    expect(s.json.total as number).toBeGreaterThanOrEqual(5000)
    assertLedgerConsistent(world)
    // spot: movements for one product sum to its stock
    const pid = productIds[500]
    const mov = await api('GET', `/inventory/movements?product_id=${pid}&pageSize=1000`)
    const sum = (mov.json.rows as Array<{ qty: number }>).reduce((a, m) => a + m.qty, 0)
    const stock = (world.db.prepare('SELECT stock FROM products WHERE id=?').get(pid) as { stock: number }).stock
    expect(sum).toBe(stock)
  })
})
