import type { DB } from '../db/connection'
import { newId, now } from '../ids'
import { roundQty } from '../money'
import { CoreError, postEntry } from './accounts'
import { audit, type AuditCtx } from './audit'

export interface ProductRow {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  category_id: string | null
  brand_id: string | null
  unit_id: string | null
  supplier_id: string | null
  purchase_price: number
  selling_price: number
  wholesale_price: number | null
  min_selling_price: number | null
  tax_rate_bps: number
  track_stock: number
  min_stock: number
  reorder_level: number
  description: string | null
  image_data: string | null
  expiry_date: number | null
  batch_no: string | null
  stock: number
  wac: number
  status: string
  created_at: number
  updated_at: number
}

export interface ProductInput {
  name: string
  sku?: string
  barcode?: string
  category_id?: string | null
  brand_id?: string | null
  unit_id?: string | null
  supplier_id?: string | null
  purchase_price?: number
  selling_price?: number
  wholesale_price?: number | null
  min_selling_price?: number | null
  tax_rate_bps?: number
  track_stock?: boolean
  min_stock?: number
  reorder_level?: number
  description?: string
  image_data?: string | null
  expiry_date?: number | null
  batch_no?: string
  opening_stock?: number
  opening_cost?: number
}

function dupCheck(db: DB, businessId: string, selfId: string | null, sku?: string, barcode?: string) {
  if (sku) {
    const hit = db.prepare(`SELECT id FROM products WHERE business_id=? AND sku=? AND id<>?`).get(businessId, sku, selfId ?? '')
    if (hit) throw new CoreError('DUP_SKU', `এই SKU ("${sku}") আগে থেকেই আছে।`)
  }
  if (barcode) {
    const hit = db.prepare(`SELECT id FROM products WHERE business_id=? AND barcode=? AND id<>?`).get(businessId, barcode, selfId ?? '')
    if (hit) throw new CoreError('DUP_BARCODE', `এই বারকোড ("${barcode}") আগে থেকেই আছে।`)
    const hit2 = db.prepare(`SELECT product_id FROM product_barcodes WHERE business_id=? AND barcode=?`).get(businessId, barcode)
    if (hit2 && (hit2 as { product_id: string }).product_id !== selfId) throw new CoreError('DUP_BARCODE', `এই বারকোড ("${barcode}") অন্য পণ্যে ব্যবহৃত।`)
  }
}

export function createProduct(db: DB, ctx: AuditCtx, businessId: string, input: ProductInput): ProductRow {
  if (!input.name?.trim()) throw new CoreError('NAME_REQUIRED', 'পণ্যের নাম দিন।')
  dupCheck(db, businessId, null, input.sku?.trim() || undefined, input.barcode?.trim() || undefined)
  const id = newId()
  const t = now()
  const openingQty = roundQty(input.track_stock === false ? 0 : input.opening_stock ?? 0)
  const openingCost = input.opening_cost ?? input.purchase_price ?? 0
  const wac = openingQty > 0 ? openingCost : input.purchase_price ?? 0
  db.prepare(
    `INSERT INTO products (id, business_id, name, sku, barcode, category_id, brand_id, unit_id, supplier_id,
      purchase_price, selling_price, wholesale_price, min_selling_price, tax_rate_bps, track_stock, min_stock,
      reorder_level, description, image_data, expiry_date, batch_no, stock, wac, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?)`
  ).run(
    id, businessId, input.name.trim(), input.sku?.trim() || null, input.barcode?.trim() || null,
    input.category_id || null, input.brand_id || null, input.unit_id || null, input.supplier_id || null,
    input.purchase_price ?? 0, input.selling_price ?? 0, input.wholesale_price ?? null, input.min_selling_price ?? null,
    input.tax_rate_bps ?? 0, input.track_stock === false ? 0 : 1, input.min_stock ?? 0, input.reorder_level ?? 0,
    input.description ?? null, input.image_data ?? null, input.expiry_date ?? null, input.batch_no ?? null,
    openingQty, wac, t, t
  )
  if (openingQty > 0) {
    db.prepare(
      `INSERT INTO stock_movements (id, business_id, product_id, qty, type, balance_after, cost_at_move, reason, user_id, created_at)
       VALUES (?,?,?,?, 'opening', ?, ?, 'শুরুর স্টক', ?, ?)`
    ).run(newId(), businessId, id, openingQty, openingQty, wac, ctx.userId ?? null, t)
  }
  audit(db, { ...ctx, businessId }, 'product.create', 'product', id, null, { name: input.name, sku: input.sku, selling_price: input.selling_price, opening_stock: openingQty })
  return getProduct(db, businessId, id)
}

