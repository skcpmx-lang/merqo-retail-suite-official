import Papa from 'papaparse'
import type { DB } from '../db/connection'
import { newId, now } from '../ids'
import { roundQty, takaToPoisha } from '../money'
import { CoreError } from './accounts'
import { audit, type AuditCtx } from './audit'
import type { ProductInput } from './products'

/* ───────────────────────── CSV export (Excel-safe, BOM for Bengali) ───────────────────────── */

export function toCsv(headers: string[], rows: Array<Array<string | number | null>>): string {
  const csv = Papa.unparse({ fields: headers, data: rows.map((r) => r.map((c) => (c == null ? '' : c))) })
  return '\uFEFF' + csv
}

/* ───────────────────────── product import with validation ───────────────────────── */

export interface ImportRow {
  line: number
  data: Record<string, string>
  errors: string[]
}

export type ImportColumn =
  | 'name' | 'sku' | 'barcode' | 'category' | 'brand' | 'unit' | 'supplier'
  | 'purchase_price' | 'selling_price' | 'wholesale_price' | 'min_selling_price'
  | 'opening_stock' | 'min_stock' | 'reorder_level' | 'tax_rate' | 'description'

export const IMPORT_COLUMNS: Array<{ key: ImportColumn; bn: string; required: boolean }> = [
  { key: 'name', bn: 'পণ্যের নাম', required: true },
  { key: 'sku', bn: 'SKU', required: false },
  { key: 'barcode', bn: 'বারকোড', required: false },
  { key: 'category', bn: 'ক্যাটাগরি', required: false },
  { key: 'brand', bn: 'ব্র্যান্ড', required: false },
  { key: 'unit', bn: 'একক', required: false },
  { key: 'supplier', bn: 'সরবরাহকারী', required: false },
  { key: 'purchase_price', bn: 'ক্রয়মূল্য', required: true },
  { key: 'selling_price', bn: 'বিক্রয়মূল্য', required: true },
  { key: 'wholesale_price', bn: 'পাইকারি মূল্য', required: false },
  { key: 'min_selling_price', bn: 'সর্বনিম্ন বিক্রয়মূল্য', required: false },
  { key: 'opening_stock', bn: 'শুরুর স্টক', required: false },
  { key: 'min_stock', bn: 'সর্বনিম্ন স্টক', required: false },
  { key: 'reorder_level', bn: 'রিঅর্ডার লেভেল', required: false },
  { key: 'tax_rate', bn: 'ভ্যাট (%)', required: false },
  { key: 'description', bn: 'বিবরণ', required: false }
]

/** Parse CSV text → rows with per-line Bengali validation errors. */
export function parseProductCsv(text: string): ImportRow[] {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() })
  const errors = (parsed.errors ?? []).filter((e: { type?: string }) => e.type !== 'TooManyFields')
  if (errors.length > 5) throw new CoreError('CSV_PARSE', 'CSV ফাইলটি পড়া যায়নি — ফরম্যাট যাচাই করুন।')
  return (parsed.data ?? []).map((data, i) => ({ line: i + 2, data, errors: [] }))
}

/** Validate parsed rows against a business. Returns row-level errors (Bengali). */
export function validateProductRows(db: DB, businessId: string, rows: ImportRow[]): ImportRow[] {
  const num = (v: string | undefined): number | null => {
    if (v == null || String(v).trim() === '') return null
    const n = Number(String(v).replace(/[,\s৳]/g, ''))
    return Number.isFinite(n) ? n : NaN
  }
  const out: ImportRow[] = []
  for (const r of rows) {
    const errs = r.errors
    const d = r.data
    if (!d['name']?.trim()) errs.push('পণ্যের নাম দিন')
    const pp = num(d['purchase_price'])
    if (pp === null) errs.push('ক্রয়মূল্য দিন')
    else if (Number.isNaN(pp) || pp < 0) errs.push('ক্রয়মূল্য সঠিক নয়')
    const sp = num(d['selling_price'])
    if (sp === null) errs.push('বিক্রয়মূল্য দিন')
    else if (Number.isNaN(sp) || sp < 0) errs.push('বিক্রয়মূল্য সঠিক নয়')
    if (d['sku']?.trim()) {
      const dup = db.prepare(`SELECT 1 FROM products WHERE business_id=? AND sku=?`).get(businessId, d['sku'].trim())
      if (dup) errs.push(`SKU "${d['sku']}" আগে আছে`)
    }
    if (d['barcode']?.trim()) {
      const dup = db.prepare(`SELECT 1 FROM products WHERE business_id=? AND barcode=?`).get(businessId, d['barcode'].trim())
        || db.prepare(`SELECT 1 FROM product_barcodes WHERE business_id=? AND barcode=?`).get(businessId, d['barcode'].trim())
      if (dup) errs.push(`বারকোড "${d['barcode']}" আগে আছে`)
    }
    const os = num(d['opening_stock'])
    if (os != null && (Number.isNaN(os) || os < 0)) errs.push('শুরুর স্টক সঠিক নয়')
    out.push({ ...r, errors: errs })
  }
  // duplicate rows within the file (same sku/barcode/name)
  const seen = new Map<string, number>()
  for (const r of out) {
    const key = (r.data['sku'] || r.data['barcode'] || r.data['name'] || '').trim().toLowerCase()
    if (!key) continue
    if (seen.has(key)) r.errors.push(`ফাইলের লাইন ${seen.get(key)} এর সাথে সদৃশ`)
    else seen.set(key, r.line)
  }
  return out
}

