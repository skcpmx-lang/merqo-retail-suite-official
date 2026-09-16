import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, KeyRound, Trash2, ShieldCheck } from 'lucide-react'
import { api } from '@/api/client'
import { useSession } from '@/state/session'
import { useToast } from '@/state/toast'
import { t, money, fdatetime } from '@/i18n/bn'
import { PageHeader, DataTable, Modal, Field, Menu, MenuItem, Badge, ConfirmDialog, StatCard, type Column } from '@/ui/components'
import { PERMS, PERM_GROUPS } from '../perm'

interface Member { id: string; user_id: string; user_name: string; username: string; role_id: string | null; role_name: string | null; is_owner: number; status: string }
interface Role { id: string; name: string; note?: string | null; description?: string | null; permissions: string[]; is_system: number }
interface User { id: string; name: string; username: string; phone: string | null; status: string; created_at: number; last_login_at: number | null }

export function Staff() {
  const { can } = useSession()
  const qc = useQueryClient()
  const { toast } = useToast()

  const [memberOpen, setMemberOpen] = useState<null | { existing?: Member }>(null)
  const [roleOpen, setRoleOpen] = useState<null | { existing?: Role }>(null)
  const [userOpen, setUserOpen] = useState(false)
  const [pwFor, setPwFor] = useState<Member | null>(null)
  const [removeFor, setRemoveFor] = useState<Member | null>(null)
  const [delRole, setDelRole] = useState<Role | null>(null)

  const { data: members, isLoading, refetch, error } = useQuery({
    queryKey: ['staff-members'],
    queryFn: () => api.get<{ rows: Member[] }>('/staff/members')
  })
  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: () => api.get<{ rows: Role[] }>('/roles') })

  const memberCols: Column<Member>[] = [
    {
      key: 'user_name', header: 'নাম',
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="avatar" style={{ width: 30, height: 30, fontSize: 13 }}>{r.user_name.slice(0, 1)}</span>
          <div><div className="td-strong">{r.user_name}</div><div className="td-sub num">@{r.username}</div></div>
        </div>
      )
    },
    {
      key: 'role_name', header: 'ভূমিকা', width: 160,
      render: (r) => r.is_owner ? <Badge tone="primary"><ShieldCheck size={11} /> {t('owner')}</Badge> : <Badge tone="neutral">{r.role_name ?? '—'}</Badge>
    },
    { key: 'status', header: t('status'), width: 100, render: (r) => r.status === 'active' ? <Badge tone="success">চালু</Badge> : <Badge tone="danger">বন্ধ</Badge> },
    {
      key: 'act', header: '', width: 150,
      render: (r) => can(PERMS.STAFF_MANAGE) && !r.is_owner ? (
        <Menu align="right" trigger={<button className="btn btn-ghost btn-sm btn-icon" aria-label="সম্পাদনা"><Pencil size={14} /></button>}>
          <MenuItem onClick={() => setMemberOpen({ existing: r })}>{t('edit')}</MenuItem>
          <MenuItem icon={<KeyRound size={14} />} onClick={() => setPwFor(r)}>পাসওয়ার্ড রিসেট</MenuItem>
          <div className="menu-sep" />
          <MenuItem icon={<Trash2 size={14} />} danger onClick={() => setRemoveFor(r)}>সরিয়ে দিন</MenuItem>
        </Menu>
      ) : null
    }
  ]

  return (
    <div className="page">
      <PageHeader
        title={t('staff_title')}
        sub={t('staff_sub')}
        actions={
          <>
            {can(PERMS.ROLES_MANAGE) ? <button className="btn btn-secondary" onClick={() => setRoleOpen({})}><ShieldCheck size={15} /> {t('roles')}</button> : null}
            {can(PERMS.STAFF_MANAGE) ? <button className="btn btn-primary" onClick={() => setUserOpen(true)}><Plus size={16} /> নতুন ইউজার</button> : null}
          </>
        }
      />

      <div className="grid-stats" style={{ marginBottom: 14 }}>
        <StatCard compact label="দলের সদস্য" value={String(members?.rows.length ?? 0)} />
        <StatCard compact label={t('roles')} value={String(roles?.rows.length ?? 0)} />
      </div>

      <DataTable
        columns={memberCols}
        rows={members?.rows ?? []}
        rowKey={(r) => r.id}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={() => void refetch()}
        emptyTitle="কোনো সদস্য নেই"
        maxHeight="calc(100vh - 380px)"
      />

      <RoleList roles={roles?.rows ?? []} onEdit={(r) => setRoleOpen({ existing: r })} onDelete={(r) => setDelRole(r)} canManage={can(PERMS.ROLES_MANAGE)} />

      {/* new user + membership */}
      <NewUserModal open={userOpen} roles={roles?.rows ?? []} onClose={() => setUserOpen(false)} />
      {memberOpen ? <MemberModal member={memberOpen.existing} roles={roles?.rows ?? []} onClose={() => setMemberOpen(null)} /> : null}
      {roleOpen ? <RoleModal existing={roleOpen.existing} onClose={() => setRoleOpen(null)} /> : null}

      {/* password reset */}
      <Modal open={!!pwFor} onClose={() => setPwFor(null)} title="পাসওয়ার্ড রিসেট" sub={pwFor ? `${pwFor.user_name} (@${pwFor.username})` : ''} size="sm"
        footer={<button className="btn btn-secondary" onClick={() => setPwFor(null)}>{t('cancel')}</button>}>
        <PasswordResetForm
          onDone={() => { setPwFor(null); void qc.invalidateQueries() }}
          userId={pwFor?.user_id ?? ''}
          memberLevel={!!pwFor && !pwFor.is_owner}
        />
      </Modal>

      <ConfirmDialog
        open={!!removeFor}
        onClose={() => setRemoveFor(null)}
        title="সদস্য সরান"
        body={`${removeFor?.user_name} — এই ব্যবসা থেকে সদস্যতা সরে যাবে; ইউজার অ্যাকাউন্ট ও অন্য ব্যবসার অ্যাক্সেস অক্ষত থাকবে।`}
        confirmLabel="সরান"
        danger
        onConfirm={async () => {
          try {
            await api.del(`/staff/members/${removeFor!.id}`)
            void qc.invalidateQueries()
            toast('সদস্য সরানো হয়েছে', 'success')
            setRemoveFor(null)
          } catch (e) { toast((e as Error).message, 'error') }
        }}
      />
      <ConfirmDialog
        open={!!delRole}
        onClose={() => setDelRole(null)}
        title="ভূমিকা মুছুন"
        body={`${delRole?.name} — এই ভূমিকায় থাকা সদস্যরা 'কোনো ভূমিকা নেই' অবস্থায় যাবে।`}
        confirmLabel={t('delete_confirm')}
        danger
        onConfirm={async () => {
          try {
            await api.del(`/roles/${delRole!.id}`)
            void qc.invalidateQueries()
            toast('ভূমিকা মুছে ফেলা হয়েছে', 'success')
            setDelRole(null)
          } catch (e) { toast((e as Error).message, 'error') }
        }}
      />
    </div>
  )
}

