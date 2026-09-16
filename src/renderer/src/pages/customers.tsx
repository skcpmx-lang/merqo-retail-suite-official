import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Pencil, Banknote, MoreHorizontal, Trash2 } from 'lucide-react'
import { api } from '@/api/client'
import { useSession } from '@/state/session'
import { useToast } from '@/state/toast'
import { t, money, bnPhone } from '@/i18n/bn'
import { PageHeader, DataTable, Pagination, SearchInput, Modal, Field, Menu, MenuItem, Badge, ConfirmDialog, type Column } from '@/ui/components'
import { PERMS } from '../perm'
import { dueReceiptHtml, printDoc } from '@/lib/printing'
import { useBusinessInfo } from '@/lib/useBusinessInfo'

interface CustRow {
  id: string
  code: string | null
  name: string
  phone: string | null
  address: string | null
  receivable: number
  opening_due: number
  status: string
}

export function CustomersList() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { can } = useSession()
  const { info: bizInfo } = useBusinessInfo()
  const [params] = useSearchParams()

  const [search, setSearch] = useState('')
  const [dueOnly, setDueOnly] = useState(params.get('due') === '1')
  const [page, setPage] = useState(1)
  const pageSize = 25
  const [collectFor, setCollectFor] = useState<CustRow | null>(null)
  const [editFor, setEditFor] = useState<CustRow | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [delFor, setDelFor] = useState<CustRow | null>(null)

  const { data, isLoading, refetch, error } = useQuery({
    queryKey: ['customers', search, dueOnly, page],
    queryFn: () => api.get<{ rows: CustRow[]; total: number; sums: { receivable: number } }>('/customers', {
      search: search || undefined, due: dueOnly ? '1' : undefined, page, pageSize
    })
  })

  const columns = useMemo<Column<CustRow>[]>(() => [
    {
      key: 'name', header: t('customer_name'),
      render: (r: CustRow) => (
        <div className="flex items-center gap-2">
          <span className="avatar" style={{ width: 30, height: 30, fontSize: 13 }}>{r.name.slice(0, 1)}</span>
          <div><div className="td-strong">{r.name}</div>{r.phone ? <div className="td-sub num">{bnPhone(r.phone)}</div> : null}</div>
        </div>
      )
    },
    { key: 'address', header: t('address'), render: (r: CustRow) => <span className="muted small">{r.address ?? '—'}</span> },
    {
      key: 'receivable', header: t('due'), align: 'right' as const, width: 130,
      render: (r: CustRow) => r.receivable > 0
        ? <span className="num neg td-strong">{money(r.receivable)}</span>
        : <span className="muted-2">—</span>
    },
    {
      key: 'act', header: '', width: 150,
      render: (r: CustRow) => (
        <div className="flex gap-1" style={{ justifyContent: 'flex-end' }}>
          {can(PERMS.DUES_COLLECT) && r.receivable > 0 ? (
            <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); setCollectFor(r) }}>
              <Banknote size={13} /> {t('collect_due')}
            </button>
          ) : null}
          <Menu align="right" trigger={<button className="btn btn-ghost btn-sm btn-icon" onClick={(e) => e.stopPropagation()}><MoreHorizontal size={15} /></button>}>
            {can(PERMS.CUSTOMERS_MANAGE) ? <MenuItem icon={<Pencil size={14} />} onClick={() => setEditFor(r)}>{t('edit')}</MenuItem> : null}
            {can(PERMS.DUES_COLLECT) && r.receivable > 0 ? <MenuItem icon={<Banknote size={14} />} onClick={() => setCollectFor(r)}>{t('collect_due')}</MenuItem> : null}
            <div className="menu-sep" />
            {can(PERMS.CUSTOMERS_MANAGE) && r.status === 'active' ? <MenuItem icon={<Trash2 size={14} />} danger onClick={() => setDelFor(r)}>বন্ধ করুন</MenuItem> : null}
          </Menu>
        </div>
      )
    }
  ], [])

  return (
    <div className="page">
      <PageHeader
        title={t('customers_title')}
        sub={t('customers_sub')}
        actions={can(PERMS.CUSTOMERS_MANAGE) ? <button className="btn btn-primary" onClick={() => setNewOpen(true)}><Plus size={16} /> {t('add_customer')}</button> : undefined}
      />

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="নাম বা ফোন…" style={{ width: 260 }} />
        <button className={`chip ${dueOnly ? 'active' : ''}`} onClick={() => { setDueOnly(!dueOnly); setPage(1) }}>{t('due_only')}</button>
        {data?.sums && data.sums.receivable > 0 ? <Badge tone="warning">মোট বকেয়া: {money(data.sums.receivable)}</Badge> : null}
      </div>

      <DataTable
        columns={columns}
        rows={data?.rows ?? []}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/customers/${r.id}`)}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={() => void refetch()}
        emptyTitle="কোনো গ্রাহক নেই"
        emptySub="বাকিতে বিক্রি করতে গ্রাহক যোগ করুন"
        maxHeight="calc(100vh - 360px)"
      />
      <div className="card" style={{ borderTop: 'none', borderRadius: '0 0 var(--r-xl) var(--r-xl)' }}>
        <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
      </div>

      {collectFor ? (
        <CollectModal
          customer={collectFor}
          bizInfo={bizInfo}
          onClose={() => setCollectFor(null)}
        />
      ) : null}
      {editFor ? <CustomerModal existing={editFor} onClose={() => setEditFor(null)} /> : null}
      <CustomerModal open={newOpen} onClose={() => setNewOpen(false)} />
      <ConfirmDialog
        open={!!delFor}
        onClose={() => setDelFor(null)}
        title="গ্রাহক বন্ধ করুন"
        body={`${delFor?.name} — গ্রাহক তালিকা থেকে সরে যাবে। পুরনো বিক্রয় ও বকেয়া অপরিবর্তিত থাকবে।`}
        confirmLabel="বন্ধ করুন"
        danger
        onConfirm={async () => {
          try {
            await api.patch(`/customers/${delFor!.id}`, { status: 'inactive' })
            void qc.invalidateQueries()
            toast('গ্রাহক বন্ধ করা হয়েছে', 'success')
            setDelFor(null)
          } catch (e) { toast((e as Error).message, 'error') }
        }}
      />
    </div>
  )
}

export function CustomerModal({ existing, open, onClose }: { existing?: CustRow; open?: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [name, setName] = useState(existing?.name ?? '')
  const [phone, setPhone] = useState(existing?.phone ?? '')
  const [address, setAddress] = useState(existing?.address ?? '')
  const [openingDue, setOpeningDue] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!name.trim()) { toast('নাম দিন', 'warning'); return }
    setBusy(true)
    try {
      if (existing) await api.patch(`/customers/${existing.id}`, { name: name.trim(), phone: phone.trim() || null, address: address.trim() || null })
      else await api.post('/customers', { name: name.trim(), phone: phone.trim() || null, address: address.trim() || null, opening_due: Math.round(Number(openingDue || 0) * 100) || 0 })
      void qc.invalidateQueries()
      toast(existing ? 'গ্রাহক হালনাগাদ হয়েছে' : 'গ্রাহক যোগ হয়েছে', 'success')
      onClose()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={existing ? t('edit_customer') : t('add_customer')} size="sm"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void save()}>{busy ? <span className="spinner" /> : null}{t('save')}</button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('customer_name')} required><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label={t('phone')}><input className="input num" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder="01712345678" /></Field>
        <Field label={t('address')}><input className="input" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        {!existing ? <Field label="পুরনো বকেয়া (৳)" hint="আগে থেকে যা পাওনা আছে"><input className="input input-money" value={openingDue} onChange={(e) => setOpeningDue(e.target.value)} inputMode="decimal" placeholder="0" /></Field> : null}
      </div>
    </Modal>
  )
}

export function CollectModal({ customer, bizInfo, onClose }: {
  customer: { id: string; name: string; receivable: number }
  bizInfo: import('@/lib/printing').BizInfo
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [amount, setAmount] = useState(String(customer.receivable / 100))
  const [method, setMethod] = useState('cash')
  const [accountId, setAccountId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<null | { voucher_no: string; date: number; amount: number; before: number; after: number; method: string }>(null)

  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: () => api.get<{ rows: Array<{ id: string; name: string; type: string }> }>('/accounts') })

  const submit = async () => {
    const amt = Math.round(Number(amount) * 100) || 0
    if (amt <= 0) return
    if (amt > customer.receivable) { toast(`সর্বোচ্চ ${money(customer.receivable)} আদায় করা যাবে`, 'warning'); return }
    if (!accountId) { toast('হিসাব বাছুন', 'warning'); return }
    setBusy(true)
    try {
      const res = await api.post<{ voucher_no: string; date: number; receivable_after: number; amount: number }>(`/customers/${customer.id}/collect`, {
        amount: amt,
        account_id: accountId,
        method, note: note || undefined
      })
      void qc.invalidateQueries()
      toast(`${t('due_collect_success')} — ${money(amt)}`, 'success')
      setReceipt({ voucher_no: res.voucher_no, date: res.date, amount: amt, before: customer.receivable, after: res.receivable_after, method })
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  if (receipt) {
    return (
      <Modal open onClose={onClose} title={t('due_receipt')} size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
            <button
              className="btn btn-primary"
              onClick={() => {
                void printDoc(dueReceiptHtml(bizInfo, {
                  voucher_no: receipt.voucher_no, date: receipt.date, customer_name: customer.name,
                  amount: receipt.amount, before: receipt.before, after: receipt.after, method: receipt.method, note: note || null, user_name: ''
                }), { paper: '80mm' })
                onClose()
              }}
            >
              🖨 {t('print_receipt')}
            </button>
          </>
        }
      >
        <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
          <div style={{ fontSize: 34, fontWeight: 800, color: 'var(--success-text)' }}>{money(receipt.amount)}</div>
          <div className="muted small">আদায় সম্পন্ন — রসিদ {receipt.voucher_no}</div>
        </div>
        <div className="sum-row"><span>আগের বকেয়া</span><span className="num">{money(receipt.before)}</span></div>
        <div className="sum-row"><span>এখন বাকি</span><span className="num td-strong">{money(receipt.after)}</span></div>
      </Modal>
    )
  }

  return (
    <Modal open onClose={onClose} title={t('collect_due')} sub={`${customer.name} — বকেয়া ${money(customer.receivable)}`} size="sm"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? <span className="spinner" /> : null}{t('confirm')}</button>
        </>
      }
    >
      <Field label={`${t('amount')} (৳)`} required hint={`সর্বোচ্চ ${money(customer.receivable)}`}>
        <input className="input input-money input-lg" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus onFocus={(e) => e.target.select()} />
      </Field>
      <Field label={t('payment_method')} style={{ marginTop: 12 }}>
        <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="cash">ক্যাশ</option>
          <option value="bkash">বিকাশ</option>
          <option value="nagad">নগদ</option>
          <option value="rocket">রকেট</option>
          <option value="upay">Upay</option>
          <option value="bank">ব্যাংক</option>
        </select>
      </Field>
      <Field label="কোন হিসাবে জমা হবে" required style={{ marginTop: 12 }}>
        <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {(accounts?.rows ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      <Field label={t('note')} style={{ marginTop: 12 }}>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ঐচ্ছিক" />
      </Field>
    </Modal>
  )
}
