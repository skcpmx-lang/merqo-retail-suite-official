import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Printer, FileDown } from 'lucide-react'
import { api } from '@/api/client'
import { useSession } from '@/state/session'
import { t, money, num, fdatetime, presetRange } from '@/i18n/bn'
import { PageHeader, StatCard, DataTable, Pagination, SearchInput, RangePicker, type RangeKind, type Column } from '@/ui/components'
import { PERMS } from '../perm'
import { reportHtml, printDoc, savePdf } from '@/lib/printing'
import { useBusinessInfo } from '@/lib/useBusinessInfo'

interface Summary { at_cost: number; at_price: number; out_count: number; low_count: number; products: number }
interface CatRow { category: string; at_cost: number; at_price: number; qty: number }
interface LowRow { id: string; name: string; sku: string | null; stock: number; min_stock: number; reorder_level: number; category: string | null; sold_30d: number }
interface OutRow { id: string; name: string; sku: string | null; min_stock: number; category: string | null }
interface MovRow {
  id: string
  created_at: number
  product_name: string
  product_sku: string | null
  type: string
  ref_type: string | null
  ref_id: string | null
  qty: number
  balance_after: number
  reason: string | null
  user_name: string | null
}

const MV_TYPE_BN: Record<string, string> = {
  opening: 'শুরু', purchase: 'ক্রয়', purchase_return: 'ক্রয় ফেরত', sale: 'বিক্রয়',
  sale_return: 'বিক্রয় ফেরত', adjustment: 'সমন্বয়', damage: 'ক্ষতি', loss: 'হারানো'
}

