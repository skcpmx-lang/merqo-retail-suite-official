import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react'

type ToastKind = 'success' | 'error' | 'warning' | 'info'

interface Toast { id: number; kind: ToastKind; message: string }

interface ToastCtx { toast: (message: string, kind?: ToastKind) => void }

const Ctx = createContext<ToastCtx | null>(null)

const ICONS: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 size={17} color="var(--success)" />,
  error: <XCircle size={17} color="var(--danger)" />,
  warning: <AlertTriangle size={17} color="var(--warning)" />,
  info: <Info size={17} color="var(--info)" />
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = nextId.current++
    setToasts((t) => [...t.slice(-4), { id, kind, message }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6500 : 3800)
  }, [])

  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id))

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((tt) => (
          <div key={tt.id} className={`toast ${tt.kind}`}>
            {ICONS[tt.kind]}
            <div className="grow">{tt.message}</div>
            <button onClick={() => dismiss(tt.id)} aria-label="বন্ধ" style={{ color: 'var(--text-4)', flex: 'none' }}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast outside provider')
  return ctx
}