export function updateProduct(db: DB, ctx: AuditCtx, businessId: string, id: string, patch: Partial<ProductInput> & { status?: 'active' | 'archived' }): ProductRow {
  const before = getProduct(db, businessId, id)
  dupCheck(db, businessId, id, patch.sku?.trim(), patch.barcode?.trim())
  const next = {
    ...before,
    name: patch.name !== undefined ? patch.name.trim() : before.name,
    sku: patch.sku !== undefined ? patch.sku.trim() || null : before.sku,
    barcode: patch.barcode !== undefined ? patch.barcode.trim() || null : before.barcode,
    category_id: patch.category_id !== undefined ? patch.category_id || null : before.category_id,
    brand_id: patch.brand_id !== undefined ? patch.brand_id || null : before.brand_id,
    unit_id: patch.unit_id !== undefined ? patch.unit_id || null : before.unit_id,
    supplier_id: patch.supplier_id !== undefined ? patch.supplier_id || null : before.supplier_id,
    purchase_price: patch.purchase_price ?? before.purchase_price,
    selling_price: patch.selling_price ?? before.selling_price,
    wholesale_price: patch.wholesale_price !== undefined ? patch.wholesale_price : before.wholesale_price,
    min_selling_price: patch.min_selling_price !== undefined ? patch.min_selling_price : before.min_selling_price,
    tax_rate_bps: patch.tax_rate_bps ?? before.tax_rate_bps,
    track_stock: patch.track_stock !== undefined ? (patch.track_stock ? 1 : 0) : before.track_stock,
    min_stock: patch.min_stock ?? before.min_stock,
    reorder_level: patch.reorder_level ?? before.reorder_level,
    description: patch.description !== undefined ? patch.description : before.description,
    image_data: patch.image_data !== undefined ? patch.image_data : before.image_data,
    expiry_date: patch.expiry_date !== undefined ? patch.expiry_date : before.expiry_date,
    batch_no: patch.batch_no !== undefined ? patch.batch_no || null : before.batch_no,
    status: patch.status ?? before.status
  }
  const priceChanged = next.selling_price !== before.selling_price || next.purchase_price !== before.purchase_price
  db.prepare(
    `UPDATE products SET name=?, sku=?, barcode=?, category_id=?, brand_id=?, unit_id=?, supplier_id=?,
      purchase_price=?, selling_price=?, wholesale_price=?, min_selling_price=?, tax_rate_bps=?, track_stock=?,
      min_stock=?, reorder_level=?, description=?, image_data=?, expiry_date=?, batch_no=?, status=?, updated_at=?
     WHERE id=? AND business_id=?`
  ).run(
    next.name, next.sku, next.barcode, next.category_id, next.brand_id, next.unit_id, next.supplier_id,
    next.purchase_price, next.selling_price, next.wholesale_price, next.min_selling_price, next.tax_rate_bps, next.track_stock,
    next.min_stock, next.reorder_level, next.description, next.image_data, next.expiry_date, next.batch_no, next.status, now(), id, businessId
  )
  audit(db, { ...ctx, businessId }, priceChanged ? 'product.price_change' : 'product.update', 'product', id, before, next)
  return getProduct(db, businessId, id)
}

export function getProduct(db: DB, businessId: string, id: string): ProductRow {
  const p = db.prepare(`SELECT * FROM products WHERE id=? AND business_id=?`).get(id, businessId) as ProductRow | undefined
  if (!p) throw new CoreError('PRODUCT_NOT_FOUND', 'পণ্যটি পাওয়া যায়নি।')
  return p
}

