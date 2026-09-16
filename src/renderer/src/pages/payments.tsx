import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { t, money, fdatetime, presetRange, num } from '@/i18n/bn'
import { api } from '@/api/client'
import { useSession } from '@/state/session'
import { PageHeader, DataTable, Pagination, RangePicker, Badge, type RangeKind, type Column } from '@/ui/components'
import { PERMS } from '../perm'
import { methodBn } from '@/lib/printing'

interface PayRow {
  id: string
  voucher_no: string
  date: number
  party_type: string
  party_name: string | null
  direction: string
  amount: number
  method: string
  account_name: string
  note: string | null
  user_name: string | null
}

export function Payments() {
  const { can } = useSession()
  const [tab, setTab] = useState<'in' | 'out' | 'all'>('all')
  const [range, setRange] = useState<RangeKind>('30d')
  const [from, setFrom] = useState(() => presetRange('30d').from)
  const [to, setTo] = useState(() => presetRange('30d').to)
  const [page, setPage] = useState(1)
  const pageSize = 30

  const { data, isLoading, refetch, error } = useQuery({
    queryKey: ['payments', from, to, page],
    queryFn: () => api.get<{ rows: PayRow[]; total: number; sums: { cash_in: number; cash_out: number } }>('/payments', { from, to, page, pageSize })
  })

  const rows = useMemo(() => (data?.rows ?? []).filter((r) => tab === 'all' || (tab === 'in' ? r.direction === 'in' : r.direction === 'out')), [data, tab])

  const columns: Column<PayRow>[] = [
    { key: 'voucher_no', header: t('voucher_no'), width: 140, render: (r) => <span className="td-strong num">{r.voucher_no}</span> },
    { key: 'date', header: t('date'), width: 150, render: (r) => <span className="muted">{fdatetime(r.date)}</span> },
    {
      key: 'party_name', header: 'পক্ষ',
      render: (r) => (
        <div>
          <div className="td-strong">{r.party_name ?? '—'}</div>
          <div className="td-sub">{r.party_type === 'customer' ? 'গ্রাহক' : r.party_type === 'supplier' ? 'সরবরাহকারী' : r.party_type}</div>
        </div>
      )
    },
    { key: 'method', header: t('payment_method'), width: 110, render: (r) => methodBn(r.method) },
    { key: 'account_name', header: t('account'), width: 130, render: (r) => <span className="muted">{r.account_name}</span> },
    { key: 'note', header: t('note'), render: (r) => <span className="muted small">{r.note ?? '—'}</span> },
    { key: 'user_name', header: t('cashier'), width: 110, render: (r) => <span className="muted small">{r.user_name ?? ''}</span> },
    {
      key: 'amount', header: t('amount'), align: 'right', width: 130,
      render: (r) => <span className={`num td-strong ${r.direction === 'in' ? 'pos' : 'neg'}`}>{r.direction === 'in' ? '+' : '−'}{money(r.amount)}</span>
    }
  ]

  return (
    <div className="page">
      <PageHeader title={t('payments_title')} sub={t('payments_sub')} />

      <div className="grid-stats" style={{ marginBottom: 14 }}>
        <div className="stat compact"><div className="stat-label">আদায় (নির্বাচিত সময়)</div><div className="stat-value num pos">{money(data?.sums.cash_in ?? 0)}</div></div>
        <div className="stat compact"><div className="stat-label">পরিশোধ</div><div className="stat-value num neg">{money(data?.sums.cash_out ?? 0)}</div></div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="segmented">
          <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>সব</button>
          <button className={tab === 'in' ? 'active' : ''} onClick={() => setTab('in')}>আদায়</button>
          <button className={tab === 'out' ? 'active' : ''} onClick={() => setTab('out')}>পরিশোধ</button>
        </div>
        <RangePicker value={range} onChange={(k, f, tt) => { setRange(k); if (f && tt) { setFrom(f); setTo(tt) }; setPage(1) }} />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={() => void refetch()}
        emptyTitle="কোনো পেমেন্ট নেই"
        emptySub="গ্রাহকের বকেয়া আদায় বা সরবরাহকারীকে পরিশোধ এখানে দেখা যাবে"
        maxHeight="calc(100vh - 400px)"
      />
      <div className="card" style={{ borderTop: 'none', borderRadius: '0 0 var(--r-xl) var(--r-xl)' }}>
        <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
      </div>
    </div>
  )
}