/** Commit valid rows inside ONE transaction — all-or-nothing, never partial corruption. */
export function commitProductImport(db: DB, ctx: AuditCtx, businessId: string, rows: ImportRow[]): { imported: number } {
  const bad = rows.filter((r) => r.errors.length > 0)
  if (bad.length) throw new CoreError('IMPORT_INVALID', `${bad.length} লাইনে ত্রুটি আছে — সংশোধন করে আবার আমদানি করুন।`)
  const num = (v: string | undefined): number | undefined => {
    if (v == null || String(v).trim() === '') return undefined
    const n = Number(String(v).replace(/[,\s৳]/g, ''))
    return Number.isFinite(n) ? n : undefined
  }
  const getOrCreate = (table: 'categories' | 'brands' | 'suppliers' | 'units', name: string, unitShort?: string): string | null => {
    if (!name?.trim()) return null
    const hit = db.prepare(`SELECT id FROM ${table} WHERE business_id=? AND name=?`).get(businessId, name.trim()) as { id: string } | undefined
    if (hit) return hit.id
    const id = newId()
    if (table === 'units') db.prepare(`INSERT INTO units (id, business_id, name, short, allow_decimal, status, created_at) VALUES (?,?,?,?,0,'active',?)`).run(id, businessId, name.trim(), unitShort ?? name.trim().slice(0, 6), now())
    else if (table === 'categories') db.prepare(`INSERT INTO categories (id, business_id, name, status, created_at) VALUES (?,?,?,'active',?)`).run(id, businessId, name.trim(), now())
    else if (table === 'brands') db.prepare(`INSERT INTO brands (id, business_id, name, status, created_at) VALUES (?,?,?,'active',?)`).run(id, businessId, name.trim(), now())
    else db.prepare(`INSERT INTO suppliers (id, business_id, name, status, created_at) VALUES (?,?,?,'active',?)`).run(id, businessId, name.trim(), now())
    return id
  }

  const apply = db.transaction(() => {
    // Lazy import of products service to avoid a cycle at module init.
    const { createProduct } = require('./products') as typeof import('./products')
    for (const r of rows) {
      const d = r.data
      const input: ProductInput = {
        name: d['name'].trim(),
        sku: d['sku']?.trim(),
        barcode: d['barcode']?.trim(),
        category_id: getOrCreate('categories', d['category'] ?? ''),
        brand_id: getOrCreate('brands', d['brand'] ?? ''),
        supplier_id: getOrCreate('suppliers', d['supplier'] ?? ''),
        unit_id: getOrCreate('units', d['unit'] ?? 'পিস'),
        purchase_price: takaToPoisha(num(d['purchase_price']) ?? 0),
        selling_price: takaToPoisha(num(d['selling_price']) ?? 0),
        wholesale_price: num(d['wholesale_price']) != null ? takaToPoisha(num(d['wholesale_price'])!) : null,
        min_selling_price: num(d['min_selling_price']) != null ? takaToPoisha(num(d['min_selling_price'])!) : null,
        tax_rate_bps: num(d['tax_rate']) != null ? Math.round(num(d['tax_rate'])! * 100) : 0,
        min_stock: num(d['min_stock']) ?? 0,
        reorder_level: num(d['reorder_level']) ?? 0,
        description: d['description']?.trim() || undefined,
        opening_stock: roundQty(num(d['opening_stock']) ?? 0),
        opening_cost: takaToPoisha(num(d['purchase_price']) ?? 0)
      }
      createProduct(db, ctx, businessId, input)
    }
  })
  apply()
  audit(db, ctx, 'data.import', 'products', undefined, null, { count: rows.length })
  return { imported: rows.length }
}
