import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Inbox, Loader2, AlertTriangle, Search, X } from 'lucide-react'
import { num, presetRange } from '@/i18n/bn'

/* ───────────── page scaffolding ───────────── */

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {sub ? <div className="ph-sub">{sub}</div> : null}
      </div>
      {actions ? <div className="ph-actions">{actions}</div> : null}
    </div>
  )
}

export function StatCard({ label, value, sub, icon, tone, onClick, compact }: {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon?: ReactNode
  tone?: 'default' | 'success' | 'danger' | 'warning' | 'primary'
  onClick?: () => void
  compact?: boolean
}) {
  const toneColor = tone === 'success' ? 'var(--success-text)' : tone === 'danger' ? 'var(--danger-text)' : tone === 'warning' ? 'var(--warning-text)' : tone === 'primary' ? 'var(--on-primary-soft)' : 'var(--text)'
  return (
    <div className={`stat ${compact ? 'compact' : ''}`} style={onClick ? { cursor: 'pointer' } : undefined} onClick={onClick} role={onClick ? 'button' : undefined}>
      <div className="stat-label">{icon}{label}</div>
      <div className="stat-value" style={{ color: toneColor }}>{value}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  )
}

/* ───────────── fields ───────────── */

export function Field({ label, required, error, hint, children, style }: {
  label?: string
  required?: boolean
  error?: string
  hint?: string
  children: ReactNode
  style?: CSSProperties
}) {
  return (
    <div className="field" style={style}>
      {label ? (
        <label className="label">
          {label}
          {required ? <span className="req">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? <div className="error-text"><AlertTriangle size={12} />{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder, autoFocus, style }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  style?: CSSProperties
}) {
  return (
    <div className="search-box" style={style}>
      <Search size={16} />
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder ?? 'খুঁজুন'}
      />
      {value ? (
        <button className="btn btn-ghost btn-sm btn-icon" style={{ position: 'absolute', right: 3, top: 3 }} onClick={() => onChange('')} aria-label="মুছুন">
          <X size={13} />
        </button>
      ) : null}
    </div>
  )
}

/* ───────────── buttons ───────────── */

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="spin" />
}

export function Loading({ label = 'লোড হচ্ছে…' }: { label?: string }) {
  return (
    <div className="empty">
      <Spinner size={22} />
      <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>{label}</div>
    </div>
  )
}

export function LoadError({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="empty">
      <div className="empty-icon"><AlertTriangle size={22} /></div>
      <h4>লোড করা যায়নি</h4>
      <p>{message ?? 'ডেটা আনতে সমস্যা হয়েছে। সংযোগ ঠিক থাকলে আবার চেষ্টা করুন।'}</p>
      {onRetry ? <div className="empty-actions"><button className="btn btn-secondary btn-sm" onClick={onRetry}>আবার চেষ্টা করুন</button></div> : null}
    </div>
  )
}

export function EmptyState({ title, sub, icon, action }: { title: string; sub?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon ?? <Inbox size={22} />}</div>
      <h4>{title}</h4>
      {sub ? <p>{sub}</p> : null}
      {action ? <div className="empty-actions">{action}</div> : null}
    </div>
  )
}

/* ───────────── modal / confirm ───────────── */

export function Modal({ open, onClose, title, sub, children, footer, size }: {
  open: boolean
  onClose: () => void
  title: string
  sub?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  const cls = size === 'sm' ? 'modal-sm' : size === 'lg' ? 'modal-lg' : size === 'xl' ? 'modal-xl' : ''
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal ${cls}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            {sub ? <div className="sub">{sub}</div> : null}
          </div>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="বন্ধ"><X size={16} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  )
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel = 'নিশ্চিত করুন', danger, busy, requireText }: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  body: ReactNode
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  /** type-to-confirm for irreversible actions */
  requireText?: string
}) {
  const [typed, setTyped] = useState('')
  useEffect(() => { if (open) setTyped('') }, [open])
  const blocked = requireText ? typed !== requireText : false
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>বাতিল</button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy || blocked}
          >
            {busy ? <Spinner size={14} /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-2)' }}>{body}</div>
      {requireText ? (
        <div style={{ marginTop: 14 }}>
          <Field label={`নিশ্চিত করতে "${requireText}" লিখুন`}>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </Field>
        </div>
      ) : null}
    </Modal>
  )
}

/* ───────────── drawer ───────────── */

export function Drawer({ open, onClose, title, children, footer, wide }: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <>
      <div className="drawer-overlay" onMouseDown={onClose} />
      <div className={`drawer ${wide ? 'drawer-lg' : ''}`} role="dialog" aria-modal="true">
        <div className="drawer-header">
          <h2 style={{ fontSize: 16 }}>{title}</h2>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="বন্ধ"><X size={16} /></button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-footer">{footer}</div> : null}
      </div>
    </>
  )
}

/* ───────────── dropdown menu ───────────── */

export function Menu({ trigger, children, align }: { trigger: ReactNode; children: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div className="menu-wrap" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open ? (
        <div className="menu" style={align === 'left' ? { left: 0, right: 'auto' } : undefined} onClick={() => setOpen(false)}>
          {children}
        </div>
      ) : null}
    </div>
  )
}

export function MenuItem({ icon, children, onClick, danger, disabled }: {
  icon?: ReactNode
  children: ReactNode
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button className={`menu-item ${danger ? 'danger' : ''}`} onClick={onClick} disabled={disabled}>
      {icon}
      {children}
    </button>
  )
}

/* ───────────── tooltip ───────────── */

export function Tip({ label, children, place }: { label: string; children: ReactNode; place?: 'above-left' }) {
  const [show, setShow] = useState(false)
  return (
    <span
      className="tip"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      {show ? <span className={`tip-body ${place ?? ''}`} role="tooltip">{label}</span> : null}
    </span>
  )
}

