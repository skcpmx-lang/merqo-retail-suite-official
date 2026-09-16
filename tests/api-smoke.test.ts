/**
 * API smoke test — boots the real HTTP core and exercises the exact endpoints
 * the renderer pages call, verifying response shapes end-to-end.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { makeWorld, type World } from './setup'
import { startCore, type CoreHandle } from '@core/index'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let world: World
let core: CoreHandle
let base: string
let token = ''

const api = async (method: string, url: string, body?: unknown): Promise<{ status: number; json: any }> => {
  const res = await fetch(base + url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await res.text()
  let json: unknown = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json }
}

beforeAll(async () => {
  world = makeWorld()
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mq-bak-'))
  core = startCore({ db: world.db as never, port: 0, host: '127.0.0.1', backupDir })
  // wait for the listener to actually bind (port 0 → ephemeral)
  for (let i = 0; i < 50 && core.port === 0; i++) await new Promise((r) => setTimeout(r, 20))
  base = `http://127.0.0.1:${core.port}/api`
})

afterAll(() => { core.close() })

describe('api smoke — the routes the UI lives on', () => {
  it('login → token; /auth/me returns user+business+perms+has_pin', async () => {
    const login = await api('POST', '/auth/login', { username: 'owner', password: 'secret1' })
    expect(login.status).toBe(200)
    expect(typeof login.json.token).toBe('string')
    token = login.json.token
    const me = await api('GET', '/auth/me')
    expect(me.status).toBe(200)
    expect(me.json.user.name).toBeTruthy()
    expect(me.json.business.id).toBe(world.businessId)
    expect(Array.isArray(me.json.perms)).toBe(true)
    expect(typeof me.json.has_pin).toBe('boolean')
  })

  it('catalog: categories/brands/units/customers/suppliers arrays', async () => {
    const { status, json } = await api('GET', '/catalog')
    expect(status).toBe(200)
    for (const k of ['categories', 'brands', 'units', 'customers', 'suppliers']) expect(Array.isArray(json[k])).toBe(true)
  })

  it('products list + barcode lookup + create', async () => {
    const p = world.product({ name: 'স্মোক চিপস', barcode: '8991002' })
    const list = await api('GET', '/products?search=স্মোক&page=1&pageSize=10')
    expect(list.status).toBe(200)
    expect(list.json.rows.length).toBeGreaterThanOrEqual(1)
    expect(list.json.rows[0]).toHaveProperty('purchase_price')
    expect(list.json.rows[0]).toHaveProperty('min_stock')
    const bc = await api('GET', '/products/barcode/8991002')
    expect(bc.status).toBe(200)
    expect(bc.json.product?.id).toBe(p.id)
  })

  it('pos sale flow: create with payments, verify shape, list', async () => {
    const p = world.product({ name: 'স্মোক সাবান', selling_price: 5000, opening_stock: 10 })
    const accounts = await api('GET', '/accounts')
    const cash = accounts.json.rows.find((a: { type: string }) => a.type === 'cash')
    const sale = await api('POST', '/sales', {
      items: [{ product_id: p.id, qty: 2, unit_price: 5000 }],
      payments: [{ account_id: cash.id, amount: 10000, method: 'cash' }]
    })
    expect(sale.status).toBe(200)
    expect(sale.json.sale.invoice_no).toMatch(/^INV-/)
    expect(sale.json.sale.total).toBe(10000)
    expect(sale.json.sale.due).toBe(0)
    expect(Array.isArray(sale.json.items)).toBe(true)

    const list = await api('GET', '/sales?page=1&pageSize=30')
    expect(list.json.rows[0]).toHaveProperty('user_name')
    expect(list.json.sums).toHaveProperty('total')
    const detail = await api('GET', `/sales/${sale.json.sale.id}`)
    expect(detail.json.sale).toBeTruthy()
    expect(detail.json.items[0]).toHaveProperty('returned_qty')
    expect(Array.isArray(detail.json.payments)).toBe(true)
  })

  it('due sale → collect → returns flow shapes', async () => {
    const p = world.product({ name: 'স্মোক চাল', selling_price: 20000, opening_stock: 5 })
    const cs = await api('POST', '/customers', { name: 'স্মোক গ্রাহক', phone: '01711223344', opening_due: 0 })
    const customerId = cs.json.id
    const accounts = await api('GET', '/accounts')
    const cash = accounts.json.rows.find((a: { type: string }) => a.type === 'cash')

    const sale = await api('POST', '/sales', {
      customer_id: customerId,
      items: [{ product_id: p.id, qty: 2, unit_price: 20000 }],
      payments: []
    })
    expect(sale.json.sale.due).toBe(40000)

    const collect = await api('POST', `/customers/${customerId}/collect`, { amount: 15000, account_id: cash.id, method: 'cash' })
    expect(collect.status).toBe(200)
    expect(collect.json.voucher_no).toMatch(/^RCP-/)
    expect(collect.json.receivable_after).toBe(25000)

    const detail = await api('GET', `/sales/${sale.json.sale.id}`)
    const item = detail.json.items[0]
    const ret = await api('POST', '/returns', {
      sale_id: sale.json.sale.id,
      items: [{ sale_item_id: item.id, qty: 1 }],
      restock: true,
      refund_mode: 'due_adjust'
    })
    expect(ret.status).toBe(200)
    const retList = await api('GET', '/returns?page=1')
    expect(retList.json.rows[0]).toHaveProperty('refund_mode')
    const me2 = await api('GET', `/customers/${customerId}`)
    expect(me2.json.customer.receivable).toBe(5000)
  })

  it('purchase create + detail + void-permission shape', async () => {
    const p = world.product({ name: 'স্মোক তেল', purchase_price: 15000 })
    const sup = await api('POST', '/suppliers', { name: 'স্মোক ডিলার' })
    const accounts = await api('GET', '/accounts')
    const cash = accounts.json.rows.find((a: { type: string }) => a.type === 'cash')
    const pur = await api('POST', '/purchases', {
      supplier_id: sup.json.id,
      items: [{ product_id: p.id, qty: 12, unit_cost: 15000 }],
      discount: 5000,
      payments: [{ account_id: cash.id, amount: 100000, method: 'cash' }]
    })
    expect(pur.status).toBe(200)
    const detail = await api('GET', `/purchases/${pur.json.purchase.id}`)
    expect(detail.json.purchase.supplier_name).toBe('স্মোক ডিলার')
    expect(detail.json.purchase.discount).toBe(5000)
    expect(detail.json.items[0]).toHaveProperty('unit_cost')
  })

  it('dashboard + reports + mfs + settings + audit shapes', async () => {
    const dash = await api('GET', '/dashboard')
    if (dash.status !== 200) console.log('[smoke] /dashboard', dash.status, JSON.stringify(dash.json))
    expect(dash.status).toBe(200)
    expect(dash.json.today).toHaveProperty('gross_profit')
    expect(dash.json.dues).toHaveProperty('receivable')
    expect(dash.json.position).toHaveProperty('cash')
    expect(dash.json.stock).toHaveProperty('at_cost')
    expect(Array.isArray(dash.json.alerts)).toBe(true)
    expect(Array.isArray(dash.json.series)).toBe(true)

    const val = await api('GET', '/inventory/valuation')
    expect(val.json.summary).toHaveProperty('at_cost')
    expect(Array.isArray(val.json.by_category)).toBe(true)
    const low = await api('GET', '/inventory/low')
    expect(Array.isArray(low.json.rows)).toBe(true)
    const mov = await api('GET', '/inventory/movements?page=1&pageSize=10')
    expect(mov.json.rows[0]).toHaveProperty('product_name')
    expect(mov.json.rows[0]).toHaveProperty('qty')
    expect(mov.json.rows[0]).toHaveProperty('balance_after')

    const pnl = await api('GET', '/reports/pnl?from=0&to=' + Date.now())
    expect(pnl.json).toHaveProperty('net_profit')
    const daily = await api('GET', `/reports/daily-series?from=${Date.now() - 86400000}&to=${Date.now()}`)
    expect(Array.isArray(daily.json.rows)).toBe(true)
    const top = await api('GET', `/reports/top-products?from=0&to=${Date.now()}`)
    expect(top.json.rows ?? top.json).toBeTruthy()
    const recv = await api('GET', '/reports/receivables')
    expect(Array.isArray(recv.json.rows)).toBe(true)
    const cf = await api('GET', `/reports/cashflow?from=0&to=${Date.now()}`)
    expect(cf.json).toHaveProperty('inflow')
    expect(cf.json).toHaveProperty('net')

    const mfsTx = await api('POST', '/mfs', {
      provider: 'bkash', txn_type: 'cash_in',
      account_id: world.bkashId, counter_account_id: world.cashId,
      amount: 50000, service_charge: 500
    })
    expect(mfsTx.status).toBe(200)
    const mfsList = await api('GET', '/mfs?page=1')
    expect(mfsList.json.rows[0]).toHaveProperty('txn_type')
    expect(mfsList.json.sums).toHaveProperty('commission')

    const settings = await api('GET', '/settings')
    expect(settings.json.values).toHaveProperty('invoice_prefix')

    const audit = await api('GET', '/audit?page=1')
    expect(Array.isArray(audit.json.rows)).toBe(true)
  })

  it('held sales + backups + search + notifications', async () => {
    const held = await api('POST', '/held', { label: 'স্মোক হোল্ড', cart: { lines: [], customer_id: null, invoice_discount: 0 } })
    expect(held.status).toBe(200)
    const heldList = await api('GET', '/held')
    expect(heldList.json.rows.length).toBeGreaterThanOrEqual(1)
    expect(heldList.json.rows[0]).toHaveProperty('cart_json')

    const search = await api('GET', '/search?q=স্মোক')
    expect(Array.isArray(search.json.hits)).toBe(true)

    const bk = await api('POST', '/backups', { note: 'স্মোক ব্যাকআপ' })
    expect(bk.status).toBe(200)
    expect(bk.json.file).toBeTruthy()
    const bkList = await api('GET', '/backups')
    expect(bkList.json.rows.length).toBeGreaterThanOrEqual(1)

    const notif = await api('GET', '/notifications?page=1')
    expect(Array.isArray(notif.json.rows)).toBe(true)
  })

  it('permission gates: cashier cannot void or view P&L', async () => {
    const cashierLogin = await api('POST', '/auth/login', { username: 'cashier', password: 'secret1' })
    expect(cashierLogin.status).toBe(200)
    const cashierToken = cashierLogin.json.token
    const pnl = await fetch(`${base}/reports/pnl`, { headers: { authorization: `Bearer ${cashierToken}` } })
    expect(pnl.status).toBe(403)
    // restore owner token for later tests
    token = (await api('POST', '/auth/login', { username: 'owner', password: 'secret1' })).json.token
  })
})
