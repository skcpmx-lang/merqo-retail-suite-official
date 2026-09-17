import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Ban, MoreHorizontal, Trash2, Settings2, PlusCircle } from 'lucide-react'
import { api } from '@/api/client'
import { useSession } from '@/state/session'
import { useToast } from '@/state/toast'
import { t, money, fdatetime, presetRange, num } from '@/i18n/bn'
import { PageHeader, DataTable, Pagination, RangePicker, StatCard, Modal, Field, Menu, MenuItem, Badge, ConfirmDialog, type RangeKind, type Column } from '@/ui/components'
import { PERMS } from '../perm'

interface ExpRow {
  id: string
  title: string
  date: number
  category_name: string | null
  amount: number
  account_name: string
  method: string | null
  note: string | null
  status: string
  user_name: string | null
}

export function Expenses() {
  const { can } = useSession()
  const qc = useQueryClient()
  const { toast } = useToast()

  const [range, setRange] = useState<RangeKind>('30d')
  const [from, setFrom] = useState(() => presetRange('30d').from)
  const [to, setTo] = useState(() => presetRange('30d').to)
  const [page, setPage] = useState(1)
  const [newOpen, setNewOpen] = useState(false)
  const [catOpen, setCatOpen] = useState(false)
  const [voidFor, setVoidFor] = useState<ExpRow | null>(null)
  const pageSize = 25

  const { data, isLoading, refetch, error } = useQuery({
    queryKey: ['expenses', from, to, page],
    queryFn: () => api.get<{ rows: ExpRow[]; total: number; sums: { total: number; count: number } }>('/expenses', { from, to, page, pageSize })
  })
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: () => api.get<{ rows: Array<{ id: string; name: string; type: string }> }>('/accounts') })

  const columns = useMemo<Column<ExpRow>[]>(() => [
    {
      key: 'title', header: t('details'),
      render: (r: ExpRow) => (
        <div>
          <div className="td-strong">{r.title}</div>
          {r.note ? <div className="td-sub">{r.note}</div> : null}
        </div>
      )
    },
    { key: 'date', header: t('date'), width: 150, render: (r: ExpRow) => <span className="muted">{fdatetime(r.date)}</span> },
    { key: 'category_name', header: t('expense_category'), width: 150, render: (r: ExpRow) => r.category_name ?? '—' },
    { key: 'account_name', header: t('account'), width: 130, render: (r: ExpRow) => <span className="muted">{r.account_name}</span> },
    { key: 'user_name', header: 'করেছেন', width: 110, render: (r: ExpRow) => <span className="muted small">{r.user_name ?? ''}</span> },
    {
      key: 'amount', header: t('amount'), align: 'right', width: 120,
      render: (r: ExpRow) => <span className="num neg td-strong">{money(r.amount)}</span>
    },
    {
      key: 'act', header: '', width: 60,
      render: (r: ExpRow) => can(PERMS.EXPENSES_DELETE) ? (
        <Menu align="right" trigger={<button className="btn btn-ghost btn-sm btn-icon" aria-label="আরও বিকল্প" onClick={(e) => e.stopPropagation()}><MoreHorizontal size={15} /></button>}>
          <MenuItem icon={<Ban size={14} />} danger onClick={() => setVoidFor(r)}>বাতিল করুন</MenuItem>
        </Menu>
      ) : null
    }
  ], [])

  return (
    <div className="page">
      <PageHeader
        title={t('expenses_title')}
        sub={t('expenses_sub')}
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => setCatOpen(true)}><Settings2 size={15} /> খাত ব্যবস্থাপনা</button>
            {can(PERMS.EXPENSES_CREATE) ? <button className="btn btn-primary" onClick={() => setNewOpen(true)}><Plus size={16} /> {t('add_expense')}</button> : null}
          </>
        }
      />

      <div className="grid-stats" style={{ marginBottom: 14 }}>
        <StatCard compact label="মোট খরচ" value={money(data?.sums.total ?? 0)} tone="danger" />
        <StatCard compact label="খরচের সংখ্যা" value={num(data?.sums.count ?? 0)} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <RangePicker value={range} onChange={(k, f, tt) => { setRange(k); if (f && tt) { setFrom(f); setTo(tt) }; setPage(1) }} />
      </div>

      <DataTable
        columns={columns}
        rows={data?.rows ?? []}
        rowKey={(r) => r.id}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={() => void refetch()}
        emptyTitle="কোনো খরচ নেই"
        emptySub="দোকান ভাড়া, বিদ্যুৎ বিল, বকেয়া পরিবহন — সব খরচ এখানে রাখুন"
        emptyAction={can(PERMS.EXPENSES_CREATE) ? <button className="btn btn-primary btn-sm" onClick={() => setNewOpen(true)}><Plus size={14} /> {t('add_expense')}</button> : undefined}
        maxHeight="calc(100vh - 420px)"
      />
      <div className="card" style={{ borderTop: 'none', borderRadius: '0 0 var(--r-xl) var(--r-xl)' }}>
        <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
      </div>

      <ExpenseModal open={newOpen} accounts={accounts?.rows ?? []} onClose={() => setNewOpen(false)} />
      <CategoryModal open={catOpen} onClose={() => setCatOpen(false)} />
      {voidFor ? <VoidExpenseModal row={voidFor} onClose={() => setVoidFor(null)} /> : null}
    </div>
  )
}

