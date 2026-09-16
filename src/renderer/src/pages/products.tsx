import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Pencil, Printer, Upload, Download, Trash2, Tag, Palette, History, MoreHorizontal } from 'lucide-react'
import { api } from '@/api/client'
import { useSession } from '@/state/session'
import { useToast } from '@/state/toast'
import { t, money, num } from '@/i18n/bn'
import { PageHeader, DataTable, Pagination, SearchInput, Modal, Field, Menu, MenuItem, Badge, ConfirmDialog } from '@/ui/components'
import { PERMS } from '../perm'
import { useBusinessInfo } from '@/lib/useBusinessInfo'

interface ProdRow {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  category_name: string | null
  brand_name: string | null
  selling_price: number
  purchase_price: number
  stock: number
  track_stock: number
  unit_short: string | null
  min_stock: number
  status: string
  wac: number
}

export function ProductsList() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { can } = useSession()

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [stockFilter, setStockFilter] = useState<'' | 'low' | 'out'>('')
  const [page, setPage] = useState(1)
  const pageSize = 25
  const [adjOpen, setAdjOpen] = useState<ProdRow | null>(null)
  const [labelOpen, setLabelOpen] = useState<ProdRow | null>(null)
  const [impOpen, setImpOpen] = useState(false)

  const { data, isLoading, refetch, error } = useQuery({
    queryKey: ['products', search, category, stockFilter, page],
    queryFn: () => api.get<{ rows: ProdRow[]; total: number }>('/products', {
      search: search || undefined, category_id: category || undefined,
      stock: stockFilter || undefined, page, pageSize, sort: 'name'
    })
  })
  const { data: catalog } = useQuery({ queryKey: ['catalog'], queryFn: () => api.get<{ categories: Array<{ id: string; name: string }>; brands: Array<{ id: string; name: string }> }>('/catalog') })

  const columns = useMemo(() => [
    {
      key: 'name', header: t('product_name'),
      render: (r: ProdRow) => (
        <div style={{ minWidth: 0 }}>
          <div className="td-strong ellip">{r.name}</div>
          <div className="td-sub num">{[r.sku, r.barcode].filter(Boolean).join(' · ')}</div>
        </div>
      )
    },
    {
      key: 'category_name', header: t('cat_brand'), width: 180,
      render: (r: ProdRow) => <span className="muted">{[r.category_name, r.brand_name].filter(Boolean).join(' · ') || '—'}</span>
    },
    { key: 'purchase_price', header: t('buying_price'), align: 'right' as const, width: 100, render: (r: ProdRow) => <span className="num muted">{money(r.purchase_price)}</span> },
    { key: 'selling_price', header: t('selling_price'), align: 'right' as const, width: 100, render: (r: ProdRow) => <span className="num td-strong">{money(r.selling_price)}</span> },
    {
      key: 'stock', header: t('stock'), align: 'right' as const, width: 110,
      render: (r: ProdRow) => !r.track_stock ? <span className="muted-2">—</span>
        : r.stock <= 0 ? <Badge tone="danger">{t('out_of_stock')}</Badge>
        : r.stock <= r.min_stock ? <Badge tone="warning">{num(r.stock, r.stock % 1 ? 3 : 0)}</Badge>
        : <span className="num">{num(r.stock, r.stock % 1 ? 3 : 0)}</span>
    },
    {
      key: 'actions', header: '', width: 56,
      render: (r: ProdRow) => (
        <Menu align="right" trigger={<button className="btn btn-ghost btn-sm btn-icon" onClick={(e) => e.stopPropagation()}><MoreHorizontal size={16} /></button>}>
          {can(PERMS.PRODUCTS_EDIT) ? <MenuItem icon={<Pencil size={14} />} onClick={() => navigate(`/products/${r.id}`)}>{t('edit')}</MenuItem> : null}
          <MenuItem icon={<Printer size={14} />} onClick={() => setLabelOpen(r)}>{t('print_label')}</MenuItem>
          {can(PERMS.INVENTORY_ADJUST) && r.track_stock ? <MenuItem icon={<Tag size={14} />} onClick={() => setAdjOpen(r)}>{t('adjust_stock')}</MenuItem> : null}
          <div className="menu-sep" />
          <MenuItem icon={<History size={14} />} onClick={() => navigate(`/products/${r.id}`)}>{t('product_movement')}</MenuItem>
        </Menu>
      )
    }
  ], [])

  return (
    <div className="page">
      <PageHeader
        title={t('products_title')}
        sub={t('products_sub')}
        actions={
          <>
            {can(PERMS.PRODUCTS_IMPORT) ? <button className="btn btn-secondary btn-icon" title={t('import_title')} onClick={() => setImpOpen(true)}><Upload size={16} /></button> : null}
            <button className="btn btn-secondary" onClick={() => navigate('/inventory')}><Download size={15} /> {t('stock_summary')}</button>
            {can(PERMS.PRODUCTS_CREATE) ? <button className="btn btn-primary" onClick={() => navigate('/products/new')}><Plus size={16} /> {t('add_product')}</button> : null}
          </>
        }
      />

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder={t('search_products_ph')} style={{ width: 280 }} />
        <select className="select" style={{ width: 180 }} value={category} onChange={(e) => { setCategory(e.target.value); setPage(1) }}>
          <option value="">সব ক্যাটাগরি</option>
          {(catalog?.categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className={`chip ${stockFilter === '' ? 'active' : ''}`} onClick={() => { setStockFilter(''); setPage(1) }}>সব</button>
        <button className={`chip ${stockFilter === 'low' ? 'active' : ''}`} onClick={() => { setStockFilter('low'); setPage(1) }}>{t('filter_low_stock')}</button>
        <button className={`chip ${stockFilter === 'out' ? 'active' : ''}`} onClick={() => { setStockFilter('out'); setPage(1) }}>{t('filter_out_stock')}</button>
      </div>

      <DataTable
        columns={columns}
        rows={data?.rows ?? []}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/products/${r.id}`)}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={() => void refetch()}
        emptyTitle="কোনো পণ্য নেই"
        emptySub="প্রথম পণ্য যোগ করুন বা CSV থেকে ইমপোর্ট করুন"
        maxHeight="calc(100vh - 360px)"
      />
      <div className="card" style={{ borderTop: 'none', borderRadius: '0 0 var(--r-xl) var(--r-xl)' }}>
        <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
      </div>

      {adjOpen ? <AdjustModal product={adjOpen} onClose={() => setAdjOpen(null)} /> : null}
      {labelOpen ? <LabelModal product={labelOpen} onClose={() => setLabelOpen(null)} /> : null}
      <ImportModal open={impOpen} onClose={() => setImpOpen(false)} />
    </div>
  )
}

function AdjustModal({ product, onClose }: { product: ProdRow; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [mode, setMode] = useState<'set' | 'add'>('set')
  const [qty, setQty] = useState(String(product.stock / 100 === Math.floor(product.stock / 100) ? product.stock / 100 : product.stock / 1000 * 1000))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const target = Number(qty)
    if (Number.isNaN(target)) return
    setBusy(true)
    try {
      await api.post(`/products/${product.id}/adjust`, mode === 'set' ? { newQty: target, reason: reason || 'সামঞ্জস্য' } : { deltaQty: target, reason: reason || 'সামঞ্জস্য' })
      void qc.invalidateQueries()
      toast('স্টক সমন্বয় হয়েছে', 'success')
      onClose()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={t('adjust_stock')} sub={product.name} size="sm"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? <span className="spinner" /> : null}{t('confirm')}</button>
        </>
      }
    >
      <div className="alert alert-info" style={{ marginBottom: 12 }}>বর্তমান স্টক: <b className="num">{num(product.stock, product.stock % 1 ? 3 : 0)}</b></div>
      <Field label="পদ্ধতি">
        <select className="select" value={mode} onChange={(e) => { setMode(e.target.value as 'set' | 'add'); setQty('') }}>
          <option value="set">মোট স্টক সেট করুন</option>
          <option value="add">যোগ/বিয়োগ (+/−)</option>
        </select>
      </Field>
      <Field label={`${t('qty')} ${mode === 'add' ? '(বিয়োগের জন্য − দিন)' : ''}`} required style={{ marginTop: 12 }}>
        <input className="input input-money" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" autoFocus onFocus={(e) => e.target.select()} />
      </Field>
      <Field label={t('adjust_reason')} required style={{ marginTop: 12 }}>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="যেমন: হিসাব মিলিয়ে, নষ্ট…" />
      </Field>
    </Modal>
  )
}

function LabelModal({ product, onClose }: { product: ProdRow; onClose: () => void }) {
  const { toast } = useToast()
  const { info: bizInfo } = useBusinessInfo()
  const [count, setCount] = useState('12')
  const [showPrice, setShowPrice] = useState(true)
  const [busy, setBusy] = useState(false)

  const print = async () => {
    setBusy(true)
    try {
      const { code128Svg } = await import('@/lib/barcode')
      const barcodeSvg = product.barcode ? code128Svg(product.barcode, { height: 40 }) : ''
      const { labelHtml, printDoc } = await import('@/lib/printing')
      const n = Math.max(1, Math.min(200, Number(count) || 1))
      const cell = { name: product.name, price: showPrice ? product.selling_price : 0, sku: product.sku, barcodeSvg }
      const html = labelHtml(bizInfo, Array.from({ length: n }, () => cell), 3, 50, 30)
      await printDoc(html, { paper: 'A4' })
      onClose()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={t('print_label')} sub={product.name} size="sm"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void print()}>{busy ? <span className="spinner" /> : <Printer size={14} />}{t('print_btn')}</button>
        </>
      }
    >
      <div className="grid-2">
        <Field label="লেবেল সংখ্যা" required>
          <input className="input" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} inputMode="numeric" autoFocus onFocus={(e) => e.target.select()} />
        </Field>
        <Field label="দাম দেখাবে?">
          <select className="select" value={showPrice ? '1' : '0'} onChange={(e) => setShowPrice(e.target.value === '1')}>
            <option value="1">হ্যাঁ</option>
            <option value="0">না</option>
          </select>
        </Field>
      </div>
      {!product.barcode ? <div className="alert alert-warning" style={{ marginTop: 10 }}>এই পণ্যের বারকোড নেই — শুধু নাম ও দাম প্রিন্ট হবে।</div> : null}
    </Modal>
  )
}

function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<null | { rows: Array<{ line: number; data: Record<string, string>; errors: string[] }>; total: number }>(null)
  const [result, setResult] = useState<null | { imported: number }>(null)

  const downloadTemplate = () => {
    const csv = [
      'name,sku,barcode,category,brand,unit,supplier,purchase_price,selling_price,opening_stock,min_stock,tax_rate',
      'চিনি (১ কেজি),SUGAR-1,8801234567890,মুদি,,কেজি,,120,135,50,10,0'
    ].join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'merqo-products-template.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const pick = async () => {
    const inp = document.createElement('input')
    inp.type = 'file'; inp.accept = '.csv,text/csv'
    const p = new Promise<File | null>((res) => { inp.onchange = () => res(inp.files?.[0] ?? null) })
    inp.click()
    const f = await p
    if (!f) return
    const text = await f.text()
    await validate(text)
  }

  const validate = async (csvText: string) => {
    setBusy(true)
    try {
      const r = await api.post<{ rows: Array<{ line: number; data: Record<string, string>; errors: string[] }>; total: number }>('/import/products/validate', { csv: csvText })
      setPreview(r)
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  const commit = async () => {
    if (!preview) return
    setBusy(true)
    try {
      const r = await api.post<{ imported: number }>('/import/products/commit', { rows: preview.rows })
      setResult(r)
      setPreview(null)
      void qc.invalidateQueries()
      toast(`${r.imported} টি পণ্য আমদানি হয়েছে`, 'success')
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('import_title')} size="md"
      footer={<button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>}>
      <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>{t('import_products_hint')}</p>
      <div className="flex gap-2">
        <button className="btn btn-secondary" onClick={downloadTemplate}><Download size={14} /> {t('import_template')}</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void pick()}>{busy ? <span className="spinner" /> : <Upload size={14} />}{t('import_pick_csv')}</button>
      </div>
      {result ? (
        <div className="alert alert-success" style={{ marginTop: 14 }}>আমদানি সম্পন্ন — {result.imported} টি পণ্য যোগ হয়েছে।</div>
      ) : null}
      {preview ? (
        <div style={{ marginTop: 14 }}>
          <div className="strong small" style={{ marginBottom: 6 }}>প্রিভিউ — {preview.total} সারি</div>
          <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
            {preview.rows.map((r) => (
              <div key={r.line} className="recent-row" style={{ padding: '6px 10px' }}>
                <span className="num muted small" style={{ width: 30 }}>#{r.line}</span>
                <div className="grow ellip small">{r.data['name'] ?? ''} <span className="muted">({r.data['purchase_price'] ?? '?'} → {r.data['selling_price'] ?? '?'})</span></div>
                {r.errors.length > 0
                  ? <Badge tone="danger">{r.errors[0]}</Badge>
                  : <Badge tone="success">ঠিক</Badge>}
              </div>
            ))}
          </div>
          <button className="btn btn-primary btn-block" style={{ marginTop: 10 }} disabled={busy || preview.rows.every((r) => r.errors.length > 0)} onClick={() => void commit()}>
            {busy ? <span className="spinner" /> : null}আমদানি নিশ্চিত করুন
          </button>
          {preview.rows.some((r) => r.errors.length > 0) ? (
            <div className="alert alert-warning small" style={{ marginTop: 8 }}>
              {preview.rows.filter((r) => r.errors.length > 0).length} সারিতে ত্রুটি — সেগুলো আমদানি হবে না।
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  )
}
