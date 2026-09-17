import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DatabaseBackup, Upload, HardDriveDownload, ShieldCheck, FileDown } from 'lucide-react'
import { api } from '@/api/client'
import { useSession } from '@/state/session'
import { useToast } from '@/state/toast'
import { t, money, fdatetime, num } from '@/i18n/bn'
import { PageHeader, Modal, Field, Badge, ConfirmDialog } from '@/ui/components'
import { PERMS } from '../perm'

interface BackupRow { id: string; file: string; size: number; note: string | null; auto: number; verified: number; created_at: number }

export function Data() {
  const { can } = useSession()
  const qc = useQueryClient()
  const { toast } = useToast()
  const [note, setNote] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [restoreFor, setRestoreFor] = useState<BackupRow | null>(null)
  const [restoreConfirmText, setRestoreConfirmText] = useState('')
  const [restoreStage, setRestoreStage] = useState<null | 'validated'>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: backups, isLoading, refetch } = useQuery({
    queryKey: ['backups'],
    queryFn: () => api.get<{ rows: BackupRow[] }>('/backups'),
    enabled: can(PERMS.BACKUP_CREATE)
  })

  const createBackup = async () => {
    setBusy(true)
    try {
      await api.post('/backups', { note: note.trim() || undefined })
      void qc.invalidateQueries({ queryKey: ['backups'] })
      toast('ব্যাকআপ তৈরি ও যাচাই হয়েছে', 'success')
      setCreateOpen(false); setNote('')
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  const restore = async () => {
    if (!restoreFor) return
    setBusy(true)
    try {
      const bridge = (window as unknown as { merqo?: { restoreBackup: (file: string) => Promise<{ ok: boolean; message?: string }> } }).merqo
      if (!bridge) throw new Error('রিস্টোর শুধু ডেস্কটপ অ্যাপে করা যায়।')
      const res = await bridge.restoreBackup(restoreFor.file)
      if (!res.ok) throw new Error(res.message ?? 'রিস্টোর ব্যর্থ হয়েছে')
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  const exportAll = async () => {
    try {
      const [products, customers, suppliers] = await Promise.all([
        api.get<{ rows: unknown[] }>('/products', { pageSize: 100000 }),
        api.get<{ rows: unknown[] }>('/customers', { pageSize: 100000 }),
        api.get<{ rows: unknown[] }>('/suppliers', { pageSize: 100000 })
      ])
      await api.post('/audit/export', { entity: 'data_page' })
      // bundle as one CSV per entity in a single printable report is heavy; hand the user three CSVs
      downloadCsv('products.csv', products.rows as Record<string, unknown>[])
      downloadCsv('customers.csv', customers.rows as Record<string, unknown>[])
      downloadCsv('suppliers.csv', suppliers.rows as Record<string, unknown>[])
      toast('CSV ফাইলগুলো ডাউনলোড হয়েছে', 'success')
    } catch (e) { toast((e as Error).message, 'error') }
  }

  const downloadCsv = (name: string, rows: Record<string, unknown>[]) => {
    if (rows.length === 0) return
    const keys = Object.keys(rows[0]).filter((k) => !k.endsWith('_json') && k !== 'image_data')
    const body = rows.map((r) => keys.map((k) => {
      const v = r[k]
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + keys.join(',') + '\n' + body], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <PageHeader title={t('data_title')} sub={t('data_sub')} />

      <div className="grid-2">
        {/* backup */}
        <div className="card card-pad">
          <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
            <span className="avatar" style={{ background: 'var(--primary-soft)', color: 'var(--primary-text)' }}><DatabaseBackup size={16} /></span>
            <div><div className="strong">{t('backup_create')}</div><div className="small muted">পুরো ডেটাবেসের নিরাপদ কপি — যাচাই করা</div></div>
          </div>
          <p className="small muted" style={{ marginBottom: 12 }}>
            ব্যাকআপ ফাইল অ্যাপের ব্যাকআপ ফোল্ডারে সংরক্ষিত হয় এবং খুলে যাচাই করা হয়।
            নিয়মিত ব্যাকআপ নিন — বিশেষত দিন শেষে।
          </p>
          {can(PERMS.BACKUP_CREATE) ? (
            <button className="btn btn-primary btn-block" onClick={() => setCreateOpen(true)}><DatabaseBackup size={15} /> {t('backup_create')}</button>
          ) : null}
        </div>

        {/* export */}
        <div className="card card-pad">
          <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
            <span className="avatar" style={{ background: 'var(--success-soft)', color: 'var(--success-text)' }}><FileDown size={16} /></span>
            <div><div className="strong">{t('export_data')}</div><div className="small muted">পণ্য, গ্রাহক, সরবরাহকারী — CSV</div></div>
          </div>
          <p className="small muted" style={{ marginBottom: 12 }}>
            Excel-এ খোলা যায় এমন CSV (UTF-8 বাংলা সহ)। বিক্রয় রিপোর্ট রিপোর্ট পাতা থেকে CSV/প্রিন্ট করা যায়।
          </p>
          <button className="btn btn-secondary btn-block" onClick={() => void exportAll()}><FileDown size={15} /> {t('export_data')}</button>
        </div>
      </div>

      {/* restore */}
      <div className="card card-pad" style={{ marginTop: 16 }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
          <span className="avatar" style={{ background: 'var(--warning-soft)', color: 'var(--warning-text)' }}><Upload size={16} /></span>
          <div><div className="strong">{t('restore_btn')}</div><div className="small muted">ব্যাকআপ ফাইল থেকে পুরো ডেটা ফেরানো</div></div>
        </div>
        <p className="small muted" style={{ marginBottom: 12 }}>
          রিস্টোর করলে <b>বর্তমান সব ডেটা বদলে যাবে</b>। অ্যাপ নিজেই আগের অবস্থার একটি সেফটি কপি রেখে দেবে।
          ডেস্কটপ অ্যাপে যেকোনো <code>.mqbak</code> ফাইল বাছাই করে রিস্টোর করা যায় — নিচের তালিকা থেকেও ফেরানো যাবে।
        </p>
        {can(PERMS.BACKUP_RESTORE) ? (
          <button className="btn btn-secondary btn-block" onClick={() => fileRef.current?.click()}><HardDriveDownload size={15} /> ফাইল থেকে রিস্টোর…</button>
        ) : null}
        <input ref={fileRef} type="file" accept=".mqbak,.db,.sqlite" style={{ display: 'none' }}
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            // desktop app restores from a file path via bridge; in-app we can't read arbitrary paths — guide the user
            const bridge = (window as unknown as { merqo?: { restoreBackup: (file: string) => Promise<{ ok: boolean; message?: string }> } }).merqo
            if (!bridge) { toast('রিস্টোর শুধু ডেস্কটপ অ্যাপে করা যায়।', 'warning'); return }
            setRestoreConfirmText('')
            toast('ডেস্কটপ অ্যাপে "ব্যাকআপ ফোল্ডার খুলুন" থেকে ফাইলটি বাছুন — নিচের তালিকা থেকেও ফেরানো যায়।', 'info')
            e.target.value = ''
          }}
        />
      </div>

      {/* backup list */}
      <div className="card" style={{ marginTop: 16, overflow: 'hidden' }}>
        <div className="card-header"><h3>ব্যাকআপ তালিকা</h3><button className="btn btn-ghost btn-sm" onClick={() => void refetch()}>রিফ্রেশ</button></div>
        <table className="tbl">
          <thead><tr><th>তারিখ</th><th>ফাইল</th><th className="ta-r">আকার</th><th>নোট</th><th>যাচাই</th><th></th></tr></thead>
          <tbody>
            {backups?.rows.map((b) => (
              <tr key={b.id}>
                <td className="small muted">{fdatetime(b.created_at)}</td>
                <td className="num small">{b.file.split(/[\\/]/).pop()}</td>
                <td className="ta-r num small">{(b.size / 1048576).toFixed(2)} MB</td>
                <td className="small muted">{b.note ?? '—'} {b.auto ? <Badge tone="neutral">স্বয়ংক্রিয়</Badge> : null}</td>
                <td>{b.verified ? <Badge tone="success">✓</Badge> : <Badge tone="warning">—</Badge>}</td>
                <td>
                  {can(PERMS.BACKUP_RESTORE) ? (
                    <button className="btn btn-ghost btn-sm" onClick={() => { setRestoreFor(b); setRestoreConfirmText(''); setRestoreStage(null) }}>{t('restore_btn')}</button>
                  ) : null}
                </td>
              </tr>
            ))}
            {backups && backups.rows.length === 0 ? (
              <tr><td colSpan={6}><div className="empty"><p>এখনো কোনো ব্যাকআপ নেই</p></div></td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* create backup modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('backup_create')} size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setCreateOpen(false)}>{t('cancel')}</button>
            <button className="btn btn-primary" disabled={busy} onClick={() => void createBackup()}>{busy ? <span className="spinner" /> : <ShieldCheck size={14} />} তৈরি করুন</button>
          </>
        }
      >
        <Field label="নোট (ঐচ্ছিক)">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="যেমন: মাস শেষের ব্যাকআপ" autoFocus />
        </Field>
      </Modal>

      {/* restore confirm */}
      <Modal open={!!restoreFor} onClose={() => setRestoreFor(null)} title={t('restore_btn')} size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setRestoreFor(null)}>{t('cancel')}</button>
            <button
              className="btn btn-danger"
              disabled={busy || restoreConfirmText !== 'রিস্টোর'}
              onClick={() => void restore()}
            >{busy ? <span className="spinner" /> : null}রিস্টোর করুন</button>
          </>
        }
      >
        <div className="alert alert-danger">
          <b>সতর্কতা:</b> বর্তমান সব ডেটা বদলে যাবে ({restoreFor ? fdatetime(restoreFor.created_at) : ''} এর ব্যাকআপ বসবে)।
        </div>
        <Field label="নিশ্চিত করতে লিখুন: রিস্টোর" required>
          <input className="input" value={restoreConfirmText} onChange={(e) => setRestoreConfirmText(e.target.value)} autoFocus />
        </Field>
      </Modal>
    </div>
  )
}