/* ───────────── table ───────────── */

export interface Column<T> {
  key: string
  header: ReactNode
  render?: (row: T, index: number) => ReactNode
  width?: string | number
  align?: 'left' | 'right' | 'center'
  title?: (row: T) => string
}

export function Table<T>({ columns, rows, rowKey, onRowClick, footer, maxHeight, style }: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T, i: number) => string
  onRowClick?: (row: T) => void
  footer?: ReactNode
  maxHeight?: number | string
  style?: CSSProperties
}) {
  return (
    <div className="table-scroll" style={{ maxHeight, ...style }}>
      <table className="tbl">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ width: c.width, textAlign: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left' }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              className={onRowClick ? 'clickable' : ''}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              title={undefined}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={c.align === 'right' ? 't-num' : ''}
                  title={c.title?.(row)}
                >
                  {c.render ? c.render(row, i) : String((row as Record<string, unknown>)[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer ? <tfoot>{footer}</tfoot> : null}
      </table>
    </div>
  )
}

export function DataTable<T>(props: Parameters<typeof Table<T>>[0] & {
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  emptyTitle: string
  emptySub?: string
  emptyAction?: ReactNode
  emptyIcon?: ReactNode
}) {
  const { loading, error, onRetry, emptyTitle, emptySub, emptyAction, emptyIcon, ...tableProps } = props
  const { rows } = tableProps
  return (
    <div className="table-wrap">
      {loading && rows.length === 0 ? (
        <div style={{ padding: '36px 0' }}><Loading /></div>
      ) : error && rows.length === 0 ? (
        <LoadError message={error} onRetry={onRetry} />
      ) : rows.length === 0 ? (
        <EmptyState title={emptyTitle} sub={emptySub} action={emptyAction} icon={emptyIcon} />
      ) : (
        <Table {...tableProps} />
      )}
    </div>
  )
}

/* ───────────── pagination ───────────── */

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return null
  const start = (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)
  const nums: number[] = []
  const from = Math.max(1, page - 2)
  const to = Math.min(pages, from + 4)
  for (let i = from; i <= to; i++) nums.push(i)
  return (
    <div className="pagination">
      <div className="pg-info num">{num(start)}–{num(end)} / {num(total)} সারি</div>
      <div className="pg-btns">
        <button className="pg-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="আগের পৃষ্ঠা"><ChevronLeft size={15} /></button>
        {from > 1 ? <><button className="pg-btn" onClick={() => onPage(1)}>১</button><span className="muted-2">…</span></> : null}
        {nums.map((n) => (
          <button key={n} className={`pg-btn num ${n === page ? 'active' : ''}`} onClick={() => onPage(n)}>{n}</button>
        ))}
        {to < pages ? <><span className="muted-2">…</span><button className="pg-btn num" onClick={() => onPage(pages)}>{pages}</button></> : null}
        <button className="pg-btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="পরের পৃষ্ঠা"><ChevronRight size={15} /></button>
      </div>
    </div>
  )
}

/* ───────────── date-range segmented ───────────── */

export type RangeKind = 'today' | '7d' | '30d' | 'month' | '3m' | '6m' | '1y' | 'custom'

export function RangePicker({ value, onChange, extra }: {
  value: RangeKind
  onChange: (v: RangeKind, from?: number, to?: number) => void
  extra?: ReactNode
}) {
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const opts: Array<[RangeKind, string]> = [
    ['today', 'আজ'], ['7d', '৭ দিন'], ['30d', '৩০ দিন'], ['month', 'মাস'], ['3m', '৩ মাস'], ['6m', '৬ মাস'], ['1y', 'বছর'], ['custom', 'কাস্টম']
  ]
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <div className="segmented">
        {opts.map(([k, lbl]) => (
          <button
            key={k}
            className={value === k ? 'active' : ''}
            onClick={() => {
              if (k === 'custom') {
                if (customFrom && customTo) onChange('custom', new Date(customFrom + 'T00:00:00').getTime(), new Date(customTo + 'T23:59:59').getTime())
              } else {
                const r = presetRange(k)
                onChange(k, r.from, r.to)
              }
            }}
          >
            {lbl}
          </button>
        ))}
      </div>
      {value === 'custom' ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="date" className="input" style={{ width: 150 }} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          <span className="muted">থেকে</span>
          <input type="date" className="input" style={{ width: 150 }} value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          <button
            className="btn btn-secondary btn-sm"
            disabled={!customFrom || !customTo}
            onClick={() => onChange('custom', new Date(customFrom + 'T00:00:00').getTime(), new Date(customTo + 'T23:59:59').getTime())}
          >
            প্রয়োগ
          </button>
        </div>
      ) : null}
      {extra}
    </div>
  )
}

/* ───────────── misc ───────────── */

export function Badge({ tone = 'neutral', children, dot }: { tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary'; children: ReactNode; dot?: boolean }) {
  return <span className={`badge badge-${tone}`}>{dot ? <span className="dot" /> : null}{children}</span>
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>
}

/** Sticky first-visit hint bar — dismissible, restrained. */
export function HintBar({ children, onDismiss }: { children: ReactNode; onDismiss: () => void }) {
  return (
    <div className="alert alert-info" style={{ marginBottom: 16 }}>
      <div className="grow">{children}</div>
      <button className="btn btn-ghost btn-sm" onClick={onDismiss} style={{ height: 24 }}>বুঝেছি</button>
    </div>
  )
}

/** Hook: transient DOM measurement (window size classes for dense layouts). */
export function useWindowWidth(): number {
  const [w, setW] = useState(() => window.innerWidth)
  useLayoutEffect(() => {
    const on = () => setW(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return w
}
