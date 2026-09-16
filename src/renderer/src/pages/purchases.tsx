import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { api } from '@/api/client'
import { useSession } from '@/state/session'
import { t, money, fdatetime, presetRange } from '@/i18n/bn'
import { PageHeader, DataTable, Pagination, RangePicker, Badge, type RangeKind, type Column } from '@/ui/components'
import { PERMS } from '../perm'

interface PurchaseRow {
  id: string
  ref_no: string
  supplier_name: string
  date: number
  total: number
  paid: number
  due: number
  status: string
  user_name: string | null
}

export function PurchasesList() {
  const navigate = useNavigate()
  const { can } = useSession()
  const [range, setRange] = useState<RangeKind>('30d')
  const [from, setFrom] = useState(() => presetRange('30d').from)
  const [to, setTo] = useState(() => presetRange('30d').to)
  const [page, setPage] = useState(1)
  const pageSize = 30

  const { data, isLoading, refetch, error } = useQuery({
    queryKey: ['purchases', from, to, page],
    queryFn: () => api.get<{ rows: PurchaseRow[]; total: number; sums: { total: number; paid: number; due: number } }>('/purchases', { from, to, page, pageSize })
  })

  const columns = useMemo<Column<PurchaseRow>[]>(() => [
    { key: 'ref_no', header: t('purchase_no'), width: 150, render: (r) => <span className="td-strong num">{r.ref_no}</span> },
    {
      key: 'supplier_name', header: t('type_supplier'),
      render: (r) => <button className="btn-link" onClick={(e) => { e.stopPropagation(); navigate('/suppliers') }}>{r.supplier_name}</button>
    },
    { key: 'date', header: t('date'), width: 150, render: (r) => <span className="muted">{fdatetime(r.date)}</span> },
    { key: 'total', header: t('total'), align: 'right', width: 120, render: (r) => <span className="td-strong num">{money(r.total)}</span> },
    { key: 'paid', header: t('paid'), align: 'right', width: 110, render: (r) => <span className="num pos">{money(r.paid)}</span> },
    {
      key: 'due', header: t('due'), align: 'right', width: 110,
      render: (r) => r.due > 0 ? <span className="num neg td-strong">{money(r.due)}</span> : <span className="muted-2">—</span>
    },
    {
      key: 'status', header: t('status'), width: 110,
      render: (r) => r.status === 'voided' ? <Badge tone="danger">{t('sale_status_voided')}</Badge> : <Badge tone="success">সম্পন্ন</Badge>
    }
  ], [])

  return (
    <div className="page">
      <PageHeader
        title={t('purchases_title')}
        sub={t('purchases_sub')}
        actions={can(PERMS.PURCHASES_CREATE) ? <button className="btn btn-primary" onClick={() => navigate('/purchases/new')}><Plus size={16} /> {t('new_purchase')}</button> : undefined}
      />

      <div style={{ marginBottom: 14 }}>
        <RangePicker value={range} onChange={(k, f, tt) => { setRange(k); if (f && tt) { setFrom(f); setTo(tt) }; setPage(1) }} />
      </div>

      {data?.sums ? (
        <div className="grid-stats" style={{ marginBottom: 14 }}>
          <div className="stat compact"><div className="stat-label">ক্রয়ের মোট</div><div className="stat-value num">{money(data.sums.total)}</div></div>
          <div className="stat compact"><div className="stat-label">{t('paid')}</div><div className="stat-value num">{money(data.sums.paid)}</div></div>
          <div className="stat compact"><div className="stat-label">{t('due')}</div><div className="stat-value num" style={{ color: data.sums.due > 0 ? 'var(--danger-text)' : undefined }}>{money(data.sums.due)}</div></div>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        rows={data?.rows ?? []}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/purchases/${r.id}`)}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={() => void refetch()}
        emptyTitle="কোনো ক্রয় নেই"
        emptySub="সরবরাহকারী থেকে পণ্য কিনতে নতুন ক্রয় শুরু করুন"
        maxHeight="calc(100vh - 400px)"
      />
      <div className="card" style={{ borderTop: 'none', borderRadius: '0 0 var(--r-xl) var(--r-xl)' }}>
        <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
      </div>
    </div>
  )
}
