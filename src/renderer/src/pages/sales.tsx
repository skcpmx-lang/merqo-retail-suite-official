import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '@/api/client'
import { useSession } from '@/state/session'
import { t, money, fdatetime, presetRange } from '@/i18n/bn'
import { PageHeader, DataTable, Pagination, SearchInput, RangePicker, Badge, type RangeKind, type Column } from '@/ui/components'
import { methodBn } from '@/lib/printing'

interface SaleRow {
  id: string
  invoice_no: string
  customer_name: string | null
  customer_phone: string | null
  date: number
  total: number
  paid: number
  due: number
  cogs: number
  payment_method: string
  status: string
  returned_amount: number
  user_name: string | null
}

export function SalesList() {
  const navigate = useNavigate()
  const { can } = useSession()
  const [params] = useSearchParams()
  const [range, setRange] = useState<RangeKind>('7d')
  const [from, setFrom] = useState(() => presetRange('7d').from)
  const [to, setTo] = useState(() => presetRange('7d').to)
  const [search, setSearch] = useState(params.get('invoice') ? `#${params.get('invoice')}` : '')
  const [dueOnly, setDueOnly] = useState(params.get('due') === '1')
  const [page, setPage] = useState(1)
  const pageSize = 30

  const { data, isLoading, refetch, error } = useQuery({
    queryKey: ['sales', from, to, search, dueOnly, page],
    queryFn: () => api.get<{ rows: SaleRow[]; total: number; sums: { total: number; paid: number; due: number; cogs: number } }>('/sales', {
      from, to, search: search.replace(/^#/, '') || undefined, due: dueOnly ? '1' : undefined, page, pageSize
    })
  })

  const statusBadge = (s: SaleRow) => {
    switch (s.status) {
      case 'voided': return <Badge tone="danger">{t('sale_status_voided')}</Badge>
      case 'returned': return <Badge tone="warning">{t('sale_status_returned')}</Badge>
      case 'partially_returned': return <Badge tone="warning">{t('sale_status_partial')}</Badge>
      default: return <Badge tone="success">{t('sale_status_completed')}</Badge>
    }
  }

  const columns = useMemo<Column<SaleRow>[]>(() => [
    {
      key: 'invoice_no', header: t('invoice_no'), width: 130,
      render: (r) => <span className="td-strong num">{r.invoice_no}</span>
    },
    {
      key: 'date', header: t('date'), width: 150,
      render: (r) => <span className="muted">{fdatetime(r.date)}</span>
    },
    {
      key: 'customer_name', header: t('type_customer'),
      render: (r) => (
        <div>
          <div>{r.customer_name ?? t('walkin_customer')}</div>
          {r.customer_phone ? <div className="td-sub num">{r.customer_phone}</div> : null}
        </div>
      )
    },
    { key: 'payment_method', header: t('payment_method'), width: 100, render: (r) => methodBn(r.payment_method) },
    { key: 'user_name', header: t('cashier'), width: 110, render: (r) => <span className="muted">{r.user_name ?? '—'}</span> },
    {
      key: 'total', header: t('total'), align: 'right', width: 110,
      render: (r) => <span className="td-strong num">{money(r.total)}</span>
    },
    {
      key: 'due', header: t('due'), align: 'right', width: 100,
      render: (r) => r.due > 0 ? <span className="num neg td-strong">{money(r.due)}</span> : <span className="muted-2">—</span>
    },
    { key: 'status', header: t('status'), width: 110, render: statusBadge }
  ], [])

  return (
    <div className="page">
      <PageHeader title={t('sales_title')} sub={t('sales_sub')} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <RangePicker
          value={range}
          onChange={(k, f, tt) => { setRange(k); if (f && tt) { setFrom(f); setTo(tt) }; setPage(1) }}
        />
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="চালান নং বা গ্রাহক…" style={{ width: 240 }} />
        <button className={`chip ${dueOnly ? 'active' : ''}`} onClick={() => { setDueOnly(!dueOnly); setPage(1) }}>{t('due_only')}</button>
      </div>

      {data && data.sums ? (
        <div className="grid-stats" style={{ marginBottom: 14 }}>
          <div className="stat compact"><div className="stat-label">বিক্রয় (নির্বাচিত সময়)</div><div className="stat-value num">{money(data.sums.total)}</div></div>
          <div className="stat compact"><div className="stat-label">{t('paid')}</div><div className="stat-value num">{money(data.sums.paid)}</div></div>
          <div className="stat compact"><div className="stat-label">{t('due')}</div><div className="stat-value num" style={{ color: data.sums.due > 0 ? 'var(--warning-text)' : undefined }}>{money(data.sums.due)}</div></div>
          {can('finance.view') ? <div className="stat compact"><div className="stat-label">COGS</div><div className="stat-value num">{money(data.sums.cogs)}</div></div> : null}
        </div>
      ) : null}

      <DataTable
        columns={columns}
        rows={data?.rows ?? []}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/sales/${r.id}`)}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={() => void refetch()}
        emptyTitle="এই সময়ে কোনো বিক্রয় নেই"
        emptySub="POS থেকে বিক্রয় শুরু করুন"
        maxHeight="calc(100vh - 360px)"
      />
      <div className="card" style={{ borderTop: 'none', borderRadius: '0 0 var(--r-xl) var(--r-xl)' }}>
        <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
      </div>
    </div>
  )
}