export function Inventory() {
  const navigate = useNavigate()
  const { can } = useSession()
  const { info: bizInfo } = useBusinessInfo()
  const [tab, setTab] = useState<'valuation' | 'low' | 'out' | 'movements'>('valuation')
  const [page, setPage] = useState(1)
  const [range, setRange] = useState<RangeKind>('7d')
  const [from, setFrom] = useState(() => presetRange('7d').from)
  const [to, setTo] = useState(() => presetRange('7d').to)
  const pageSize = 30

  const valuation = useQuery({
    queryKey: ['inventory-valuation'],
    queryFn: () => api.get<{ summary: Summary; by_category: CatRow[] }>('/inventory/valuation'),
    enabled: tab === 'valuation'
  })
  const low = useQuery({
    queryKey: ['inventory-low'],
    queryFn: () => api.get<{ rows: LowRow[] }>('/inventory/low'),
    enabled: tab === 'low'
  })
  const out = useQuery({
    queryKey: ['inventory-out'],
    queryFn: () => api.get<{ rows: OutRow[] }>('/inventory/out'),
    enabled: tab === 'out'
  })
  const movements = useQuery({
    queryKey: ['inventory-movements', page],
    queryFn: () => api.get<{ rows: MovRow[]; total: number }>('/inventory/movements', { page, pageSize }),
    enabled: tab === 'movements'
  })

  const valCols: Column<CatRow>[] = [
    { key: 'category', header: 'ক্যাটাগরি', render: (r) => <span className="td-strong">{r.category}</span> },
    { key: 'qty', header: 'মোট পরিমাণ', align: 'right', width: 130, render: (r) => <span className="num">{num(r.qty, r.qty % 1 ? 3 : 0)}</span> },
    { key: 'at_cost', header: 'ক্রয় মূল্যে (WAC)', align: 'right', width: 150, render: (r) => <span className="num td-strong">{money(r.at_cost)}</span> },
    { key: 'at_price', header: 'বিক্রয় মূল্যে', align: 'right', width: 140, render: (r) => <span className="num">{money(r.at_price)}</span> },
    { key: 'margin', header: 'সম্ভাব্য লাভ', align: 'right', width: 130, render: (r) => <span className="num pos">{money(r.at_price - r.at_cost)}</span> }
  ]
  const lowCols: Column<LowRow>[] = [
    { key: 'name', header: t('product_name'), render: (r) => <div><div className="td-strong">{r.name}</div>{r.sku ? <div className="td-sub num">{r.sku}</div> : null}</div> },
    { key: 'category', header: 'ক্যাটাগরি', width: 140, render: (r) => <span className="muted">{r.category ?? '—'}</span> },
    { key: 'stock', header: t('stock'), align: 'right', width: 100, render: (r) => <span className="num neg td-strong">{num(r.stock, r.stock % 1 ? 3 : 0)}</span> },
    { key: 'min_stock', header: 'সতর্কতা স্তর', align: 'right', width: 110, render: (r) => <span className="num muted">{num(r.min_stock, r.min_stock % 1 ? 3 : 0)}</span> },
    { key: 'sold_30d', header: '৩০ দিনে বিক্রয়', align: 'right', width: 120, render: (r) => <span className="num">{num(r.sold_30d, r.sold_30d % 1 ? 3 : 0)}</span> },
    { key: 'act', header: '', width: 90, render: (r) => <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/products/${r.id}`)}>{t('view')}</button> }
  ]
  const outCols: Column<OutRow>[] = [
    { key: 'name', header: t('product_name'), render: (r) => <div><div className="td-strong">{r.name}</div>{r.sku ? <div className="td-sub num">{r.sku}</div> : null}</div> },
    { key: 'category', header: 'ক্যাটাগরি', width: 140, render: (r) => <span className="muted">{r.category ?? '—'}</span> },
    { key: 'act', header: '', width: 120, render: (r) => <button className="btn btn-primary btn-sm" onClick={() => navigate(`/products/${r.id}`)}>স্টক যোগ করুন</button> }
  ]
  const movCols: Column<MovRow>[] = [
    { key: 'created_at', header: t('date'), width: 150, render: (r) => <span className="muted small">{fdatetime(r.created_at)}</span> },
    { key: 'product_name', header: t('product_name'), render: (r) => <div><div className="td-strong">{r.product_name}</div>{r.reason ? <div className="td-sub">{r.reason}</div> : null}</div> },
    { key: 'type', header: t('type'), width: 110, render: (r) => MV_TYPE_BN[r.type] ?? r.type },
    { key: 'qty', header: 'পরিমাণ', align: 'right', width: 100, render: (r) => <span className={`num ${r.qty >= 0 ? 'pos' : 'neg'}`}>{r.qty >= 0 ? '+' : '−'}{num(Math.abs(r.qty), Math.abs(r.qty) % 1 ? 3 : 0)}</span> },
    { key: 'balance_after', header: 'অবশিষ্ট', align: 'right', width: 100, render: (r) => <span className="num td-strong">{num(r.balance_after, r.balance_after % 1 ? 3 : 0)}</span> },
    { key: 'user_name', header: 'করেছেন', width: 110, render: (r) => <span className="muted small">{r.user_name ?? ''}</span> }
  ]

  const isLoading = tab === 'valuation' ? valuation.isLoading : tab === 'low' ? low.isLoading : tab === 'out' ? out.isLoading : movements.isLoading
  const error = tab === 'valuation' ? valuation.error : tab === 'low' ? low.error : tab === 'out' ? out.error : movements.error
  const refetch = tab === 'valuation' ? valuation.refetch : tab === 'low' ? low.refetch : tab === 'out' ? out.refetch : movements.refetch

  const print = (save?: boolean) => {
    const title = tab === 'valuation' ? 'স্টক মজুত (ক্যাটাগরি অনুযায়ী)' : tab === 'low' ? 'কম স্টকের পণ্য' : tab === 'out' ? 'স্টক শেষ পণ্য' : 'স্টক মুভমেন্ট'
    const cols = tab === 'valuation' ? valCols : tab === 'low' ? lowCols : tab === 'out' ? outCols : movCols
    const rows: unknown[] = tab === 'valuation' ? (valuation.data?.by_category ?? []) : tab === 'low' ? (low.data?.rows ?? []) : tab === 'out' ? (out.data?.rows ?? []) : (movements.data?.rows ?? [])
    const html = reportHtml(bizInfo, {
      title, date: Date.now(), user_name: '',
      columns: cols.filter((c) => c.key !== 'act').map((c) => String(c.header)),
      rows: rows.map((r) => cols.filter((c) => c.key !== 'act').map((c) => {
        const v = (r as Record<string, unknown>)[c.key]
        if (typeof v === 'number') {
          if (['at_cost', 'at_price', 'margin', 'value'].includes(c.key)) return money(v)
          return num(v, v % 1 ? 3 : 0)
        }
        return String(v ?? '')
      }))
    })
    if (save) void savePdf(html, `${title}.pdf`); else void printDoc(html, { paper: 'A4', landscape: cols.length > 5 })
  }

  return (
    <div className="page">
      <PageHeader
        title={t('inventory_title')}
        sub={t('inventory_sub')}
        actions={
          <>
            <button aria-label="PDF" className="btn btn-secondary btn-icon" title="PDF" onClick={() => print(true)}><FileDown size={16} /></button>
            <button className="btn btn-secondary" onClick={() => print()}><Printer size={15} /> {t('print_btn')}</button>
          </>
        }
      />

      <div className="segmented" style={{ marginBottom: 14, width: 'fit-content' }}>
        <button className={tab === 'valuation' ? 'active' : ''} onClick={() => { setTab('valuation'); setPage(1) }}>{t('stock_summary')}</button>
        <button className={tab === 'low' ? 'active' : ''} onClick={() => setTab('low')}>{t('filter_low_stock')}{low.data ? ` (${low.data.rows.length})` : ''}</button>
        <button className={tab === 'out' ? 'active' : ''} onClick={() => setTab('out')}>{t('filter_out_stock')}{out.data ? ` (${out.data.rows.length})` : ''}</button>
        <button className={tab === 'movements' ? 'active' : ''} onClick={() => { setTab('movements'); setPage(1) }}>{t('stock_movement')}</button>
      </div>

      {tab === 'valuation' && valuation.data ? (
        <div className="grid-stats" style={{ marginBottom: 14 }}>
          <StatCard compact label="মোট পণ্য" value={num(valuation.data.summary.products)} />
          <StatCard compact label={t('stock_value')} value={money(valuation.data.summary.at_cost)} tone="primary" />
          <StatCard compact label="বিক্রয় মূল্যে" value={money(valuation.data.summary.at_price)} />
          <StatCard compact label="সম্ভাব্য লাভ" value={money(valuation.data.summary.at_price - valuation.data.summary.at_cost)} tone="success" />
          <StatCard compact label={t('filter_low_stock')} value={num(valuation.data.summary.low_count)} tone={valuation.data.summary.low_count > 0 ? 'warning' : 'default'} />
          <StatCard compact label={t('filter_out_stock')} value={num(valuation.data.summary.out_count)} tone={valuation.data.summary.out_count > 0 ? 'danger' : 'default'} />
        </div>
      ) : null}

      {tab === 'movements' ? (
        <div style={{ marginBottom: 12 }}>
          <RangePicker value={range} onChange={(k, f, tt) => { setRange(k); if (f && tt) { setFrom(f); setTo(tt) } }} />
        </div>
      ) : null}

      <DataTable<unknown>
        columns={(tab === 'valuation' ? valCols : tab === 'low' ? lowCols : tab === 'out' ? outCols : movCols) as unknown as Column<unknown>[]}
        rows={(tab === 'valuation' ? (valuation.data?.by_category ?? []) : tab === 'low' ? (low.data?.rows ?? []) : tab === 'out' ? (out.data?.rows ?? []) : (movements.data?.rows ?? [])) as unknown as unknown[]}
        rowKey={(r, i) => String((r as { id?: string }).id ?? i)}
        onRowClick={tab === 'low' || tab === 'out' ? (r) => navigate(`/products/${(r as { id: string }).id}`) : undefined}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={() => void refetch()}
        emptyTitle="কিছু পাওয়া যায়নি"
        emptySub={tab === 'low' ? 'সব পণ্যের স্টক সতর্কতা স্তরের উপরে আছে' : tab === 'out' ? 'সব পণ্যের স্টক আছে' : 'এখনো কোনো মুভমেন্ট হয়নি'}
        maxHeight="calc(100vh - 380px)"
      />
      {tab === 'movements' ? (
        <div className="card" style={{ borderTop: 'none', borderRadius: '0 0 var(--r-xl) var(--r-xl)' }}>
          <Pagination page={page} pageSize={pageSize} total={movements.data?.total ?? 0} onPage={setPage} />
        </div>
      ) : null}
    </div>
  )
}
