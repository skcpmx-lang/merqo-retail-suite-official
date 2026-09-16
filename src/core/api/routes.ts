import { Router } from 'express'
import type { DB } from '../db/connection'
import { PERMS } from '../permissions'
import {
  hashPassword, verifyPassword, createSession, revokeSession, setSessionBusiness,
  loginLockState, recordLoginFailure, clearLoginFailures, newMonitorToken, sha256
} from '../auth'
import * as staff from '../services/staff'
import * as biz from '../services/businesses'
import * as products from '../services/products'
import * as sales from '../services/sales'
import * as purchases from '../services/purchases'
import * as parties from '../services/parties'
import * as payments from '../services/payments'
import * as accounts from '../services/accounts'
import * as expenses from '../services/expenses'
import * as mfs from '../services/mfs'
import * as reports from '../services/reports'
import * as dashboard from '../services/dashboard'
import * as notif from '../services/notifications'
import * as settingsSvc from '../services/settings'
import * as dataio from '../services/dataio'
import * as searchSvc from '../services/search'
import * as auditSvc from '../services/audit'
import { CoreError } from '../services/accounts'
import { audit } from '../services/audit'
import { newId } from '../ids'
import { h, requireAuth, requirePerm, authMiddleware, paging, rangeFromQuery, ctxOf, has, qs, prm } from './http'