function ExpenseModal({ open, accounts, onClose }: { open: boolean; accounts: Array<{ id: string; name: string; type: string }>; onClose: () => void }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('')
  const [accountId, setAccountId] = useState(accounts.find((a) => a.type === 'cash')?.id ?? '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const { data: cats } = useQuery({ queryKey: ['expense-categories'], queryFn: () => api.get<{ rows: Array<{ id: string; name: string }> }>('/expense-categories'), enabled: open })

  const submit = async () => {
    const amt = Math.round(Number(amount) * 100) || 0
    if (amt <= 0) { toast('পরিমাণ দিন', 'warning'); return }
    if (!title.trim()) { toast('খরচের বিষয় লিখুন', 'warning'); return }
    setBusy(true)
    try {
      await api.post('/expenses', { title: title.trim(), amount: amt, category_id: category || null, account_id: accountId, note: note || undefined })
      void qc.invalidateQueries()
      toast('খরচ যোগ হয়েছে', 'success')
      setTitle(''); setAmount(''); setNote(''); onClose()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('add_expense')} size="sm"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? <span className="spinner" /> : null}{t('save')}</button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="খরচের বিষয়" required hint="যেমন: দোকান ভাড়া, বিদ্যুৎ বিল">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <Field label={`${t('amount')} (৳)`} required>
          <input className="input input-money input-lg" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" onFocus={(e) => e.target.select()} />
        </Field>
        <Field label={t('expense_category')}>
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">—</option>
            {(cats?.rows ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="কোন হিসাব থেকে" required>
          <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label={t('note')}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="যেমন: জুন মাসের বিদ্যুৎ বিল" /></Field>
      </div>
    </Modal>
  )
}

function CategoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const { data: cats, refetch } = useQuery({ queryKey: ['expense-categories'], queryFn: () => api.get<{ rows: Array<{ id: string; name: string }> }>('/expense-categories'), enabled: open })

  const add = async () => {
    if (!name.trim()) return
    try {
      await api.post('/expense-categories', { name: name.trim() })
      setName(''); void refetch(); void qc.invalidateQueries()
    } catch (e) { toast((e as Error).message, 'error') }
  }

  return (
    <Modal open={open} onClose={onClose} title="খরচের খাত" size="sm"
      footer={<button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input className="input grow" placeholder="নতুন খাতের নাম" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void add() }} />
        <button className="btn btn-primary" onClick={() => void add()}><PlusCircle size={15} /> যোগ</button>
      </div>
      <div className="flex flex-col gap-1">
        {(cats?.rows ?? []).map((c) => (
          <div key={c.id} className="recent-row">
            <div className="grow">{c.name}</div>
          </div>
        ))}
        {(cats?.rows ?? []).length === 0 ? <div className="empty"><p>কোনো খাত নেই</p></div> : null}
      </div>
    </Modal>
  )
}


function VoidExpenseModal({ row, onClose }: { row: ExpRow; onClose: () => void }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal open onClose={onClose} title="খরচ বাতিল করুন" size="sm"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
          <button
            className="btn btn-danger"
            disabled={busy || !reason.trim()}
            onClick={async () => {
              setBusy(true)
              try {
                await api.post(`/expenses/${row.id}/void`, { reason: reason.trim() })
                void qc.invalidateQueries()
                toast('খরচ বাতিল হয়েছে — টাকা হিসাবে ফেরত এসেছে', 'success')
                onClose()
              } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
            }}
          >{busy ? <span className="spinner" /> : null}বাতিল করুন</button>
        </>
      }
    >
      <div className="alert alert-warning"><b>{row.title}</b> — {money(row.amount)} ({row.account_name})</div>
      <Field label="বাতিলের কারণ" required>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="যেমন: ভুল এন্ট্রি হয়েছিল" autoFocus />
      </Field>
      <p className="small muted">বাতিল করলে টাকা হিসাবে ফেরত আসবে; রেকর্ড বাতিল হিসেবে থেকে যাবে (মুছবে না)।</p>
    </Modal>
  )
}