/** Hard delete allowed only when the product has zero transactional history. */
export function deleteProduct(db: DB, ctx: AuditCtx, businessId: string, id: string): void {
  const p = getProduct(db, businessId, id)
  const used =
    (db.prepare(`SELECT 1 FROM sale_items WHERE product_id=? LIMIT 1`).get(id)) ||
    (db.prepare(`SELECT 1 FROM purchase_items WHERE product_id=? LIMIT 1`).get(id)) ||
    (db.prepare(`SELECT 1 FROM stock_movements WHERE product_id=? LIMIT 1`).get(id))
  if (used) throw new CoreError('HAS_HISTORY', 'এই পণ্যের লেনদেন আছে — মুছে ফেলা যাবে না, প্রয়োজনে আর্কাইভ করুন।')
  db.prepare(`DELETE FROM products WHERE id=? AND business_id=?`).run(id, businessId)
  audit(db, { ...ctx, businessId }, 'product.delete', 'product', id, p, null)
}

export interface ProductListQuery {
  search?: string
  category_id?: string
  brand_id?: string
  status?: 'active' | 'archived' | 'all'
  stockFilter?: 'all' | 'low' | 'out'
  supplier_id?: string
  sort?: 'name' | 'stock' | 'selling_price' | 'created_at'
  dir?: 'asc' | 'desc'
  page: number
  pageSize: number
  includeImage?: boolean
}

export function listProducts(db: DB, businessId: string, q: ProductListQuery) {
  const where: string[] = ['p.business_id = ?']
  const args: unknown[] = [businessId]
  if (q.status && q.status !== 'all') { where.push(`p.status = ?`); args.push(q.status) }
  if (q.category_id) { where.push(`p.category_id = ?`); args.push(q.category_id) }
  if (q.brand_id) { where.push(`p.brand_id = ?`); args.push(q.brand_id) }
  if (q.supplier_id) { where.push(`p.supplier_id = ?`); args.push(q.supplier_id) }
  if (q.search) {
    where.push(`(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR EXISTS (SELECT 1 FROM product_barcodes b WHERE b.product_id=p.id AND b.barcode LIKE ?))`)
    const like = `%${q.search}%`
    args.push(like, like, like, like)
  }
  if (q.stockFilter === 'low') { where.push(`p.track_stock=1 AND p.stock > 0 AND p.stock <= p.min_stock`) }
  if (q.stockFilter === 'out') { where.push(`p.track_stock=1 AND p.stock <= 0`) }
  const w = where.join(' AND ')
  const sortCol = q.sort === 'stock' ? 'p.stock' : q.sort === 'selling_price' ? 'p.selling_price' : q.sort === 'created_at' ? 'p.created_at' : 'p.name COLLATE NOCASE'
  const dir = q.dir === 'desc' ? 'DESC' : 'ASC'
  const cols = q.includeImage ? `p.*, c.name AS category_name, b.name AS brand_name, u.short AS unit_short, u.name AS unit_name` : `p.id, p.business_id, p.name, p.sku, p.barcode, p.category_id, p.brand_id, p.unit_id, p.supplier_id, p.purchase_price, p.selling_price, p.wholesale_price, p.min_selling_price, p.tax_rate_bps, p.track_stock, p.min_stock, p.reorder_level, p.expiry_date, p.batch_no, p.stock, p.wac, p.status, p.created_at, p.updated_at, c.name AS category_name, b.name AS brand_name, u.short AS unit_short, u.name AS unit_name`
  const total = (db.prepare(`SELECT COUNT(*) c FROM products p WHERE ${w}`).get(...args) as { c: number }).c
  const rows = db
    .prepare(
      `SELECT ${cols} FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
       LEFT JOIN units u ON u.id = p.unit_id
       WHERE ${w} ORDER BY ${sortCol} ${dir} LIMIT ? OFFSET ?`
    )
    .all(...args, q.pageSize, (q.page - 1) * q.pageSize)
  return { rows, total }
}

/** Barcode → product (products.barcode + alias table). */
export function findByBarcode(db: DB, businessId: string, code: string): ProductRow | null {
  const p = db.prepare(`SELECT * FROM products WHERE business_id=? AND barcode=? AND status='active'`).get(businessId, code) as ProductRow | undefined
  if (p) return p
  const alias = db.prepare(`SELECT product_id FROM product_barcodes WHERE business_id=? AND barcode=?`).get(businessId, code) as { product_id: string } | undefined
  if (!alias) return null
  return db.prepare(`SELECT * FROM products WHERE id=? AND status='active'`).get(alias.product_id) as ProductRow | null
}

