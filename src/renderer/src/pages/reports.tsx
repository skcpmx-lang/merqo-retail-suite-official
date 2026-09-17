import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Printer, FileDown, FileSpreadsheet } from 'lucide-react'
import { api } from '@/api/client'
import { useSession } from '@/state/session'
import { t, money, num, fdate, presetRange } from '@/i18n/bn'
import { PageHeader, DataTable, RangePicker, StatCard, type RangeKind, type Column } from '@/ui/components'
import { PERMS } from '../perm'
import { reportHtml, printDoc, savePdf, methodBn } from '@/lib/printing'
import { useBusinessInfo } from '@/lib/useBusinessInfo'

export interface ReportDef {
  key: string
  title: string
  endpoint: string
  columns: Array<{ key: string; header: string; money?: boolean; qty?: boolean; date?: boolean; renderKey?: string }>
  sums?: string[]
}

export const REPORTS: ReportDef[] = [
  { key: 'daily-series', title: 'দৈনিক বিক্রয় সারসংক্ষেপ', endpoint: '/reports/daily-series', columns: [{ key: 'date', header: 'তারিখ' }, { key: 'count', header: 'বিল সংখ্যা', qty: true }, { key: 'sales', header: 'বিক্রয়', money: true }, { key: 'profit', header: 'মোট লাভ', money: true }, { key: 'purchases', header: 'ক্রয়', money: true }, { key: 'expenses', header: 'খরচ', money: true }], sums: ['sales', 'profit'] },
  { key: 'top-products', title: 'সর্বাধিক বিক্রীত পণ্য', endpoint: '/reports/top-products', columns: [{ key: 'name', header: 'পণ্য' }, { key: 'qty', header: 'পরিমাণ', qty: true }, { key: 'revenue', header: 'বিক্রয়', money: true }, { key: 'cogs', header: 'COGS', money: true }, { key: 'profit', header: 'লাভ', money: true }] },
  { key: 'category-sales', title: 'ক্যাটাগরি অনুযায়ী বিক্রয়', endpoint: '/reports/category-sales', columns: [{ key: 'category', header: 'ক্যাটাগরি' }, { key: 'qty', header: 'পরিমাণ', qty: true }, { key: 'revenue', header: 'বিক্রয়', money: true }], sums: ['revenue'] },
  { key: 'staff-sales', title: 'কর্মী অনুযায়ী বিক্রয়', endpoint: '/reports/staff-sales', columns: [{ key: 'staff', header: 'কর্মী' }, { key: 'count', header: 'বিল', qty: true }, { key: 'revenue', header: 'বিক্রয়', money: true }, { key: 'due', header: 'বাকি', money: true }], sums: ['revenue'] },
  { key: 'method-sales', title: 'পেমেন্ট মাধ্যম অনুযায়ী আদায়', endpoint: '/reports/method-sales', columns: [{ key: 'method', header: 'মাধ্যম', renderKey: 'method_bn' }, { key: 'count', header: 'সংখ্যা', qty: true }, { key: 'amount', header: 'পরিমাণ', money: true }], sums: ['amount'] },
  { key: 'customer-sales', title: 'গ্রাহক অনুযায়ী বিক্রয়', endpoint: '/reports/customer-sales', columns: [{ key: 'name', header: 'গ্রাহক' }, { key: 'count', header: 'বিল', qty: true }, { key: 'revenue', header: 'কেনা', money: true }, { key: 'due', header: 'বাকি', money: true }], sums: ['revenue'] },
  { key: 'supplier-purchases', title: 'সরবরাহকারী অনুযায়ী ক্রয়', endpoint: '/reports/supplier-purchases', columns: [{ key: 'supplier', header: 'সরবরাহকারী' }, { key: 'count', header: 'ক্রয়', qty: true }, { key: 'total', header: 'কেনা', money: true }, { key: 'paid', header: 'পরিশোধ', money: true }, { key: 'due', header: 'পাওনা', money: true }], sums: ['total'] },
  { key: 'product-purchases', title: 'পণ্য অনুযায়ী ক্রয়', endpoint: '/reports/product-purchases', columns: [{ key: 'name', header: 'পণ্য' }, { key: 'qty', header: 'পরিমাণ', qty: true }, { key: 'cost', header: 'মোট ক্রয়', money: true }], sums: ['cost'] },
  { key: 'dead-stock', title: 'অবিক্রীত (ডেড) স্টক', endpoint: '/reports/dead-stock', columns: [{ key: 'name', header: 'পণ্য' }, { key: 'stock', header: 'স্টক', qty: true }, { key: 'wac', header: 'গড় দর (WAC)', money: true }, { key: 'value', header: 'আটকে থাকা মূলধন', money: true }], sums: ['value'] },
  { key: 'receivables', title: 'গ্রাহকের বকেয়া', endpoint: '/reports/receivables', columns: [{ key: 'name', header: 'গ্রাহক' }, { key: 'phone', header: 'ফোন' }, { key: 'receivable', header: 'বকেয়া', money: true }, { key: 'last_sale_at', header: 'শেষ বিক্রয়', date: true }, { key: 'last_paid_at', header: 'শেষ আদায়', date: true }], sums: ['receivable'] },
  { key: 'payables', title: 'সরবরাহকারীর পাওনা', endpoint: '/reports/payables', columns: [{ key: 'name', header: 'সরবরাহকারী' }, { key: 'phone', header: 'ফোন' }, { key: 'payable', header: 'পাওনা', money: true }, { key: 'last_purchase_at', header: 'শেষ ক্রয়', date: true }, { key: 'last_paid_at', header: 'শেষ পরিশোধ', date: true }], sums: ['payable'] },
  { key: 'cashflow', title: 'হিসাব অনুযায়ী নগদ প্রবাহ', endpoint: '/reports/cashflow', columns: [{ key: 'name', header: 'হিসাব' }, { key: 'type', header: 'ধরন' }, { key: 'inflow', header: 'ভেতরে', money: true }, { key: 'outflow', header: 'বাইরে', money: true }], sums: ['inflow', 'outflow'] },
  { key: 'expiry', title: 'মেয়াদ শেষ / প্রায় শেষ', endpoint: '/reports/expiry', columns: [{ key: 'name', header: 'পণ্য' }, { key: 'expiry_date', header: 'মেয়াদ', date: true }, { key: 'stock', header: 'স্টক', qty: true }] }
]