function RoleList({ roles, onEdit, onDelete, canManage }: { roles: Role[]; onEdit: (r: Role) => void; onDelete: (r: Role) => void; canManage: boolean }) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-header"><h3>{t('roles')}</h3><span className="small muted">সিস্টেম ভূমিকা সম্পাদনা করা যায় না</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10, padding: 14 }}>
        {roles.map((r) => (
          <div key={r.id} className="card card-pad" style={{ margin: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="grow"><div className="strong">{r.name}</div><div className="small muted">{r.permissions.length} অনুমতি</div></div>
              {canManage && !r.is_system ? (
                <Menu align="right" trigger={<button className="btn btn-ghost btn-sm btn-icon" aria-label="সম্পাদনা"><Pencil size={13} /></button>}>
                  <MenuItem onClick={() => onEdit(r)}>{t('edit')}</MenuItem>
                  <MenuItem icon={<Trash2 size={13} />} danger onClick={() => onDelete(r)}>{t('delete')}</MenuItem>
                </Menu>
              ) : <Badge tone="neutral">সিস্টেম</Badge>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function NewUserModal({ open, roles, onClose }: { open: boolean; roles: Role[]; onClose: () => void }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [roleId, setRoleId] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim() || !username.trim() || password.length < 6) { toast('নাম, ইউজারনেম ও ৬+ অক্ষরের পাসওয়ার্ড দিন', 'warning'); return }
    setBusy(true)
    try {
      await api.post('/staff/users', { name: name.trim(), username: username.trim().toLowerCase(), password, phone: phone.trim() || undefined })
      if (roleId) await api.post('/staff/members', { username: username.trim().toLowerCase(), role_id: roleId })
      void qc.invalidateQueries()
      toast('ইউজার তৈরি ও দলে যোগ হয়েছে', 'success')
      setName(''); setUsername(''); setPassword(''); setPhone(''); setRoleId('')
      onClose()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="নতুন ইউজার ও সদস্য" size="md"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? <span className="spinner" /> : null}{t('save')}</button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid-2">
          <Field label="নাম" required><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
          <Field label="ইউজারনেম" required><input className="input num" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        </div>
        <div className="grid-2">
          <Field label="পাসওয়ার্ড" required hint="৬+ অক্ষর"><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Field label="ফোন"><input className="input num" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        </div>
        <Field label="ভূমিকা (এই ব্যবসায়)" hint="পরে বদলানো যাবে">
          <select className="select" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">— পরে ঠিক করব —</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  )
}

function MemberModal({ member, roles, onClose }: { member?: Member; roles: Role[]; onClose: () => void }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [name, setName] = useState(member?.user_name ?? '')
  const [roleId, setRoleId] = useState(member?.role_id ?? '')
  const [status, setStatus] = useState(member?.status ?? 'active')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      await api.patch(`/staff/members/${member!.id}`, { role_id: roleId || null, status })
      if (name.trim() !== member?.user_name) await api.patch(`/staff/users/${member!.user_id}`, { name: name.trim() })
      void qc.invalidateQueries()
      toast('সদস্য হালনাগাদ হয়েছে', 'success')
      onClose()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title="সদস্য সম্পাদনা" sub={`@${member?.username ?? ''}`} size="sm"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? <span className="spinner" /> : null}{t('save')}</button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="নাম"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="ভূমিকা">
          <select className="select" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">— নেই —</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label={t('status')}>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">চালু</option>
            <option value="inactive">বন্ধ</option>
          </select>
        </Field>
      </div>
    </Modal>
  )
}

function PasswordResetForm({ userId, onDone }: { userId: string; onDone: () => void; memberLevel: boolean }) {
  const { toast } = useToast()
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex flex-col gap-3">
      <Field label="নতুন পাসওয়ার্ড" required hint="৬+ অক্ষর">
        <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
      </Field>
      <button
        className="btn btn-primary btn-block"
        disabled={busy || pw.length < 6}
        onClick={async () => {
          setBusy(true)
          try {
            await api.patch(`/staff/users/${userId}`, { password: pw })
            toast('পাসওয়ার্ড বদলে গেছে', 'success')
            onDone()
          } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
        }}
      >{busy ? <span className="spinner" /> : null}রিসেট করুন</button>
    </div>
  )
}

function RoleModal({ existing, onClose }: { existing?: Role; onClose: () => void }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [name, setName] = useState(existing?.name ?? '')
  const [selected, setSelected] = useState<Set<string>>(new Set(existing?.permissions ?? []))
  const [busy, setBusy] = useState(false)

  const toggle = (p: string) => {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(p)) n.delete(p)
      else n.add(p)
      return n
    })
  }
  const toggleGroup = (perms: string[]) => {
    setSelected((s) => {
      const n = new Set(s)
      const all = perms.every((p) => n.has(p))
      for (const p of perms) { if (all) n.delete(p); else n.add(p) }
      return n
    })
  }

  const submit = async () => {
    if (!name.trim()) { toast('ভূমিকার নাম দিন', 'warning'); return }
    setBusy(true)
    try {
      if (existing) await api.patch(`/roles/${existing.id}`, { name: name.trim(), permissions: Array.from(selected) })
      else await api.post('/roles', { name: name.trim(), permissions: Array.from(selected) })
      void qc.invalidateQueries()
      toast('ভূমিকা সংরক্ষিত হয়েছে', 'success')
      onClose()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={existing ? 'ভূমিকা সম্পাদনা' : 'নতুন ভূমিকা'} size="lg"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? <span className="spinner" /> : null}{t('save')}</button>
        </>
      }
    >
      <Field label="ভূমিকার নাম" required>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="strong small" style={{ margin: '12px 0 6px' }}>অনুমতিসমূহ — {selected.size} টি নির্বাচিত</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        {PERM_GROUPS.map((g) => {
          const groupPermKeys = g.perms.map((p) => p[0])
          const all = groupPermKeys.every((p) => selected.has(p))
          return (
            <div key={g.key} className="card card-pad" style={{ margin: 0 }}>
              <label className="check" style={{ fontWeight: 700 }}>
                <input type="checkbox" checked={all} onChange={() => toggleGroup(groupPermKeys)} /> {g.label}
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                {g.perms.map(([perm, label]) => (
                  <label key={perm} className="check small">
                    <input type="checkbox" checked={selected.has(perm)} onChange={() => toggle(perm)} /> {label}
                  </label>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