/** Signed manual stock adjustment with mandatory reason — never silent. */
export function adjustStock(
  db: DB, ctx: AuditCtx, businessId: string, productId: string,
  input: { newQty?: number; deltaQty?: number; reason: string; type?: 'adjustment' | 'damage' | 'loss'; note?: string }
): ProductRow {
  const p = getProduct(db, businessId, productId)
  const cur = p.stock
  const nextQty = input.newQty !== undefined ? roundQty(input.newQty) : roundQty(cur + (input.deltaQty ?? 0))
  const delta = roundQty(nextQty - cur)
  if (!input.reason?.trim()) throw new CoreError('REASON_REQUIRED', 'সমন্বয়ের কারণ লিখুন।')
  if (delta === 0) throw new CoreError('NO_CHANGE', 'পরিমাণে কোনো পরিবর্তন হয়নি।')
  if (nextQty < 0) throw new CoreError('NEGATIVE_STOCK', 'স্টক ঋণাত্মক হতে পারে না।')
  const t = now()
  db.prepare(`UPDATE products SET stock=?, updated_at=? WHERE id=?`).run(nextQty, t, productId)
  db.prepare(
    `INSERT INTO stock_movements (id, business_id, product_id, qty, type, balance_after, cost_at_move, reason, note, user_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(newId(), businessId, productId, delta, input.type ?? 'adjustment', nextQty, p.wac, input.reason.trim(), input.note ?? null, ctx.userId ?? null, t)
  audit(db, { ...ctx, businessId }, 'inventory.adjust', 'product', productId, { stock: cur }, { stock: nextQty }, input.reason.trim())
  return getProduct(db, businessId, productId)
}

export function stockMovements(db: DB, businessId: string, productId: string | undefined, page: number, pageSize: number) {
  const where: string[] = ['m.business_id = ?']
  const args: unknown[] = [businessId]
  if (productId) { where.push('m.product_id = ?'); args.push(productId) }
  const w = where.join(' AND ')
  const total = (db.prepare(`SELECT COUNT(*) c FROM stock_movements m WHERE ${w}`).get(...args) as { c: number }).c
  const rows = db
    .prepare(
      `SELECT m.*, p.name AS product_name, p.sku AS product_sku, u.name AS user_name FROM stock_movements m
       LEFT JOIN products p ON p.id = m.product_id
       LEFT JOIN users u ON u.id = m.user_id
       WHERE ${w} ORDER BY m.created_at DESC, m.rowid DESC LIMIT ? OFFSET ?`
    )
    .all(...args, pageSize, (page - 1) * pageSize)
  return { rows, total }
}

/** Stock valuation at WAC and at selling price. */
export function stockValuation(db: DB, businessId: string) {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(stock * wac),0) at_cost, COALESCE(SUM(CASE WHEN stock>0 THEN stock * selling_price ELSE 0 END),0) at_price,
              SUM(CASE WHEN track_stock=1 AND stock<=0 THEN 1 ELSE 0 END) out_count,
              SUM(CASE WHEN track_stock=1 AND stock>0 AND stock<=min_stock THEN 1 ELSE 0 END) low_count,
              COUNT(*) products
       FROM products WHERE business_id=? AND status='active'`
    )
    .get(businessId) as { at_cost: number; at_price: number; out_count: number; low_count: number; products: number }
  return r
}

/** Extra barcodes for a product. */
export function addBarcode(db: DB, ctx: AuditCtx, businessId: string, productId: string, barcode: string, type = 'CODE128') {
  const dup = db.prepare(`SELECT 1 FROM product_barcodes WHERE business_id=? AND barcode=?`).get(businessId, barcode)
  if (dup) throw new CoreError('DUP_BARCODE', 'এই বারকোড আগে থেকেই ব্যবহৃত।')
  const id = newId()
  db.prepare(`INSERT INTO product_barcodes (id, business_id, product_id, barcode, type, created_at) VALUES (?,?,?,?,?,?)`).run(id, businessId, productId, barcode, type, now())
  audit(db, { ...ctx, businessId }, 'product.barcode_add', 'product', productId, null, { barcode })
  return id
}

export function removeBarcode(db: DB, ctx: AuditCtx, businessId: string, barcodeId: string) {
  db.prepare(`DELETE FROM product_barcodes WHERE id=? AND business_id=?`).run(barcodeId, businessId)
  audit(db, { ...ctx, businessId }, 'product.barcode_remove', 'product_barcode', barcodeId)
}