type Row = Record<string, unknown>

export function Reports() {
  const { can } = useSession()
  const { info: bizInfo } = useBusinessInfo()
  const [params, setParams] = useSearchParams()
  const active = params.get('r') ?? 'daily-series'
  const def = REPORTS.find((r) => r.key === active) ?? REPORTS[0]

  const [range, setRange] = useState<RangeKind>('month')
  const [from, setFrom] = useState(() => presetRange('month').from)
  const [to, setTo] = useState(() => presetRange('month').to)

  const showDates = !['receivables', 'payables', 'dead-stock', 'expiry'].includes(def.key)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['report', def.key, from, to],
    queryFn: () => api.get<{ rows: Row[]; totals?: Record<string, number>; inflow?: number; outflow?: number; net?: number }>(def.endpoint, showDates ? { from, to } : {}),
    enabled: can(PERMS.REPORTS_VIEW)
  })

  const rows = data?.rows ?? []
  const totals = (data?.totals ?? (def.key === 'cashflow' ? { inflow: data?.inflow, outflow: data?.outflow, net: data?.net } : undefined)) as Record<string, number> | undefined

  const columns = useMemo<Column<Row>[]>(() => def.columns.map((c) => ({
    key: c.key,
    header: c.header,
    align: (c.money || c.qty) ? ('right' as const) : undefined,
    render: (r: Row) => {
      const v = r[c.key]
      if (c.renderKey === 'method_bn') return <span>{methodBn(String(v ?? ''))}</span>
      if (v == null || v === '') return <span className="muted-2">—</span>
      if (c.date) return <span className="muted">{v ? fdate(Number(v)) : '—'}</span>
      if (c.money) return <span className="num td-strong">{money(Number(v))}</span>
      if (c.qty) return <span className="num">{num(Number(v), Number(v) % 1 ? 2 : 0)}</span>
      if (c.key === 'type') return <span className="muted">{({ cash: 'ক্যাশ', bank: 'ব্যাংক', mfs: 'MFS', card: 'কার্ড', other: 'অন্য' } as Record<string, string>)[String(v)] ?? String(v)}</span>
      return <span>{String(v)}</span>
    }
  })), [def])

  const sumRow = def.sums && rows.length > 0 ? (
    <div className="report-sums">
      {def.sums.map((k) => (
        <div key={k} className="stat compact">
          <div className="stat-label">{def.columns.find((c) => c.key === k)?.header}</div>
          <div className="stat-value num">{money(totals?.[k] ?? rows.reduce((a, r) => a + Number(r[k] ?? 0), 0))}</div>
        </div>
      ))}
    </div>
  ) : null

  const doPrint = (save?: boolean, csv?: boolean) => {
    if (csv) {
      const head = def.columns.map((c) => c.header).join(',')
      const body = rows.map((r) => def.columns.map((c) => {
        const v = r[c.key]
        if (c.money) return (Number(v ?? 0) / 100).toFixed(2)
        return String(v ?? '').replace(/,/g, ' ')
      }).join(',')).join('\n')
      const blob = new Blob(['\uFEFF' + head + '\n' + body], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${def.title}.csv`
      a.click()
      URL.revokeObjectURL(a.href)
      return
    }
    const html = reportHtml(bizInfo, {
      title: def.title, date: Date.now(),
      user_name: '',
      rangeLabel: showDates ? `${fdate(from)} — ${fdate(to)}` : undefined,
      columns: def.columns.map((c) => c.header),
      rows: rows.map((r) => def.columns.map((c) => {
        const v = r[c.key]
        if (c.renderKey === 'method_bn') return methodBn(String(v ?? ''))
        if (c.money) return money(Number(v ?? 0))
        if (c.qty) return num(Number(v ?? 0), Number(v ?? 0) % 1 ? 2 : 0)
        if (c.date) return v ? fdate(Number(v)) : ''
        if (c.key === 'type') return String(v ?? '')
        return String(v ?? '')
      }))
    })
    if (save) void savePdf(html, `${def.title}.pdf`)
    else void printDoc(html, { paper: 'A4', landscape: def.columns.length > 6 })
  }

  if (!can(PERMS.REPORTS_VIEW)) return null

  return (
    <div className="page">
      <PageHeader
        title={t('reports_title')}
        sub={t('reports_sub')}
        actions={
          <>
            <button aria-label="CSV" className="btn btn-secondary btn-icon" title="CSV" onClick={() => doPrint(false, true)}><FileSpreadsheet size={16} /></button>
            <button aria-label="PDF" className="btn btn-secondary btn-icon" title="PDF" onClick={() => doPrint(true)}><FileDown size={16} /></button>
            <button className="btn btn-primary" onClick={() => doPrint()}><Printer size={15} /> প্রিন্ট</button>
          </>
        }
      />

      <div className="report-tabs" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {REPORTS.map((r) => (
          <button
            key={r.key}
            className={`chip ${r.key === active ? 'active' : ''}`}
            onClick={() => setParams({ r: r.key })}
          >
            {r.title}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center' }}>
        {showDates ? <RangePicker value={range} onChange={(k, f, tt) => { setRange(k); if (f && tt) { setFrom(f); setTo(tt) } }} /> : null}
      </div>

      {sumRow}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(_, i) => String(i)}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={() => void refetch()}
        emptyTitle="কোনো তথ্য নেই"
        emptySub="এই সময়ে কোনো লেনদেন হয়নি"
        maxHeight="calc(100vh - 400px)"
      />
    </div>
  )
}
