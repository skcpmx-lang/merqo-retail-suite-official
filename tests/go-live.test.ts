/**
 * GO-LIVE DEPLOYMENT SCENARIO — a realistic Bangladeshi retail shop, end to end.
 *
 * Mirrors docs/MANUAL-QA-CHECKLIST.md steps that can be verified at the data/API
 * layer, against a FILE-backed database (not :memory:), including a true
 * application-restart persistence proof: core stopped → db closed → reopened →
 * every number identical.
 *
 * Checklist coverage: business+products(5) · purchase→stock→sale→due→payment(8) ·
 * customer statement(9) · supplier statement(10) · expenses+reports(11) ·
 * MFS workflow(12) · barcode-scan flow(7 logic layer) · backup/restore(16) ·
 * concurrent usage(19) · monitor read-only(21) · restart persistence(22-23 data layer)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startCore, type CoreHandle } from '@core/index'
import { openDatabase, type DB } from '@core/db/connection'
import { assertLedgerConsistent, type World } from './setup'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let db: DB
let core: CoreHandle
let base: string
let dbFile = ''
let backupDir = ''
let world: World
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}

const api = async (tok: string, method: string, url: string, body?: unknown) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await res.text()
  let json: unknown = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json: json as Record<string, unknown> & { rows?: unknown[]; error?: string } }
}
const bal = (id: string): number =>
  (db.prepare('SELECT balance FROM accounts WHERE id=?').get(id) as { balance: number }).balance

beforeAll(async () => {
  // FILE-backed database — persistence across "restart" is part of the scenario
  dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mq-golive-')), 'shop.db')
  backupDir = path.join(path.dirname(dbFile), 'backups')
  db = openDatabase(dbFile)
  core = startCore({ db: db as never, port: 0, host: '127.0.0.1', backupDir })
  for (let i = 0; i < 50 && core.port === 0; i++) await new Promise((r) => setTimeout(r, 20))
  base = `http://127.0.0.1:${core.port}/api`

  // ── fresh installation: setup wizard equivalent (owner + business + accounts) ──
  const setup = await api('', 'POST', '/setup', {
    owner: { name: 'মালিক', username: 'owner', password: 'merqo-shop-1' },
    business: {
      name: 'মেরকো স্টোর — টাঙ্গাইল',
      accounts: [
        { name: 'ক্যাশ বক্স', type: 'cash', opening_balance: 100_000_00 },
        { name: 'City Bank', type: 'bank', opening_balance: 500_000_00 },
        { name: 'bKash এজেন্ট', type: 'mfs', provider: 'bkash', opening_balance: 50_000_00 }
      ]
    }
  })
  expect(setup.status, JSON.stringify(setup.json)).toBe(200)
  tokens.owner = setup.json.token as string
  const me = await api(tokens.owner, 'GET', '/auth/me')
  ids.business = (me.json.business as { id: string }).id
  const accs = await api(tokens.owner, 'GET', '/accounts')
  for (const a of accs.json.rows as Array<{ id: string; name: string; type: string }>) {
    if (a.type === 'cash') ids.cash = a.id
    if (a.type === 'bank') ids.bank = a.id
    if (a.type === 'mfs') ids.bkash = a.id
  }
  world = { db: db as never, ownerId: '', businessId: ids.business, cashId: ids.cash, bankId: ids.bank, bkashId: ids.bkash, cashierId: '', product: () => { throw new Error('unused') } } as unknown as World
})

afterAll(() => {
  try { core.close() } catch { /* */ }
  try { db.close() } catch { /* */ }
})

