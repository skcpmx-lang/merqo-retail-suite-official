import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileDown } from 'lucide-react'
import { api } from '@/api/client'
import { useSession } from '@/state/session'
import { useToast } from '@/state/toast'
import { t, fdatetime, presetRange, money } from '@/i18n/bn'
import { PageHeader, DataTable, Pagination, RangePicker, SearchInput, Badge, type RangeKind, type Column } from '@/ui/components'
import { PERMS } from '../perm'

interface AuditRow {
  id: string
  user_name: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  note: string | null
  created_at: number
  before_json: string | null
  after_json: string | null
}

const ACTION_GROUPS: Array<{ label: string; match: string }> = [
  { label: 'সব', match: '' },
  { label: 'বিক্রয়', match: 'sale' },
  { label: 'ক্রয়', match: 'purchase' },
  { label: 'পণ্য', match: 'product' },
  { label: 'গ্রাহক/সরবরাহকারী', match: 'part' },
  { label: 'পেমেন্ট', match: 'payment' },
  { label: 'খরচ', match: 'expense' },
  { label: 'MFS', match: 'mfs' },
  { label: 'ইউজার/ভূমিকা', match: 'user' },
  { label: 'সেটিংস/ব্যাকআপ', match: 'settings' }
]

export function Audit() {
  const { can } = useSession()
  const { toast } = useToast()
  const [range, setRange] = useState<RangeKind>('7d')
  const [from, setFrom] = useState(() => presetRange('7d').from)
  const [to, setTo] = useState(() => presetRange('7d').to)
  const [action, setAction] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 40

  const { data, isLoading, refetch, error } = useQuery({
    queryKey: ['audit', from, to, action, page],
    queryFn: () => api.get<{ rows: AuditRow[]; total: number }>('/audit', { from, to, action: action || undefined, page, pageSize }),
    enabled: can(PERMS.AUDIT_VIEW)
  })

  const exportCsv = async () => {
    try {
      const all = await api.get<{ rows: AuditRow[] }>('/audit', { from, to, action: action || undefined, pageSize: 100000 })
      await api.post('/audit/export', { entity: 'audit' })
      const rows = all.rows
      const head = ['সময়', 'ইউজার', 'কাজ', 'বিষয়', 'আইডি', 'নোট']
      const body = rows.map((r) => [new Date(r.created_at).toLocaleString('bn-BD'), r.user_name ?? '', r.action, r.entity_type ?? '', r.entity_id ?? '', (r.note ?? '').replace(/[",\n]/g, ' ')].join(',')).join('\n')
      const blob = new Blob(['\uFEFF' + head.join(',') + '\n' + body], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'audit-log.csv'
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) { toast((e as Error).message, 'error') }
  }

  const actionBn = (a: string) => {
    const map: Record<string, string> = {
      'sale.create': 'বিক্রয় হয়েছে', 'sale.void': 'বিক্রয় বাতিল',
      'return.create': 'ফেরত নেওয়া হয়েছে',
      'purchase.create': 'ক্রয় হয়েছে', 'purchase.void': 'ক্রয় বাতিল',
      'product.create': 'পণ্য যোগ', 'product.update': 'পণ্য সম্পাদনা', 'product.delete': 'পণ্য মুছে ফেলা',
      'product.barcode_add': 'বারকোড যোগ', 'inventory.adjust': 'স্টক সমন্বয়',
      'customer.create': 'গ্রাহক যোগ', 'customer.update': 'গ্রাহক সম্পাদনা', 'customer.payment': 'বকেয়া আদায়',
      'supplier.create': 'সরবরাহকারী যোগ', 'supplier.update': 'সরবরাহকারী সম্পাদনা', 'supplier.payment': 'পাওনা পরিশোধ',
      'expense.create': 'খরচ যোগ', 'expense.void': 'খরচ বাতিল', 'expense_category.create': 'খরচের খাত যোগ',
      'account.create': 'হিসাব খোলা', 'account.update': 'হিসাব সম্পাদনা', 'account.transfer': 'ট্রান্সফার',
      'mfs.txn': 'MFS লেনদেন',
      'user.create': 'ইউজার তৈরি', 'user.update': 'ইউজার সম্পাদনা', 'user.password_change': 'পাসওয়ার্ড বদল',
      'settings.update': 'সেটিংস বদল', 'backup.create': 'ব্যাকআপ নেওয়া', 'data.export': 'ডেটা এক্সপোর্ট'
    }
    return map[a] ?? a
  }

  const columns: Column<AuditRow>[] = [
    { key: 'created_at', header: t('date'), width: 155, render: (r) => <span className="muted small">{fdatetime(r.created_at)}</span> },
    { key: 'user_name', header: 'ইউজার', width: 120, render: (r) => <span className="td-strong">{r.user_name ?? 'সিস্টেম'}</span> },
    { key: 'action', header: 'কাজ', render: (r) => <span>{actionBn(r.action)} <span className="muted small num">({r.action})</span></span> },
    { key: 'entity_type', header: 'বিষয়', width: 110, render: (r) => <span className="muted small">{({ product: 'পণ্য', customer: 'গ্রাহক', supplier: 'সরবরাহকারী', sale: 'বিক্রয়', purchase: 'ক্রয়', account: 'হিসাব', user: 'ইউজার', settings: 'সেটিংস' }[r.entity_type ?? ''] ?? r.entity_type ?? '—')}</span> },
    { key: 'note', header: 'নোট', render: (r) => <span className="muted small">{r.note ?? '—'}</span> }
  ]

  if (!can(PERMS.AUDIT_VIEW)) return null

  return (
    <div className="page">
      <PageHeader
        title={t('audit_title')}
        sub={t('audit_sub')}
        actions={<button className="btn btn-secondary" onClick={() => void exportCsv()}><FileDown size={15} /> CSV এক্সপোর্ট</button>}
      />

      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <RangePicker value={range} onChange={(k, f, tt) => { setRange(k); if (f && tt) { setFrom(f); setTo(tt) }; setPage(1) }} />
        <SearchInput value={action} onChange={(v) => { setAction(v); setPage(1) }} placeholder="কাজ খুঁজুন (যেমন sale)…" style={{ width: 220 }} />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {ACTION_GROUPS.map((g) => (
          <button key={g.label} className={`chip ${action === g.match ? 'active' : ''}`} onClick={() => { setAction(g.match); setPage(1) }}>{g.label}</button>
        ))}
      </div>

      <DataTable
        columns={columns}
        rows={data?.rows ?? []}
        rowKey={(r) => r.id}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={() => void refetch()}
        emptyTitle="কোনো লগ নেই"
        maxHeight="calc(100vh - 420px)"
      />
      <div className="card" style={{ borderTop: 'none', borderRadius: '0 0 var(--r-xl) var(--r-xl)' }}>
        <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
      </div>
    </div>
  )
}
