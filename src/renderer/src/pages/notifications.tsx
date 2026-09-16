import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCheck, Trash2, AlertTriangle, Info, PackageX } from 'lucide-react'
import { api } from '@/api/client'
import { useToast } from '@/state/toast'
import { t, fdatetime } from '@/i18n/bn'
import { PageHeader, DataTable, Badge, ConfirmDialog, type Column } from '@/ui/components'

interface NotifRow {
  id: string
  type: string
  severity: string
  title: string
  body: string | null
  ref_type: string | null
  ref_id: string | null
  is_read: number
  created_at: number
}

export function Notifications() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [clearOne, setClearOne] = useState<NotifRow | null>(null)

  const { data, isLoading, refetch, error } = useQuery({
    queryKey: ['notifications', unreadOnly],
    queryFn: () => api.get<{ rows: NotifRow[]; total: number; unread: number }>('/notifications', { unread: unreadOnly ? '1' : undefined, pageSize: 100 })
  })

  const markRead = async (r: NotifRow) => {
    try {
      await api.post(`/notifications/${r.id}/read`, {})
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    } catch (e) { toast((e as Error).message, 'error') }
  }
  const markAll = async () => {
    try {
      await api.post('/notifications/read-all', {})
      void qc.invalidateQueries({ queryKey: ['notifications'] })
      toast('সব পড়া হিসেবে চিহ্নিত হয়েছে', 'success')
    } catch (e) { toast((e as Error).message, 'error') }
  }

  const icon = (r: NotifRow) => r.severity === 'critical' ? <PackageX size={15} /> : r.severity === 'warning' ? <AlertTriangle size={15} /> : <Info size={15} />

  const columns: Column<NotifRow>[] = [
    {
      key: 'title', header: 'বিজ্ঞপ্তি',
      render: (r) => (
        <div className="flex items-center gap-2" style={{ opacity: r.is_read ? 0.55 : 1 }}>
          <span style={{ color: r.severity === 'critical' ? 'var(--danger-text)' : r.severity === 'warning' ? 'var(--warning-text)' : 'var(--primary)' }}>{icon(r)}</span>
          <div>
            <div className={r.is_read ? '' : 'td-strong'}>{r.title}</div>
            {r.body ? <div className="td-sub">{r.body}</div> : null}
          </div>
        </div>
      )
    },
    { key: 'created_at', header: t('date'), width: 160, render: (r) => <span className="muted small">{fdatetime(r.created_at)}</span> },
    {
      key: 'is_read', header: t('status'), width: 100,
      render: (r) => r.is_read ? <Badge tone="neutral">পড়া</Badge> : <Badge tone="primary">নতুন</Badge>
    },
    {
      key: 'act', header: '', width: 100,
      render: (r) => (
        <div className="flex gap-1" style={{ justifyContent: 'flex-end' }}>
          {!r.is_read ? <button className="btn btn-ghost btn-sm" onClick={() => void markRead(r)}>পড়া হলো</button> : null}
          <button className="btn btn-ghost btn-sm btn-icon" title="মুছুন" onClick={() => setClearOne(r)}><Trash2 size={14} /></button>
        </div>
      )
    }
  ]

  return (
    <div className="page">
      <PageHeader
        title={t('notifications_title')}
        sub={t('notifications_sub')}
        actions={
          <>
            {data && data.unread > 0 ? <button className="btn btn-secondary" onClick={() => void markAll()}><CheckCheck size={15} /> সব পড়া হলো</button> : null}
            <button className={`chip ${unreadOnly ? 'active' : ''}`} onClick={() => setUnreadOnly(!unreadOnly)}>শুধু নতুন</button>
          </>
        }
      />

      <DataTable
        columns={columns}
        rows={data?.rows ?? []}
        rowKey={(r) => r.id}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={() => void refetch()}
        emptyTitle="কোনো বিজ্ঞপ্তি নেই"
        emptySub="স্টক শেষ, বড় বকেয়া, মেয়াদ — সব সতর্কতা এখানে দেখা যাবে"
        maxHeight="calc(100vh - 280px)"
      />

      <ConfirmDialog
        open={!!clearOne}
        onClose={() => setClearOne(null)}
        title="বিজ্ঞপ্তি মুছুন"
        body={clearOne?.title}
        confirmLabel={t('delete_confirm')}
        danger
        onConfirm={async () => {
          try {
            await api.del(`/notifications/${clearOne!.id}`)
            void qc.invalidateQueries({ queryKey: ['notifications'] })
            setClearOne(null)
          } catch (e) { toast((e as Error).message, 'error') }
        }}
      />
    </div>
  )
}