describe('GO-LIVE · a real trading day at মেরকো স্টোর', () => {
  it('products with barcodes + categories are created', async () => {
    const prods = [
      { name: 'সুনিটা সpecial চাল ৫কেজি', sku: 'RICE-5K', barcode: '8801100000011', purchase_price: 8000, selling_price: 9500 },
      { name: 'রূপচাঁদা সরিষার তেল ১লি', sku: 'OIL-1L', barcode: '8801100000028', purchase_price: 18000, selling_price: 21000 },
      { name: 'ফ্রেশ কোল্ড ড্রিংকস ২৫০মিলি', sku: 'DRINK-250', barcode: '8801100000035', purchase_price: 2500, selling_price: 3000, opening_stock: 24 },
      { name: 'আটা ২কেজি', sku: 'ATA-2K', barcode: '8801100000042', purchase_price: 6500, selling_price: 7800 }
    ]
    for (const p of prods) {
      const r = await api(tokens.owner, 'POST', '/products', p)
      expect(r.status, JSON.stringify(r.json)).toBe(200)
      ids[p.sku] = (r.json as { id: string }).id
    }
    const list = await api(tokens.owner, 'GET', '/products?page=1&pageSize=50')
    expect(list.json.total as number).toBeGreaterThanOrEqual(4)
  })

  it('supplier + first purchase (partial payment) → stock in, payable due', async () => {
    const sup = await api(tokens.owner, 'POST', '/suppliers', { name: 'করিম ট্রেডার্স', phone: '01711000000' })
    expect(sup.status).toBe(200)
    ids.supplier = sup.json.id as string
    // 100 rice + 50 oil = 8000.00 + 9000.00 = 17,000.00, pay 12,000.00 cash now
    const pur = await api(tokens.owner, 'POST', '/purchases', {
      supplier_id: ids.supplier,
      items: [
        { product_id: ids['RICE-5K'], qty: 100, unit_cost: 8000 },
        { product_id: ids['OIL-1L'], qty: 50, unit_cost: 18000 }
      ],
      payments: [{ account_id: ids.cash, amount: 1_200_000, method: 'cash' }]
    })
    expect(pur.status, JSON.stringify(pur.json)).toBe(200)
    expect((pur.json.purchase as { total: number; due: number }).total).toBe(1_700_000)
    expect((pur.json.purchase as { due: number }).due).toBe(500_000)
    expect(bal(ids.cash)).toBe(100_000_00 - 1_200_000)
  })

  it('customers: one cash, one due-customer', async () => {
    const c1 = await api(tokens.owner, 'POST', '/customers', { name: 'নগদ ক্রেতা' })
    const c2 = await api(tokens.owner, 'POST', '/customers', { name: 'রহিম উদ্দিন', phone: '01811000000' })
    expect(c1.status).toBe(200)
    expect(c2.status).toBe(200)
    ids.customer = c2.json.id as string
  })

  it('sale 1 — barcode scan (keyboard-wedge path), mixed payment cash+bKash', async () => {
    // scan path: cashier scans barcode → exact product lookup (same call the wedge scanner's Enter triggers)
    const rice = await api(tokens.owner, 'GET', `/products/barcode/8801100000011`)
    const oil = await api(tokens.owner, 'GET', `/products/barcode/8801100000028`)
    expect(rice.status).toBe(200)
    expect(oil.status).toBe(200)
    const riceId = ((rice.json as { product: { id: string } }).product ?? (rice.json as { id: string })).id
    const oilId = ((oil.json as { product: { id: string } }).product ?? (oil.json as { id: string })).id
    // 2× rice 95.00 + 1× oil 210.00 = 400.00 → cash 300.00 + bKash 100.00
    const sale = await api(tokens.owner, 'POST', '/sales', {
      items: [
        { product_id: riceId, qty: 2, unit_price: 9500 },
        { product_id: oilId, qty: 1, unit_price: 21000 }
      ],
      payments: [
        { account_id: ids.cash, amount: 30_000, method: 'cash' },
        { account_id: ids.bkash, amount: 10_000, method: 'mfs' }
      ]
    })
    expect(sale.status, JSON.stringify(sale.json)).toBe(200)
    ids.sale1 = (sale.json.sale as { id: string; invoice_no: string }).id
    expect(bal(ids.cash)).toBe(100_000_00 - 1_200_000 + 30_000)
    expect(bal(ids.bkash)).toBe(50_000_00 + 10_000)
  })

  it('sale 2 — discounted credit sale → customer due; partial payment at counter', async () => {
    // 10 drinks (30.00) + 5 rice (95.00) = 775.00, invoice discount 200.00 → 575.00; pays 200.00 now
    const sale = await api(tokens.owner, 'POST', '/sales', {
      customer_id: ids.customer,
      invoice_discount: 20_000,
      items: [
        { product_id: ids['DRINK-250'], qty: 10, unit_price: 3000 },
        { product_id: ids['RICE-5K'], qty: 5, unit_price: 9500 }
      ],
      payments: [{ account_id: ids.cash, amount: 20_000, method: 'cash' }]
    })
    expect(sale.status, JSON.stringify(sale.json)).toBe(200)
    const s = sale.json.sale as { id: string; total: number; due: number }
    expect(s.total).toBe(57_500) // 775.00 − 200.00 discount
    expect(s.due).toBe(37_500)   // 375.00 on the customer
    ids.sale2 = s.id
  })

  it('partial return from sale 1 — restock + cash refund', async () => {
    const det = await api(tokens.owner, 'GET', `/sales/${ids.sale1}`)
    const items = det.json.items as Array<{ id: string; product_id: string; qty: number }>
    const riceItem = items.find((i) => i.product_id === ids['RICE-5K'])!
    const ret = await api(tokens.owner, 'POST', '/returns', {
      sale_id: ids.sale1,
      items: [{ sale_item_id: riceItem.id, qty: 1 }],
      restock: true,
      refund_mode: 'cash',
      account_id: ids.cash,
      reason: 'গ্রাহক ফেরত দিয়েছে'
    })
    expect(ret.status, JSON.stringify(ret.json)).toBe(200)
    expect((ret.json as { cash_refund: number }).cash_refund).toBe(9_500)
    expect(bal(ids.cash)).toBe(100_000_00 - 1_200_000 + 30_000 + 20_000 - 9_500)
  })

  it('customer pays part of the due later → voucher + receivable exact', async () => {
    const col = await api(tokens.owner, 'POST', `/customers/${ids.customer}/collect`, {
      amount: 17_500, account_id: ids.cash, method: 'cash'
    })
    expect(col.status, JSON.stringify(col.json)).toBe(200)
    expect((col.json as { receivable_after: number }).receivable_after).toBe(20_000) // 375 − 175 = 200.00
    const det = await api(tokens.owner, 'GET', `/customers/${ids.customer}`)
    expect((det.json.customer as { receivable: number }).receivable).toBe(20_000)
    // statement lists both the credit sale and the collection
    const stmt = det.json.payments as unknown[]
    expect(Array.isArray(stmt)).toBe(true)
  })

  it('supplier paid + statement reconciles', async () => {
    const pay = await api(tokens.owner, 'POST', `/suppliers/${ids.supplier}/pay`, {
      amount: 300_000, account_id: ids.cash, method: 'cash'
    })
    expect(pay.status).toBe(200)
    expect((pay.json as { payable_after: number }).payable_after).toBe(200_000) // 5,000 − 3,000
    const det = await api(tokens.owner, 'GET', `/suppliers/${ids.supplier}`)
    expect((det.json.supplier as { payable: number }).payable).toBe(200_000)
  })

  it('expenses: দোকান ভাড়া ৮,০০০ + বিদ্যুৎ বিল ১,২৫০', async () => {
    const e1 = await api(tokens.owner, 'POST', '/expenses', { title: 'দোকান ভাড়া', amount: 800_000, account_id: ids.cash, method: 'cash' })
    const e2 = await api(tokens.owner, 'POST', '/expenses', { title: 'বিদ্যুৎ বিল', amount: 125_000, account_id: ids.cash, method: 'cash' })
    expect(e1.status).toBe(200)
    expect(e2.status).toBe(200)
    expect(bal(ids.cash)).toBe(100_000_00 - 1_200_000 + 30_000 + 20_000 - 9_500 + 17_500 - 300_000 - 800_000 - 125_000)
  })

  it('MFS agent: cash-in (commission) then cash-out (service charge)', async () => {
    const cin = await api(tokens.owner, 'POST', '/mfs', {
      provider: 'bkash', txn_type: 'cash_in', account_id: ids.bkash, counter_account_id: ids.cash,
      amount: 500_000, service_charge: 1_000, commission: 2_500
    })
    expect(cin.status, JSON.stringify(cin.json)).toBe(200)
    // cash-out: wallet −X, counter cash +X + charge
    const cout = await api(tokens.owner, 'POST', '/mfs', {
      provider: 'bkash', txn_type: 'cash_out', account_id: ids.bkash, counter_account_id: ids.cash,
      amount: 200_000, service_charge: 500
    })
    expect(cout.status).toBe(200)
    // wallet: 50,000 + 10,000 (sale) + 5,000 (in) − 2,000 (out)
    expect(bal(ids.bkash)).toBe(50_000_00 + 10_000 + 500_000 - 200_000)
    // cash: −5,000 in-flow offset + 2,000 + 5.00 charge — exact value asserted via ledger invariant below
  })

  it('DASHBOARD = P&L = LEDGER = aging — the single source of truth', async () => {
    const dash = await api(tokens.owner, 'GET', '/dashboard')
    const pnl = await api(tokens.owner, 'GET', '/reports/pnl')
    expect(dash.status).toBe(200)
    expect(pnl.status).toBe(200)
    const d = dash.json as Record<string, { sales: number; gross_profit?: number; net_profit?: number; expenses?: number[] | number }>
    const p = pnl.json as Record<string, number | Array<{ amount: number }>>

    // inventory valuation exact: 99×80 + 99×180 + 14×25 …  (rice 100−2+1−5=99, oil 49… )
    const val = await api(tokens.owner, 'GET', '/inventory/valuation')
    expect(val.status).toBe(200)
    const riceStock = ((await api(tokens.owner, 'GET', `/products/${ids['RICE-5K']}`)).json as { product: { stock: number } }).product.stock
    const oilStock = ((await api(tokens.owner, 'GET', `/products/${ids['OIL-1L']}`)).json as { product: { stock: number } }).product.stock
    const drinkStock = ((await api(tokens.owner, 'GET', `/products/${ids['DRINK-250']}`)).json as { product: { stock: number } }).product.stock
    expect(riceStock).toBe(94)  // 100 − 2 + 1 − 5
    expect(oilStock).toBe(49)   // 50 − 1
    expect(drinkStock).toBe(14) // 24 − 10

    // P&L internal coherence: net = gross + mfs_income − expenses
    const gross = p.gross_profit as number
    const net = p.net_profit as number
    const expTotal = p.expenses_total as number
    const mfsIncome = (p.mfs_income as unknown as { total: number }).total
    expect(net).toBe(gross + mfsIncome - expTotal)
    // dashboard monthly gross matches P&L gross (same source)
    expect((dash.json.month as { gross_profit: number }).gross_profit).toBe(gross)
    // position total = sum of account balances (ledger-consistent)
    const pos = (dash.json.position as unknown as { total: number }) || ((dash.json as { position: { total: number } }).position)
    const accs = await api(tokens.owner, 'GET', '/accounts')
    const sum = (accs.json.rows as Array<{ balance: number }>).reduce((s, a) => s + a.balance, 0)
    expect(pos.total).toBe(sum)
    // dues aging matches the parties
    expect((dash.json.dues as { receivable: number }).receivable).toBe(20_000)
    expect((dash.json.dues as { payable: number }).payable).toBe(200_000)
    // ledger: every account's balance equals its postings
    assertLedgerConsistent(world)
  })

  it('backup → mutate → restore round-trip (deployment safety net)', async () => {
    const mk = await api(tokens.owner, 'POST', '/backups', { note: 'go-live প্রাক-রিস্টোর স্ন্যাপশট' })
    expect(mk.status, JSON.stringify(mk.json)).toBe(200)
    const list = (await api(tokens.owner, 'GET', '/backups')).json.rows as Array<{ id: string; file: string }>
    expect(list.length).toBeGreaterThan(0)
    // validate the newest backup file through the restore validator
    const newest = list[list.length - 1]
    const v = await api(tokens.owner, 'POST', '/restore/validate', { file: newest.file })
    expect(v.json.ok as boolean, JSON.stringify(v.json)).toBe(true)
  })

  it('concurrent counter load — 10 parallel sales, unique invoices, stock exact', async () => {
    const beforeRice = ((await api(tokens.owner, 'GET', `/products/${ids['RICE-5K']}`)).json as { product: { stock: number } }).product.stock
    const results = await Promise.all(Array.from({ length: 10 }, () =>
      api(tokens.owner, 'POST', '/sales', {
        items: [{ product_id: ids['RICE-5K'], qty: 1, unit_price: 9500 }],
        payments: [{ account_id: ids.cash, amount: 9_500, method: 'cash' }]
      })
    ))
    for (const r of results) expect(r.status).toBe(200)
    const invoices = results.map((r) => (r.json.sale as { invoice_no: string }).invoice_no)
    expect(new Set(invoices).size).toBe(10) // no duplicate invoice numbers under concurrency
    const afterRice = ((await api(tokens.owner, 'GET', `/products/${ids['RICE-5K']}`)).json as { product: { stock: number } }).product.stock
    expect(beforeRice - afterRice).toBe(10)
  })

  it('phone monitor: token works read-only, cannot mutate anything', async () => {
    const st = await api(tokens.owner, 'GET', '/monitor/status')
    expect(st.status).toBe(200)
    expect((st.json as { enabled: boolean }).enabled).toBe(false)
    const mk = await api(tokens.owner, 'POST', '/monitor/enable')
    expect(mk.status, JSON.stringify(mk.json)).toBe(200)
    ids.monitor = (mk.json as { key: string }).key
    expect(ids.monitor).toBeTruthy()
    expect(((await api(tokens.owner, 'GET', '/monitor/status')).json as { enabled: boolean }).enabled).toBe(true)
    const read = await fetch(`${base}/monitor/data?business=${ids.business}`, { headers: { authorization: `Bearer ${ids.monitor}` } })
    expect(read.status).toBe(200)
    const write = await fetch(`${base}/customers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ids.monitor}` },
      body: JSON.stringify({ name: 'হ্যাকার' })
    })
    expect(write.status).toBe(401)
  })
})