export function buildRoutes(db: DB, core: { initialized: () => boolean; monitorToken: () => string | null; setMonitorToken: (t: string | null) => void }): Router {
  const r = Router()

  /* ───────────── meta & setup ───────────── */
  r.get('/meta', h((_req, res) => {
    const users = (db.prepare(`SELECT COUNT(*) c FROM users`).get() as { c: number }).c
    res.json({ app: 'MERQO Retail Suite', initialized: users > 0, coreReady: true })
  }))

  r.post('/setup', h((req, res) => {
    const users = (db.prepare(`SELECT COUNT(*) c FROM users`).get() as { c: number }).c
    if (users > 0) throw new CoreError('ALREADY_INITIALIZED', 'সেটআপ ইতিমধ্যে সম্পন্ন।', 409)
    const { owner, business } = req.body ?? {}
    if (!owner?.name || !owner?.username || !owner?.password) throw new CoreError('BAD_INPUT', 'মালিকের তথ্য পূরণ করুন।')
    if (!business?.name) throw new CoreError('BAD_INPUT', 'ব্যবসার নাম দিন।')
    const userId = staff.createUser(db, {}, { name: owner.name, username: owner.username, password: owner.password, phone: owner.phone }).id
    const b = biz.createBusiness(db, { userId, userName: owner.name }, userId, {
      name: business.name, owner_name: owner.name, phone: business.phone, email: business.email,
      address: business.address, biz_type: business.biz_type, logo_data: business.logo_data,
      accounts: business.accounts
    })
    const sess = createSession(db, userId, b.id, { ip: req.ip, userAgent: req.headers['user-agent'] })
    res.json({ token: sess.token, expires_at: sess.expiresAt, business_id: b.id })
  }))

  /* ───────────── auth ───────────── */
  r.post('/auth/login', h((req, res) => {
    const { username, password, business_id } = req.body ?? {}
    if (!username || !password) throw new CoreError('BAD_INPUT', 'ইউজারনেম ও পাসওয়ার্ড দিন।')
    const key = String(username).toLowerCase()
    const lock = loginLockState(key)
    if (lock.locked) throw new CoreError('LOCKED', `অনেকবার ভুল হয়েছে — ${lock.retryAfterSec} সেকেন্ড পরে চেষ্টা করুন।`, 429)

    const user = db.prepare(`SELECT * FROM users WHERE username=?`).get(key) as
      | { id: string; name: string; password_hash: string; status: string }
      | undefined
    if (!user || !verifyPassword(password, user.password_hash)) {
      const max = settingsSvc.getSetting<number>(db, '', 'login_max_attempts') || 5
      const lockMin = settingsSvc.getSetting<number>(db, '', 'lockout_minutes') || 10
      recordLoginFailure(key, max, lockMin)
      throw new CoreError('BAD_CREDENTIALS', 'ইউজারনেম বা পাসওয়ার্ড সঠিক নয়।', 401)
    }
    if (user.status !== 'active') throw new CoreError('USER_DISABLED', 'এই অ্যাকাউন্টটি নিষ্ক্রিয় করা হয়েছে।', 403)
    clearLoginFailures(key)
    db.prepare(`UPDATE users SET last_login_at=? WHERE id=?`).run(Date.now(), user.id)

    let businessId: string | null = business_id ?? null
    const businesses = biz.businessesForUser(db, user.id)
    if (businessId && !businesses.some((b) => b.id === businessId)) businessId = null
    if (!businessId) businessId = businesses[0]?.id ?? null

    const sess = createSession(db, user.id, businessId, { ip: req.ip, userAgent: req.headers['user-agent'] })
    audit(db, { userId: user.id, userName: user.name, businessId }, 'auth.login', 'session', sess.token.slice(0, 8))
    res.json({
      token: sess.token, expires_at: sess.expiresAt, user: { id: user.id, name: user.name },
      business_id: businessId, businesses
    })
  }))

  r.post('/auth/logout', h((req, res) => {
    const token = req.headers['authorization']?.slice(7)
    if (req.auth) audit(db, ctxOf(req), 'auth.logout', 'session')
    revokeSession(db, token)
    res.json({ ok: true })
  }))

  r.get('/auth/me', h((req, res) => {
    if (!req.session) throw new CoreError('UNAUTHENTICATED', 'অনুগ্রহ করে লগইন করুন।', 401)
    const user = staff.getUser(db, req.session.userId)
    const businesses = biz.businessesForUser(db, user.id)
    const business = req.session.businessId ? biz.getBusiness(db, req.session.businessId) : null
    const perms = business ? staff.effectivePermissions(db, user.id, business.id) : []
    const pinRow = db.prepare(`SELECT pin_hash FROM users WHERE id=?`).get(user.id) as { pin_hash: string | null } | undefined
    res.json({ user, business, businesses, perms, has_pin: !!pinRow?.pin_hash })
  }))

  r.post('/auth/business', requireAuth, h((req, res) => {
    const { business_id } = req.body ?? {}
    const businesses = biz.businessesForUser(db, req.auth!.userId)
    if (!businesses.some((b) => b.id === business_id)) throw new CoreError('FORBIDDEN', 'এই ব্যবসায় আপনার অ্যাক্সেস নেই।', 403)
    setSessionBusiness(db, req.auth!.sessionId, business_id)
    res.json({ ok: true, business_id })
  }))

  r.post('/auth/pin/setup', requireAuth, h((req, res) => {
    const { pin, current_password } = req.body ?? {}
    if (!pin || !/^\d{4,6}$/.test(pin)) throw new CoreError('BAD_PIN', 'পিন ৪–৬ সংখ্যার হবে।')
    const user = db.prepare(`SELECT password_hash FROM users WHERE id=?`).get(req.auth!.userId) as { password_hash: string }
    if (!verifyPassword(current_password ?? '', user.password_hash)) throw new CoreError('BAD_PASSWORD', 'পাসওয়ার্ড সঠিক নয়।')
    db.prepare(`UPDATE users SET pin_hash=? WHERE id=?`).run(hashPassword(pin), req.auth!.userId)
    audit(db, ctxOf(req), 'auth.pin_setup', 'user', req.auth!.userId)
    res.json({ ok: true })
  }))

  r.post('/auth/pin/verify', h((req, res) => {
    if (!req.session) throw new CoreError('UNAUTHENTICATED', 'অনুগ্রহ করে লগইন করুন।', 401)
    const { pin } = req.body ?? {}
    const user = db.prepare(`SELECT pin_hash FROM users WHERE id=?`).get(req.session.userId) as { pin_hash: string | null }
    if (!user.pin_hash || !verifyPassword(String(pin ?? ''), user.pin_hash)) throw new CoreError('BAD_PIN', 'পিন সঠিক নয়।')
    res.json({ ok: true })
  }))

  r.post('/auth/change-password', requireAuth, h((req, res) => {
    const { current, next } = req.body ?? {}
    const user = db.prepare(`SELECT password_hash FROM users WHERE id=?`).get(req.auth!.userId) as { password_hash: string }
    if (!verifyPassword(current ?? '', user.password_hash)) throw new CoreError('BAD_PASSWORD', 'বর্তমান পাসওয়ার্ড সঠিক নয়।')
    if (!next || next.length < 6) throw new CoreError('WEAK_PASSWORD', 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।')
    db.prepare(`UPDATE users SET password_hash=? WHERE id=?`).run(hashPassword(next), req.auth!.userId)
    audit(db, ctxOf(req), 'auth.password_change', 'user', req.auth!.userId)
    res.json({ ok: true })
  }))

  /* ───────────── dashboard ───────────── */
  r.get('/dashboard', requireAuth, requirePerm(PERMS.DASHBOARD_VIEW), h((req, res) => {
    res.json(dashboard.dashboard(db, req.auth!.businessId))
  }))

  /* ───────────── products & inventory ───────────── */
  r.get('/products', requireAuth, requirePerm(PERMS.PRODUCTS_VIEW), h((req, res) => {
    const p = paging(req, 30)
    const out = products.listProducts(db, req.auth!.businessId, {
      search: qs(req, 'search'), category_id: qs(req, 'category_id'), brand_id: qs(req, 'brand_id'),
      supplier_id: qs(req, 'supplier_id'),
      status: (req.query.status as 'active') ?? 'active', stockFilter: req.query.stock as 'all',
      sort: req.query.sort as 'name', dir: req.query.dir as 'asc', ...p
    })
    res.json(out)
  }))

  r.get('/products/barcode/:code', requireAuth, requirePerm(PERMS.PRODUCTS_VIEW), h((req, res) => {
    const p = products.findByBarcode(db, req.auth!.businessId, prm(req, 'code'))
    res.json({ product: p })
  }))

  r.get('/products/:id', requireAuth, requirePerm(PERMS.PRODUCTS_VIEW), h((req, res) => {
    const product = products.getProduct(db, req.auth!.businessId, prm(req, 'id'))
    const movements = db.prepare(`SELECT * FROM stock_movements WHERE product_id=? ORDER BY created_at DESC LIMIT 100`).all(prm(req, 'id'))
    res.json({ product, movements })
  }))

  r.post('/products', requireAuth, requirePerm(PERMS.PRODUCTS_CREATE), h((req, res) => {
    res.json(products.createProduct(db, ctxOf(req), req.auth!.businessId, req.body))
  }))

  r.patch('/products/:id', requireAuth, requirePerm(PERMS.PRODUCTS_EDIT), h((req, res) => {
    res.json(products.updateProduct(db, ctxOf(req), req.auth!.businessId, prm(req, 'id'), req.body))
  }))

  r.delete('/products/:id', requireAuth, requirePerm(PERMS.PRODUCTS_DELETE), h((req, res) => {
    products.deleteProduct(db, ctxOf(req), req.auth!.businessId, prm(req, 'id'))
    res.json({ ok: true })
  }))

  r.post('/products/:id/adjust', requireAuth, requirePerm(PERMS.INVENTORY_ADJUST), h((req, res) => {
    res.json(products.adjustStock(db, ctxOf(req), req.auth!.businessId, prm(req, 'id'), req.body))
    runNotifs(req.auth!.businessId, [prm(req, 'id')])
  }))

  r.post('/products/barcodes', requireAuth, requirePerm(PERMS.PRODUCTS_EDIT), h((req, res) => {
    res.json({ id: products.addBarcode(db, ctxOf(req), req.auth!.businessId, req.body.product_id, req.body.barcode, req.body.type) })
  }))

  r.delete('/products/barcodes/:id', requireAuth, requirePerm(PERMS.PRODUCTS_EDIT), h((req, res) => {
    products.removeBarcode(db, ctxOf(req), req.auth!.businessId, prm(req, 'id'))
    res.json({ ok: true })
  }))

  r.get('/inventory/movements', requireAuth, requirePerm(PERMS.INVENTORY_VIEW), h((req, res) => {
    const p = paging(req, 30)
    res.json(products.stockMovements(db, req.auth!.businessId, qs(req, 'product_id'), p.page, p.pageSize))
  }))

  r.get('/inventory/valuation', requireAuth, requirePerm(PERMS.INVENTORY_VIEW), h((req, res) => {
    res.json({
      summary: products.stockValuation(db, req.auth!.businessId),
      by_category: reports.stockValuationByCategory(db, req.auth!.businessId)
    })
  }))

  r.get('/inventory/low', requireAuth, requirePerm(PERMS.INVENTORY_VIEW), h((req, res) => res.json({ rows: reports.lowStockReport(db, req.auth!.businessId) })))
  r.get('/inventory/out', requireAuth, requirePerm(PERMS.INVENTORY_VIEW), h((req, res) => res.json({ rows: reports.outOfStockReport(db, req.auth!.businessId) })))

  /* ───────────── sales & returns ───────────── */
  r.get('/sales', requireAuth, requirePerm(PERMS.SALES_VIEW), h((req, res) => {
    const p = paging(req, 30)
    res.json(sales.listSales(db, req.auth!.businessId, { ...rangeFromQuery(req), customer_id: qs(req, 'customer_id'), user_id: qs(req, 'user_id'), method: qs(req, 'method'), dueOnly: qs(req, 'due') === '1', search: qs(req, 'search'), status: qs(req, 'status'), ...p }))
  }))

  r.get('/sales/:id', requireAuth, requirePerm(PERMS.SALES_VIEW), h((req, res) => {
    const sale = sales.getSale(db, req.auth!.businessId, prm(req, 'id'))
    const items = db.prepare(`SELECT * FROM sale_items WHERE sale_id=?`).all(prm(req, 'id'))
    const returns_ = db.prepare(`SELECT r.*, u.name user_name FROM returns_ r LEFT JOIN users u ON u.id=r.user_id WHERE r.sale_id=? ORDER BY r.date DESC`).all(prm(req, 'id'))
    const pays = db.prepare(`SELECT p.*, a.name account_name FROM payments p LEFT JOIN accounts a ON a.id=p.account_id WHERE p.ref_type='sale' AND p.ref_id=?`).all(prm(req, 'id'))
    res.json({ sale, items, returns: returns_, payments: pays })
  }))

  r.post('/sales', requireAuth, requirePerm(PERMS.POS_USE), h((req, res) => {
    const input = req.body as sales.SaleInput
    // price override & discount gating
    for (const it of input.items ?? []) {
      if (it.unit_price != null && it.unit_price !== undefined && !has(req, PERMS.POS_PRICE_OVERRIDE)) {
        const p = db.prepare(`SELECT selling_price FROM products WHERE id=? AND business_id=?`).get(it.product_id, req.auth!.businessId) as { selling_price: number } | undefined
        if (p && it.unit_price !== p.selling_price) throw new CoreError('FORBIDDEN_PRICE', 'দাম পরিবর্তনের অনুমতি আপনার নেই।', 403)
      }
      if ((it.discount != null && it.discount > 0) || (it.discount_pct != null && it.discount_pct > 0)) {
        if (!has(req, PERMS.POS_DISCOUNT)) throw new CoreError('FORBIDDEN_DISCOUNT', 'ডিসকাউন্ট দেওয়ার অনুমতি আপনার নেই।', 403)
      }
    }
    if ((input.invoice_discount ?? 0) > 0 && !has(req, PERMS.POS_DISCOUNT)) throw new CoreError('FORBIDDEN_DISCOUNT', 'ডিসকাউন্ট দেওয়ার অনুমতি আপনার নেই।', 403)
    const out = sales.createSale(db, ctxOf(req), req.auth!.businessId, input)
    const productIds = (req.body.items ?? []).map((i: { product_id: string }) => i.product_id)
    runNotifs(req.auth!.businessId, productIds)
    res.json(out)
  }))

  r.post('/sales/:id/void', requireAuth, requirePerm(PERMS.SALES_VOID), h((req, res) => {
    sales.voidSale(db, ctxOf(req), req.auth!.businessId, prm(req, 'id'), req.body?.reason)
    runNotifs(req.auth!.businessId)
    res.json({ ok: true })
  }))

  r.post('/returns', requireAuth, requirePerm(PERMS.RETURNS_MAKE), h((req, res) => {
    const out = sales.createReturn(db, ctxOf(req), req.auth!.businessId, req.body as sales.ReturnInput)
    const items = db.prepare(`SELECT product_id FROM return_items WHERE return_id=?`).all(out.id) as Array<{ product_id: string | null }>
    runNotifs(req.auth!.businessId, items.map((i) => i.product_id).filter(Boolean) as string[])
    res.json(out)
  }))

  r.get('/returns', requireAuth, requirePerm(PERMS.SALES_VIEW), h((req, res) => {
    const p = paging(req, 30)
    const { from, to } = rangeFromQuery(req)
    const where: string[] = ['r.business_id = ?']
    const args: unknown[] = [req.auth!.businessId]
    if (from) { where.push('r.date >= ?'); args.push(from) }
    if (to) { where.push('r.date <= ?'); args.push(to) }
    const w = where.join(' AND ')
    const total = (db.prepare(`SELECT COUNT(*) c FROM returns_ r WHERE ${w}`).get(...args) as { c: number }).c
    const rows = db.prepare(`SELECT r.*, u.name user_name FROM returns_ r LEFT JOIN users u ON u.id=r.user_id WHERE ${w} ORDER BY r.date DESC LIMIT ? OFFSET ?`).all(...args, p.pageSize, (p.page - 1) * p.pageSize)
    res.json({ rows, total })
  }))

  /* ───────────── purchases ───────────── */
  r.get('/purchases', requireAuth, requirePerm(PERMS.PURCHASES_VIEW), h((req, res) => {
    const p = paging(req, 30)
    res.json(purchases.listPurchases(db, req.auth!.businessId, { ...rangeFromQuery(req), supplier_id: qs(req, 'supplier_id'), dueOnly: qs(req, 'due') === '1', search: qs(req, 'search'), ...p }))
  }))

  r.get('/purchases/:id', requireAuth, requirePerm(PERMS.PURCHASES_VIEW), h((req, res) => {
    const purchase = purchases.getPurchase(db, req.auth!.businessId, prm(req, 'id'))
    const items = purchases.getPurchaseItems(db, prm(req, 'id'))
    const pays = db.prepare(`SELECT p.*, a.name account_name FROM payments p LEFT JOIN accounts a ON a.id=p.account_id WHERE p.ref_type='purchase' AND p.ref_id=?`).all(prm(req, 'id'))
    res.json({ purchase, items, payments: pays })
  }))

  r.post('/purchases', requireAuth, requirePerm(PERMS.PURCHASES_CREATE), h((req, res) => {
    const out = purchases.createPurchase(db, ctxOf(req), req.auth!.businessId, req.body)
    const items = (req.body.items ?? []) as Array<{ product_id: string }>
    runNotifs(req.auth!.businessId, items.map((i) => i.product_id))
    res.json(out)
  }))

  r.post('/purchases/:id/void', requireAuth, requirePerm(PERMS.PURCHASES_EDIT), h((req, res) => {
    purchases.voidPurchase(db, ctxOf(req), req.auth!.businessId, prm(req, 'id'), req.body?.reason)
    runNotifs(req.auth!.businessId)
    res.json({ ok: true })
  }))

  /* ───────────── customers & suppliers ───────────── */
  r.get('/customers', requireAuth, requirePerm(PERMS.CUSTOMERS_VIEW), h((req, res) => {
    const p = paging(req, 30)
    res.json(parties.listCustomers(db, req.auth!.businessId, { search: qs(req, 'search'), status: qs(req, 'status'), dueOnly: qs(req, 'due') === '1', sort: qs(req, 'sort'), dir: qs(req, 'dir'), ...p }))
  }))

  r.post('/customers', requireAuth, requirePerm(PERMS.CUSTOMERS_MANAGE), h((req, res) => res.json(parties.createCustomer(db, ctxOf(req), req.auth!.businessId, req.body))))

  r.get('/customers/:id', requireAuth, requirePerm(PERMS.CUSTOMERS_VIEW), h((req, res) => {
    const customer = parties.getCustomer(db, req.auth!.businessId, prm(req, 'id'))
    const salesRows = db.prepare(`SELECT id, invoice_no, date, total, paid, due, status FROM sales WHERE customer_id=? AND business_id=? AND status<>'voided' ORDER BY date DESC LIMIT 100`).all(prm(req, 'id'), req.auth!.businessId)
    const paymentRows = db.prepare(`SELECT * FROM payments WHERE party_id=? AND party_type='customer' AND business_id=? ORDER BY date DESC LIMIT 100`).all(prm(req, 'id'), req.auth!.businessId)
    res.json({ customer, sales: salesRows, payments: paymentRows })
  }))

  r.patch('/customers/:id', requireAuth, requirePerm(PERMS.CUSTOMERS_MANAGE), h((req, res) => res.json(parties.updateCustomer(db, ctxOf(req), req.auth!.businessId, prm(req, 'id'), req.body))))

  r.post('/customers/:id/collect', requireAuth, requirePerm(PERMS.DUES_COLLECT), h((req, res) => {
    const out = payments.collectCustomerDue(db, ctxOf(req), req.auth!.businessId, { ...req.body, customer_id: prm(req, 'id') })
    res.json(out)
  }))

  r.get('/suppliers', requireAuth, requirePerm(PERMS.SUPPLIERS_VIEW), h((req, res) => {
    const p = paging(req, 30)
    res.json(parties.listSuppliers(db, req.auth!.businessId, { search: qs(req, 'search'), status: qs(req, 'status'), dueOnly: qs(req, 'due') === '1', ...p }))
  }))

  r.post('/suppliers', requireAuth, requirePerm(PERMS.SUPPLIERS_MANAGE), h((req, res) => res.json(parties.createSupplier(db, ctxOf(req), req.auth!.businessId, req.body))))

  r.get('/suppliers/:id', requireAuth, requirePerm(PERMS.SUPPLIERS_VIEW), h((req, res) => {
    const supplier = parties.getSupplier(db, req.auth!.businessId, prm(req, 'id'))
    const purchaseRows = db.prepare(`SELECT id, ref_no, date, total, paid, due, status FROM purchases WHERE supplier_id=? AND business_id=? AND status<>'voided' ORDER BY date DESC LIMIT 100`).all(prm(req, 'id'), req.auth!.businessId)
    const paymentRows = db.prepare(`SELECT * FROM payments WHERE party_id=? AND party_type='supplier' AND business_id=? ORDER BY date DESC LIMIT 100`).all(prm(req, 'id'), req.auth!.businessId)
    res.json({ supplier, purchases: purchaseRows, payments: paymentRows })
  }))

  r.patch('/suppliers/:id', requireAuth, requirePerm(PERMS.SUPPLIERS_MANAGE), h((req, res) => res.json(parties.updateSupplier(db, ctxOf(req), req.auth!.businessId, prm(req, 'id'), req.body))))

  r.post('/suppliers/:id/pay', requireAuth, requirePerm(PERMS.DUES_PAY), h((req, res) => {
    res.json(payments.paySupplierDue(db, ctxOf(req), req.auth!.businessId, { ...req.body, supplier_id: prm(req, 'id') }))
  }))

  /* ───────────── accounts / ledger / transfers / payments list ───────────── */
  r.get('/accounts', requireAuth, requirePerm(PERMS.ACCOUNTS_VIEW), h((req, res) => {
    res.json({ rows: accounts.listAccounts(db, req.auth!.businessId, qs(req, 'all') === '1') })
  }))

  r.post('/accounts', requireAuth, requirePerm(PERMS.ACCOUNTS_MANAGE), h((req, res) => res.json(accounts.createAccount(db, ctxOf(req), req.auth!.businessId, req.body))))

  r.patch('/accounts/:id', requireAuth, requirePerm(PERMS.ACCOUNTS_MANAGE), h((req, res) => res.json(accounts.updateAccount(db, ctxOf(req), req.auth!.businessId, prm(req, 'id'), req.body))))

  r.get('/accounts/:id/ledger', requireAuth, requirePerm(PERMS.ACCOUNTS_VIEW), h((req, res) => {
    const p = paging(req, 40)
    res.json(accounts.accountLedger(db, req.auth!.businessId, { accountId: prm(req, 'id'), ...rangeFromQuery(req), ...p }))
  }))

  r.get('/ledger', requireAuth, requirePerm(PERMS.ACCOUNTS_VIEW), h((req, res) => {
    const p = paging(req, 40)
    res.json(accounts.accountLedger(db, req.auth!.businessId, { accountId: qs(req, 'account_id'), ...rangeFromQuery(req), ...p }))
  }))

  r.get('/transfers', requireAuth, requirePerm(PERMS.ACCOUNTS_VIEW), h((req, res) => {
    const p = paging(req, 30)
    const { from, to } = rangeFromQuery(req)
    const where: string[] = ['business_id = ?']
    const args: unknown[] = [req.auth!.businessId]
    if (from) { where.push('date >= ?'); args.push(from) }
    if (to) { where.push('date <= ?'); args.push(to) }
    const w = where.join(' AND ')
    const total = (db.prepare(`SELECT COUNT(*) c FROM transfers WHERE ${w}`).get(...args) as { c: number }).c
    const rows = db.prepare(`SELECT t.*, fa.name from_name, ta.name to_name FROM transfers t JOIN accounts fa ON fa.id=t.from_account JOIN accounts ta ON ta.id=t.to_account WHERE ${w} ORDER BY t.date DESC LIMIT ? OFFSET ?`).all(...args, p.pageSize, (p.page - 1) * p.pageSize)
    res.json({ rows, total })
  }))

  r.post('/transfers', requireAuth, requirePerm(PERMS.ACCOUNTS_TRANSFER), h((req, res) => {
    accounts.transferFunds(db, ctxOf(req), req.auth!.businessId, req.body)
    res.json({ ok: true })
  }))

  r.get('/payments', requireAuth, requirePerm(PERMS.SALES_VIEW), h((req, res) => {
    const p = paging(req, 30)
    res.json(payments.listPayments(db, req.auth!.businessId, { ...rangeFromQuery(req), party_type: qs(req, 'party_type'), party_id: qs(req, 'party_id'), direction: qs(req, 'direction'), account_id: qs(req, 'account_id'), method: qs(req, 'method'), ref_type: qs(req, 'ref_type'), ...p }))
  }))

  /* ───────────── expenses ───────────── */
  r.get('/expenses', requireAuth, requirePerm(PERMS.EXPENSES_VIEW), h((req, res) => {
    const p = paging(req, 30)
    res.json(expenses.listExpenses(db, req.auth!.businessId, { ...rangeFromQuery(req), category_id: qs(req, 'category_id'), account_id: qs(req, 'account_id'), search: qs(req, 'search'), ...p }))
  }))

  r.post('/expenses', requireAuth, requirePerm(PERMS.EXPENSES_CREATE), h((req, res) => res.json(expenses.createExpense(db, ctxOf(req), req.auth!.businessId, req.body))))

  r.post('/expenses/:id/void', requireAuth, requirePerm(PERMS.EXPENSES_DELETE), h((req, res) => {
    expenses.voidExpense(db, ctxOf(req), req.auth!.businessId, prm(req, 'id'), req.body?.reason)
    res.json({ ok: true })
  }))

  r.get('/expense-categories', requireAuth, requirePerm(PERMS.EXPENSES_VIEW), h((req, res) => res.json({ rows: expenses.listExpenseCategories(db, req.auth!.businessId) })))

  r.post('/expense-categories', requireAuth, requirePerm(PERMS.EXPENSES_CREATE), h((req, res) => res.json({ id: expenses.createExpenseCategory(db, ctxOf(req), req.auth!.businessId, req.body?.name) })))

  /* ───────────── MFS agent ───────────── */
  r.get('/mfs', requireAuth, requirePerm(PERMS.MFS_VIEW), h((req, res) => {
    const p = paging(req, 30)
    res.json(mfs.listMfsTxns(db, req.auth!.businessId, { ...rangeFromQuery(req), provider: qs(req, 'provider'), txn_type: qs(req, 'txn_type'), account_id: qs(req, 'account_id'), ...p }))
  }))

  r.post('/mfs', requireAuth, requirePerm(PERMS.MFS_OPERATE), h((req, res) => res.json(mfs.createMfsTxn(db, ctxOf(req), req.auth!.businessId, req.body))))

  r.get('/mfs/summary', requireAuth, requirePerm(PERMS.MFS_VIEW), h((req, res) => {
    const { from, to } = rangeFromQuery(req)
    res.json({ rows: reports.mfsSummary(db, req.auth!.businessId, { from: from ?? 0, to: to ?? Date.now() }) })
  }))

  r.get('/mfs/suggest-commission', requireAuth, requirePerm(PERMS.MFS_VIEW), h((req, res) => {
    const commission = mfs.suggestCommission(db, req.auth!.businessId, qs(req, 'provider') ?? 'bkash', (qs(req, 'txn_type') as 'cash_in' | 'cash_out') ?? 'cash_in', Number(qs(req, 'amount')) || 0)
    res.json({ commission })
  }))

  /* ───────────── reports ───────────── */
  r.get('/reports/pnl', requireAuth, requirePerm(PERMS.FINANCE_VIEW), h((req, res) => {
    const { from, to } = rangeFromQuery(req)
    res.json(reports.profitLoss(db, req.auth!.businessId, { from: from ?? 0, to: to ?? Date.now() }))
  }))

  r.get('/reports/daily-series', requireAuth, requirePerm(PERMS.REPORTS_VIEW), h((req, res) => {
    const { from, to } = rangeFromQuery(req)
    res.json({ rows: reports.dailySeries(db, req.auth!.businessId, { from: from ?? 0, to: to ?? Date.now() }) })
  }))

  r.get('/reports/top-products', requireAuth, requirePerm(PERMS.REPORTS_VIEW), h((req, res) => {
    const { from, to } = rangeFromQuery(req)
    res.json({ rows: reports.topProducts(db, req.auth!.businessId, { from: from ?? 0, to: to ?? Date.now() }, Number(qs(req, 'limit')) || 10, req.query.by as 'revenue') })
  }))

  r.get('/reports/category-sales', requireAuth, requirePerm(PERMS.REPORTS_VIEW), h((req, res) => {
    const { from, to } = rangeFromQuery(req)
    res.json({ rows: reports.categorySales(db, req.auth!.businessId, { from: from ?? 0, to: to ?? Date.now() }) })
  }))

  r.get('/reports/staff-sales', requireAuth, requirePerm(PERMS.REPORTS_VIEW), h((req, res) => {
    const { from, to } = rangeFromQuery(req)
    res.json({ rows: reports.staffSales(db, req.auth!.businessId, { from: from ?? 0, to: to ?? Date.now() }) })
  }))

  r.get('/reports/method-sales', requireAuth, requirePerm(PERMS.REPORTS_VIEW), h((req, res) => {
    const { from, to } = rangeFromQuery(req)
    res.json({ rows: reports.methodSales(db, req.auth!.businessId, { from: from ?? 0, to: to ?? Date.now() }) })
  }))

  r.get('/reports/customer-sales', requireAuth, requirePerm(PERMS.REPORTS_VIEW), h((req, res) => {
    const { from, to } = rangeFromQuery(req)
    res.json({ rows: reports.customerSales(db, req.auth!.businessId, { from: from ?? 0, to: to ?? Date.now() }) })
  }))

  r.get('/reports/supplier-purchases', requireAuth, requirePerm(PERMS.REPORTS_VIEW), h((req, res) => {
    const { from, to } = rangeFromQuery(req)
    res.json({ rows: reports.supplierPurchases(db, req.auth!.businessId, { from: from ?? 0, to: to ?? Date.now() }) })
  }))

  r.get('/reports/product-purchases', requireAuth, requirePerm(PERMS.REPORTS_VIEW), h((req, res) => {
    const { from, to } = rangeFromQuery(req)
    res.json({ rows: reports.productPurchases(db, req.auth!.businessId, { from: from ?? 0, to: to ?? Date.now() }) })
  }))

  r.get('/reports/dead-stock', requireAuth, requirePerm(PERMS.REPORTS_VIEW), h((req, res) => {
    res.json({ rows: reports.deadStock(db, req.auth!.businessId, Number(qs(req, 'days')) || 60) })
  }))

  r.get('/reports/receivables', requireAuth, requirePerm(PERMS.DUES_VIEW), h((req, res) => res.json({ rows: reports.receivables(db, req.auth!.businessId) })))
  r.get('/reports/payables', requireAuth, requirePerm(PERMS.DUES_VIEW), h((req, res) => res.json({ rows: reports.payables(db, req.auth!.businessId) })))

  r.get('/reports/cashflow', requireAuth, requirePerm(PERMS.FINANCE_VIEW), h((req, res) => {
    const { from, to } = rangeFromQuery(req)
    res.json(reports.cashflow(db, req.auth!.businessId, { from: from ?? 0, to: to ?? Date.now() }))
  }))

  r.get('/reports/expiry', requireAuth, requirePerm(PERMS.INVENTORY_VIEW), h((req, res) => {
    res.json({ rows: reports.expiryReport(db, req.auth!.businessId, Number(qs(req, 'days')) || 30) })
  }))

  /* ───────────── notifications ───────────── */
  r.get('/notifications', requireAuth, requirePerm(PERMS.NOTIFICATIONS_VIEW), h((req, res) => {
    const p = paging(req, 30)
    res.json(notif.listNotifications(db, req.auth!.businessId, { unreadOnly: qs(req, 'unread') === '1', ...p }))
  }))

  r.post('/notifications/:id/read', requireAuth, h((req, res) => { notif.markRead(db, req.auth!.businessId, prm(req, 'id')); res.json({ ok: true }) }))
  r.post('/notifications/read-all', requireAuth, h((req, res) => { notif.markAllRead(db, req.auth!.businessId); res.json({ ok: true }) }))
  r.delete('/notifications/:id', requireAuth, h((req, res) => { notif.dismiss(db, req.auth!.businessId, prm(req, 'id')); res.json({ ok: true }) }))

  /* ───────────── audit ───────────── */
  r.get('/audit', requireAuth, requirePerm(PERMS.AUDIT_VIEW), h((req, res) => {
    const p = paging(req, 40)
    const { from, to } = rangeFromQuery(req)
    const where: string[] = ['business_id = ?']
    const args: unknown[] = [req.auth!.businessId]
    if (from) { where.push('created_at >= ?'); args.push(from) }
    if (to) { where.push('created_at <= ?'); args.push(to) }
    if (req.query.action) { where.push('action LIKE ?'); args.push(`%${req.query.action}%`) }
    const w = where.join(' AND ')
    const total = (db.prepare(`SELECT COUNT(*) c FROM audit_logs WHERE ${w}`).get(...args) as { c: number }).c
    const rows = db.prepare(`SELECT * FROM audit_logs WHERE ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...args, p.pageSize, (p.page - 1) * p.pageSize)
    res.json({ rows, total })
  }))

  /* ───────────── staff & roles ───────────── */
  r.get('/staff/users', requireAuth, requirePerm(PERMS.STAFF_VIEW), h((_req, res) => res.json({ rows: staff.listUsers(db) })))
  r.post('/staff/users', requireAuth, requirePerm(PERMS.STAFF_MANAGE), h((req, res) => res.json(staff.createUser(db, ctxOf(req), req.body))))
  r.patch('/staff/users/:id', requireAuth, requirePerm(PERMS.STAFF_MANAGE), h((req, res) => res.json(staff.updateUser(db, ctxOf(req), prm(req, 'id'), req.body))))
  r.get('/staff/members', requireAuth, requirePerm(PERMS.STAFF_VIEW), h((req, res) => res.json({ rows: staff.listMembers(db, req.auth!.businessId) })))
  r.post('/staff/members', requireAuth, requirePerm(PERMS.STAFF_MANAGE), h((req, res) => { staff.addMember(db, ctxOf(req), req.auth!.businessId, req.body); res.json({ ok: true }) }))
  r.patch('/staff/members/:id', requireAuth, requirePerm(PERMS.STAFF_MANAGE), h((req, res) => { staff.updateMember(db, ctxOf(req), req.auth!.businessId, prm(req, 'id'), req.body); res.json({ ok: true }) }))
  r.delete('/staff/members/:id', requireAuth, requirePerm(PERMS.STAFF_MANAGE), h((req, res) => { staff.removeMember(db, ctxOf(req), req.auth!.businessId, prm(req, 'id')); res.json({ ok: true }) }))
  r.get('/roles', requireAuth, requirePerm(PERMS.STAFF_VIEW), h((req, res) => res.json({ rows: staff.listRoles(db, req.auth!.businessId) })))
  r.post('/roles', requireAuth, requirePerm(PERMS.ROLES_MANAGE), h((req, res) => res.json({ id: staff.createRole(db, ctxOf(req), req.auth!.businessId, req.body) })))
  r.patch('/roles/:id', requireAuth, requirePerm(PERMS.ROLES_MANAGE), h((req, res) => { staff.updateRole(db, ctxOf(req), req.auth!.businessId, prm(req, 'id'), req.body); res.json({ ok: true }) }))
  r.delete('/roles/:id', requireAuth, requirePerm(PERMS.ROLES_MANAGE), h((req, res) => { staff.deleteRole(db, ctxOf(req), req.auth!.businessId, prm(req, 'id')); res.json({ ok: true }) }))

  /* ───────────── businesses ───────────── */
  r.get('/businesses', h((req, res) => {
    if (!req.session) throw new CoreError('UNAUTHENTICATED', 'লগইন করুন।', 401)
    res.json({ rows: biz.businessesForUser(db, req.session.userId) })
  }))

  r.post('/businesses', h((req, res) => {
    if (!req.auth) throw new CoreError('UNAUTHENTICATED', 'লগইন করুন।', 401)
    res.json(biz.createBusiness(db, ctxOf(req), req.auth.userId, req.body))
  }))

  r.patch('/businesses/:id', requireAuth, requirePerm(PERMS.SETTINGS_MANAGE), h((req, res) => {
    res.json(biz.updateBusiness(db, ctxOf(req), prm(req, 'id'), req.body))
  }))

  /* ───────────── settings ───────────── */
  r.get('/settings', requireAuth, requirePerm(PERMS.SETTINGS_VIEW), h((req, res) => {
    res.json({ values: settingsSvc.getAllSettings(db, req.auth!.businessId) })
  }))

  r.patch('/settings', requireAuth, requirePerm(PERMS.SETTINGS_MANAGE), h((req, res) => {
    const values = req.body?.values as Record<string, unknown> ?? {}
    const apply = db.transaction(() => {
      for (const [k, v] of Object.entries(values)) settingsSvc.setSetting(db, req.auth!.businessId, k as never, v)
    })
    apply()
    audit(db, ctxOf(req), 'settings.update', 'settings', req.auth!.businessId, null, values)
    res.json({ ok: true })
  }))

  /* ───────────── catalog helpers ───────────── */
  r.get('/catalog', requireAuth, h((req, res) => {
    const businessId = req.auth!.businessId
    res.json({
      categories: db.prepare(`SELECT * FROM categories WHERE business_id=? AND status='active' ORDER BY name`).all(businessId),
      brands: db.prepare(`SELECT * FROM brands WHERE business_id=? AND status='active' ORDER BY name`).all(businessId),
      units: db.prepare(`SELECT * FROM units WHERE business_id=? AND status='active' ORDER BY name`).all(businessId),
      customers: db.prepare(`SELECT id, name, phone, receivable FROM customers WHERE business_id=? AND status='active' ORDER BY name LIMIT 500`).all(businessId),
      suppliers: db.prepare(`SELECT id, name, phone, payable FROM suppliers WHERE business_id=? AND status='active' ORDER BY name LIMIT 500`).all(businessId)
    })
  }))

  r.post('/categories', requireAuth, requirePerm(PERMS.PRODUCTS_EDIT), h((req, res) => {
    const name = String(req.body?.name ?? '').trim()
    if (!name) throw new CoreError('NAME_REQUIRED', 'ক্যাটাগরির নাম দিন।')
    const dup = db.prepare(`SELECT 1 FROM categories WHERE business_id=? AND name=?`).get(req.auth!.businessId, name)
    if (dup) throw new CoreError('DUPLICATE', 'এই নামে ক্যাটাগরি আছে।')
    db.prepare(`INSERT INTO categories (id, business_id, name, status, created_at) VALUES (?,?,?,'active',?)`).run(newId(), req.auth!.businessId, name, Date.now())
    res.json({ ok: true })
  }))

  r.post('/brands', requireAuth, requirePerm(PERMS.PRODUCTS_EDIT), h((req, res) => {
    const name = String(req.body?.name ?? '').trim()
    if (!name) throw new CoreError('NAME_REQUIRED', 'ব্র্যান্ডের নাম দিন।')
    const dup = db.prepare(`SELECT 1 FROM brands WHERE business_id=? AND name=?`).get(req.auth!.businessId, name)
    if (dup) throw new CoreError('DUPLICATE', 'এই নামে ব্র্যান্ড আছে।')
    db.prepare(`INSERT INTO brands (id, business_id, name, status, created_at) VALUES (?,?,?,'active',?)`).run(newId(), req.auth!.businessId, name, Date.now())
    res.json({ ok: true })
  }))

  /* ───────────── search ───────────── */
  r.get('/search', requireAuth, h((req, res) => res.json({ hits: searchSvc.globalSearch(db, req.auth!.businessId, qs(req, 'q') ?? '') })))

  /* ───────────── held sales (POS hold/resume) ───────────── */
  r.get('/held', requireAuth, requirePerm(PERMS.POS_USE), h((req, res) => {
    res.json({ rows: db.prepare(`SELECT * FROM held_sales WHERE business_id=? ORDER BY created_at DESC`).all(req.auth!.businessId) })
  }))

  r.post('/held', requireAuth, requirePerm(PERMS.POS_USE), h((req, res) => {
    const { label, cart } = req.body ?? {}
    if (!cart) throw new CoreError('BAD_INPUT', 'কার্ট খালি।')
    db.prepare(`INSERT INTO held_sales (id, business_id, label, cart_json, user_id, created_at) VALUES (?,?,?,?,?,?)`)
      .run(newId(), req.auth!.businessId, String(label ?? 'হোল্ড'), JSON.stringify(cart), req.auth!.userId, Date.now())
    res.json({ ok: true })
  }))

  r.delete('/held/:id', requireAuth, requirePerm(PERMS.POS_USE), h((req, res) => {
    db.prepare(`DELETE FROM held_sales WHERE id=? AND business_id=?`).run(prm(req, 'id'), req.auth!.businessId)
    res.json({ ok: true })
  }))

  /* ───────────── import / export ───────────── */
  r.post('/import/products/validate', requireAuth, requirePerm(PERMS.PRODUCTS_IMPORT), h((req, res) => {
    const rows = dataio.parseProductCsv(String(req.body?.csv ?? ''))
    res.json({ rows: dataio.validateProductRows(db, req.auth!.businessId, rows), total: rows.length })
  }))

  r.post('/import/products/commit', requireAuth, requirePerm(PERMS.PRODUCTS_IMPORT), h((req, res) => {
    const rows = (req.body?.rows ?? []) as dataio.ImportRow[]
    res.json(dataio.commitProductImport(db, ctxOf(req), req.auth!.businessId, rows))
  }))

  /* ───────────── audit helper for export actions ───────────── */
  r.post('/audit/export', requireAuth, requirePerm(PERMS.EXPORT), h((req, res) => {
    audit(db, ctxOf(req), 'data.export', String(req.body?.entity ?? 'report'))
    res.json({ ok: true })
  }))

  return r
}

/** Post-transaction notification evaluation (guarded — must never break the txn). */
export function runNotifs(businessId: string, productIds?: string[]) {
  try {
    notif.runNotificationRules(dbRef!, businessId, productIds)
  } catch { /* notifications are best-effort */ }
}

let dbRef: DB | null = null
export function setDbRef(db: DB) { dbRef = db }
