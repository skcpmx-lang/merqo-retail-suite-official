import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/api/client'
import { t, money, num, fdatetime, presetRange } from '@/i18n/bn'
import { PageHeader, DataTable, Pagination, type Column } from '@/ui/components'

interface ReturnRow {
  id: string
  return_no: string
  sale_id: string
  invoice_no: string
  customer_name: string | null
  date: number
  total: number
  method: string
  restock: number
  reason: string | null
  user_name: string | null
}

export function ReturnsList() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const pageSize = 30

  const { data, isLoading, refetch, error } = useQuery({
    queryKey: ['returns', page],
    queryFn: () => api.get<{ rows: ReturnRow[]; total: number }>('/returns', { page, pageSize })
  })

  const columns: Column<ReturnRow>[] = [
    { key: 'return_no', header: t('return_no'), width: 140, render: (r) => <span className="td-strong num">{r.return_no}</span> },
    {
      key: 'invoice_no', header: t('invoice_no'), width: 140,
      render: (r) => <button className="btn-link num" onClick={() => navigate(`/sales/${r.sale_id}`)}>{r.invoice_no}</button>
    },
    { key: 'customer_name', header: t('type_customer'), render: (r) => r.customer_name ?? t('walkin_customer') },
    { key: 'date', header: t('date'), width: 150, render: (r) => <span className="muted">{fdatetime(r.date)}</span> },
    { key: 'method', header: t('return_method'), width: 130, render: (r) => r.method === 'cash' ? 'নগদ ফেরত' : 'বকেয়া সমন্বয়' },
    { key: 'restock', header: t('return_restock'), width: 100, render: (r) => r.restock ? 'হ্যাঁ' : 'না' },
    { key: 'reason', header: t('note'), render: (r) => <span className="muted small">{r.reason ?? '—'}</span> },
    { key: 'total', header: t('total'), align: 'right', width: 110, render: (r) => <span className="td-strong num">{money(r.total)}</span> }
  ]

  return (
    <div className="page">
      <PageHeader title={t('returns_title')} sub={t('returns_sub')} />
      <DataTable
        columns={columns}
        rows={data?.rows ?? []}
        rowKey={(r) => r.id}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={() => void refetch()}
        emptyTitle="কোনো ফেরত নেই"
        emptySub="চালান থেকে ফেরত করা যায়"
        emptyAction={<button className="btn btn-secondary btn-sm" onClick={() => navigate('/documents')}>{t('nav_documents')}</button>}
        maxHeight="calc(100vh - 300px)"
      />
      <div className="card" style={{ borderTop: 'none', borderRadius: '0 0 var(--r-xl) var(--r-xl)' }}>
        <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
      </div>
    </div>
  )
}