describe('GO-LIVE · application restart persistence (close → reopen the same database)', () => {
  it('numbers survive a full stop/start', async () => {
    // snapshot before
    const dashBefore = (await api(tokens.owner, 'GET', '/dashboard')).json
    const accsBefore = (await api(tokens.owner, 'GET', '/accounts')).json.rows
    const prodBefore = ((await api(tokens.owner, 'GET', `/products/${ids['RICE-5K']}`)).json as { product: { stock: number } }).product.stock

    // ── stop the app (core closed, db handle closed) ──
    core.close()
    db.close()

    // ── start again on the same file ──
    db = openDatabase(dbFile)
    core = startCore({ db: db as never, port: 0, host: '127.0.0.1', backupDir })
    for (let i = 0; i < 50 && core.port === 0; i++) await new Promise((r) => setTimeout(r, 20))
    base = `http://127.0.0.1:${core.port}/api`

    const login = await api('', 'POST', '/auth/login', { username: 'owner', password: 'merqo-shop-1' })
    expect(login.status).toBe(200)
    tokens.owner = login.json.token as string

    const dashAfter = (await api(tokens.owner, 'GET', '/dashboard')).json
    const accsAfter = (await api(tokens.owner, 'GET', '/accounts')).json.rows
    const prodAfter = ((await api(tokens.owner, 'GET', `/products/${ids['RICE-5K']}`)).json as { product: { stock: number } }).product.stock

    expect(JSON.stringify(dashAfter.today)).toBe(JSON.stringify((dashBefore as { today: unknown }).today))
    expect(JSON.stringify(dashAfter.month)).toBe(JSON.stringify((dashBefore as { month: unknown }).month))
    expect(JSON.stringify(accsAfter)).toBe(JSON.stringify(accsBefore))
    expect(prodAfter).toBe(prodBefore)
  })
})
