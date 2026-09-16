import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Pencil, Banknote, MoreHorizontal, Trash2 } from 'lucide-react'
import { api } from '@/api/client'
import { useSession } from '@/state/session'
import { useToast } from '@/state/toast'
import { t, money } from '@/i18n/bn'
import { PageHeader, DataTable, Pagination, SearchInput, Modal, Field, Menu, MenuItem, Badge, ConfirmDialog, type Column } from '@/ui/components'
import { PERMS } from '../perm'

interface SupRow {
  id: string
  name: string
  phone: string | null
  address: string | null
  payable: number
  opening_due: number
  status: string
}

export function SuppliersList() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { can } = useSession()

  const [search, setSearch] = useState('')
  const [dueOnly, setDueOnly] = useState(false)
  const [page, setPage] = useState(1)
  const pageSize = 25
  const [editFor, setEditFor] = useState<SupRow | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [payFor, setPayFor] = useState<SupRow | null>(null)
  const [delFor, setDelFor] = useState<SupRow | null>(null)

  const { data, isLoading, refetch, error } = useQuery({
    queryKey: ['suppliers', search, dueOnly, page],
    queryFn: () => api.get<{ rows: SupRow[]; total: number; sums: { payable: number } }>('/suppliers', { search: search || undefined, due: dueOnly ? '1' : undefined, page, pageSize })
  })
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: () => api.get<{ rows: Array<{ id: string; name: string; type: string }> }>('/accounts') })

  const columns = useMemo<Column<SupRow>[]>(() => [
    {
      key: 'name', header: t('supplier_name'),
      render: (r: SupRow) => (
        <div className="flex items-center gap-2">
          <span className="avatar" style={{ width: 30, height: 30, fontSize: 13 }}>{r.name.slice(0, 1)}</span>
          <div><div className="td-strong">{r.name}</div>{r.phone ? <div className="td-sub num">{r.phone}</div> : null}</div>
        </div>
      )
    },
    { key: 'address', header: t('address'), render: (r: SupRow) => <span className="muted small">{r.address ?? '—'}</span> },
    {
      key: 'payable', header: 'পাওনা', align: 'right', width: 130,
      render: (r: SupRow) => r.payable > 0 ? <span className="num neg td-strong">{money(r.payable)}</span> : <span className="muted-2">—</span>
    },
    {
      key: 'act', header: '', width: 150,
      render: (r: SupRow) => (
        <div className="flex gap-1" style={{ justifyContent: 'flex-end' }}>
          {can(PERMS.DUES_PAY) && r.payable > 0 ? (
            <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); setPayFor(r) }}><Banknote size={13} /> {t('pay_supplier')}</button>
          ) : null}
          <Menu align="right" trigger={<button className="btn btn-ghost btn-sm btn-icon" aria-label="আরও বিকল্প" onClick={(e) => e.stopPropagation()}><MoreHorizontal size={15} /></button>}>
            {can(PERMS.SUPPLIERS_MANAGE) ? <MenuItem icon={<Pencil size={14} />} onClick={() => setEditFor(r)}>{t('edit')}</MenuItem> : null}
            <div className="menu-sep" />
            {can(PERMS.SUPPLIERS_MANAGE) && r.status === 'active' ? <MenuItem icon={<Trash2 size={14} />} danger onClick={() => setDelFor(r)}>বন্ধ করুন</MenuItem> : null}
          </Menu>
        </div>
      )
    }
  ], [])

  return (
    <div className="page">
      <PageHeader
        title={t('suppliers_title')}
        sub={t('suppliers_sub')}
        actions={can(PERMS.SUPPLIERS_MANAGE) ? <button className="btn btn-primary" onClick={() => setNewOpen(true)}><Plus size={16} /> {t('add_supplier')}</button> : undefined}
      />

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="নাম বা ফোন…" style={{ width: 260 }} />
        <button className={`chip ${dueOnly ? 'active' : ''}`} onClick={() => { setDueOnly(!dueOnly); setPage(1) }}>পাওনা আছে</button>
        {data?.sums && data.sums.payable > 0 ? <Badge tone="danger">মোট পাওনা: {money(data.sums.payable)}</Badge> : null}
      </div>

      <DataTable
        columns={columns}
        rows={data?.rows ?? []}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/suppliers/${r.id}`)}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={() => void refetch()}
        emptyTitle="কোনো সরবরাহকারী নেই"
        emptySub="পণ্য কেনার জন্য সরবরাহকারী যোগ করুন"
        maxHeight="calc(100vh - 360px)"
      />
      <div className="card" style={{ borderTop: 'none', borderRadius: '0 0 var(--r-xl) var(--r-xl)' }}>
        <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
      </div>

      <SupplierModal existing={editFor ?? undefined} open={newOpen || !!editFor} onClose={() => { setNewOpen(false); setEditFor(null) }} />
      {payFor ? <PayModal supplier={payFor} accounts={accounts?.rows ?? []} onClose={() => setPayFor(null)} /> : null}
      <ConfirmDialog
        open={!!delFor}
        onClose={() => setDelFor(null)}
        title="সরবরাহকারী বন্ধ করুন"
        body={`${delFor?.name} — তালিকা থেকে সরে যাবে। পুরনো ক্রয় ও পাওনা অপরিবর্তিত থাকবে।`}
        confirmLabel="বন্ধ করুন"
        danger
        onConfirm={async () => {
          try {
            await api.patch(`/suppliers/${delFor!.id}`, { status: 'inactive' })
            void qc.invalidateQueries()
            toast('সরবরাহকারী বন্ধ করা হয়েছে', 'success')
            setDelFor(null)
          } catch (e) { toast((e as Error).message, 'error') }
        }}
      />
    </div>
  )
}

export function SupplierModal({ existing, open, onClose }: { existing?: SupRow; open?: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [name, setName] = useState(existing?.name ?? '')
  const [phone, setPhone] = useState(existing?.phone ?? '')
  const [address, setAddress] = useState(existing?.address ?? '')
  const [openingDue, setOpeningDue] = useState('')
  const [busy, setBusy] = useState(false)
  const isOpen = open ?? !!existing

  const save = async () => {
    if (!name.trim()) { toast('নাম দিন', 'warning'); return }
    setBusy(true)
    try {
      if (existing) await api.patch(`/suppliers/${existing.id}`, { name: name.trim(), phone: phone.trim() || null, address: address.trim() || null })
      else await api.post('/suppliers', { name: name.trim(), phone: phone.trim() || null, address: address.trim() || null, opening_due: Math.round(Number(openingDue || 0) * 100) || 0 })
      void qc.invalidateQueries()
      toast(existing ? 'সরবরাহকারী হালনাগাদ হয়েছে' : 'সরবরাহকারী যোগ হয়েছে', 'success')
      onClose()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open={isOpen} onClose={onClose} title={existing ? t('edit_supplier') : t('add_supplier')} size="sm"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void save()}>{busy ? <span className="spinner" /> : null}{t('save')}</button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('supplier_name')} required><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label={t('phone')}><input className="input num" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" /></Field>
        <Field label={t('address')}><input className="input" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        {!existing ? <Field label="পুরনো পাওনা (৳)" hint="আগে থেকে যা দিতে হবে"><input className="input input-money" value={openingDue} onChange={(e) => setOpeningDue(e.target.value)} inputMode="decimal" placeholder="0" /></Field> : null}
      </div>
    </Modal>
  )
}

function PayModal({ supplier, accounts, onClose }: {
  supplier: SupRow
  accounts: Array<{ id: string; name: string; type: string }>
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [amount, setAmount] = useState(String(supplier.payable / 100))
  const [accountId, setAccountId] = useState(accounts.find((a) => a.type === 'cash')?.id ?? '')
  const [method, setMethod] = useState('cash')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const amt = Math.round(Number(amount) * 100) || 0
    if (amt <= 0) return
    if (amt > supplier.payable) { toast(`সর্বোচ্চ ${money(supplier.payable)} দেওয়া যাবে`, 'warning'); return }
    setBusy(true)
    try {
      await api.post(`/suppliers/${supplier.id}/pay`, { amount: amt, account_id: accountId, method, note: note || undefined })
      void qc.invalidateQueries()
      toast('পরিশোধ সম্পন্ন', 'success')
      onClose()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={t('pay_supplier')} sub={`${supplier.name} — পাওনা ${money(supplier.payable)}`} size="sm"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? <span className="spinner" /> : null}{t('confirm')}</button>
        </>
      }
    >
      <Field label={`${t('amount')} (৳)`} required hint={`সর্বোচ্চ ${money(supplier.payable)}`}>
        <input className="input input-money input-lg" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus onFocus={(e) => e.target.select()} />
      </Field>
      <Field label={t('payment_method')} style={{ marginTop: 12 }}>
        <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="cash">ক্যাশ</option>
          <option value="bank">ব্যাংক</option>
          <option value="bkash">বিকাশ</option>
          <option value="nagad">নগদ</option>
        </select>
      </Field>
      <Field label={t('pay_from_account')} required style={{ marginTop: 12 }}>
        <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      <Field label={t('note')} style={{ marginTop: 12 }}>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ঐচ্ছিক — চেক নং ইত্যাদি" />
      </Field>
    </Modal>
  )
}
