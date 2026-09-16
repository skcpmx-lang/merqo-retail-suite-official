import express from 'express'
import type { DB } from './db/connection'
import { buildRoutes, setDbRef } from './api/routes'
import { authMiddleware, errorHandler } from './api/http'
import { sha256 } from './auth'

export const DEFAULT_PORT = 47612

export interface CoreOptions {
  db: DB
  port: number
  host: string // 127.0.0.1 (single-PC) or 0.0.0.0 (server mode)
  backupDir: string
  log?: (msg: string) => void
}

export interface CoreHandle {
  close: () => void
  port: number
  host: string
  /** read-only owner-monitor bearer key (set/rotate from settings) */
  setMonitorKey: (rawKey: string | null) => void
  /** restore persisted hash on startup */
  setMonitorKeyHash: (hash: string | null) => void
  monitorKey: () => string | null
}

/**
 * MERQO core — the embedded business server.
 *
 * Everything (auth, RBAC, validation, transactions) lives here. The Electron
 * renderer, LAN clients and the phone monitor page are all clients of this
 * API; none of them can bypass business rules.
 */
export function startCore(opts: CoreOptions): CoreHandle {
  setDbRef(opts.db)
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '25mb' }))

  let monitorKey: string | null = null

  // Owner monitor: token-gated, strictly read-only JSON.
  app.get('/api/monitor/data', (_req, res) => {
    if (!monitorKey) { res.status(404).json({ error: 'DISABLED' }); return }
    const auth = _req.headers['authorization']
    if (auth !== `Bearer ${monitorKey}`) { res.status(401).json({ error: 'UNAUTHORIZED' }); return }
    const bid = String(_req.query.business ?? '')
    const bizRow = opts.db.prepare(`SELECT id, name FROM businesses WHERE id=? AND status='active'`).get(bid) as { id: string; name: string } | undefined
    if (!bizRow) { res.status(400).json({ error: 'BUSINESS' }); return }
    res.json(monitorData(opts.db, bizRow.id, bizRow.name))
  })

  // Owner monitor page (phone) — self-hosted, token via ?key=
  app.get('/monitor', (_req, res) => {
    res.type('html').send(monitorPageHtml())
  })

  app.use('/api', authMiddleware(opts.db))
  app.use('/api', buildRoutes(opts.db, {
    initialized: () => ((opts.db.prepare(`SELECT COUNT(*) c FROM users`).get() as { c: number }).c > 0),
    monitorToken: () => monitorKey,
    setMonitorToken: (t) => { monitorKey = t }
  }, opts.backupDir))

  app.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'রিসোর্সটি পাওয়া যায়নি।' }))
  app.use(errorHandler(opts.log))

  const server = app.listen(opts.port, opts.host, () => {
    opts.log?.(`[core] listening on ${opts.host}:${opts.port}`)
  })
  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      opts.log?.(`[core] port ${opts.port} busy — trying an ephemeral port`)
      server.listen(0, opts.host)
    } else {
      opts.log?.(`[core] server error: ${e.message}`)
    }
  })

  const actualPort = (): number => (server.address() as { port: number } | null)?.port ?? opts.port

  return {
    close: () => server.close(),
    get port() { return actualPort() },
    host: opts.host,
    setMonitorKey: (k) => { monitorKey = k ? sha256(k) : null },
    setMonitorKeyHash: (hash) => { monitorKey = hash ?? null },
    monitorKey: () => monitorKey
  }
}

function monitorPageHtml(): string {
  return `<!doctype html><html lang="bn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MERQO — মনিটর</title><style>
*{box-sizing:border-box}body{font-family:'Hind Siliguri','Noto Sans Bengali',system-ui,sans-serif;margin:0;background:#f4f5f7;color:#111827}
header{background:#0e1526;color:#fff;padding:14px 18px;font-weight:700;font-size:16px}header span{opacity:.65;font-weight:400;font-size:12px;display:block}
main{max-width:760px;margin:0 auto;padding:14px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px}
.card h3{margin:0 0 6px;font-size:12px;color:#6b7280;font-weight:600}
.card .v{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}
.alert{border-left:3px solid #d92d20;padding:8px 12px;background:#fef3f2;border-radius:8px;margin:6px 0;font-size:13px}
.alert.w{border-color:#dc6803;background:#fffaeb}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;margin-top:10px}
td,th{padding:9px 12px;border-bottom:1px solid #f0f1f3;font-size:13px;text-align:left}th{background:#f9fafb;color:#6b7280;font-size:11px;text-transform:none}
.err{padding:40px 20px;text-align:center;color:#6b7280}
.refresh{font-size:11px;color:#9ca3af;text-align:center;margin-top:12px}
</style></head><body>
<header>MERQO <span>লাইভ মনিটর · শুধু দেখার জন্য</span></header><main id="app"><div class="err">সংযোগ করা হচ্ছে…</div></main>
<script>
const key=new URLSearchParams(location.search).get('key');
const bid=new URLSearchParams(location.search).get('b');
const taka=p=>p==null?'—':'৳'+(p/100).toLocaleString('en-IN');
async function load(){
 try{
  const r=await fetch('/api/monitor/data?business='+encodeURIComponent(bid),{headers:{Authorization:'Bearer '+key}});
  if(!r.ok){document.getElementById('app').innerHTML='<div class="err">'+(r.status===401?'কী সঠিক নয় — সেটিংস থেকে নতুন কী নিন।':'ডেটা পাওয়া যায়নি।')+'</div>';return}
  const d=await r.json();
  const c=(t,v)=>'<div class="card"><h3>'+t+'</h3><div class="v">'+v+'</div></div>';
  document.getElementById('app').innerHTML=
   '<div class="grid">'+c('আজকের বিক্রয়',taka(d.today.sales))+c('আজকের গ্রস লাভ',taka(d.today.gross_profit))+
   c('আজকের খরচ',taka(d.today.expenses))+c('নিট লাভ (আজ)',taka(d.today.net_profit))+
   c('ক্যাশ',taka(d.position.cash))+c('ব্যাংক/কার্ড',taka(d.position.bank))+
   c('এমএফএস',taka(d.position.mfs))+c('মোট বকেয়া (গ্রাহক)',taka(d.dues.receivable))+
   c('সরবরাহকারী বাকি',taka(d.dues.payable))+c('স্টক মূল্য',taka(d.stock.at_cost))+'</div>'+
   d.alerts.map(a=>'<div class="alert'+(a.severity==='critical'?'':' w')+'">'+a.title+(a.body?' — '+a.body:'')+'</div>').join('')+
   '<table><tr><th>সময়</th><th>চালান</th><th>গ্রাহক</th><th style="text-align:right">টাকা</th></tr>'+
   d.recent_sales.map(s=>'<tr><td>'+new Date(s.date).toLocaleTimeString('bn-BD',{hour:'2-digit',minute:'2-digit'})+'</td><td>'+s.invoice_no+'</td><td>'+(s.customer_name||'নগদ')+'</td><td style="text-align:right">'+taka(s.total)+'</td></tr>').join('')+'</table>'+
   '<div class="refresh">স্বয়ংক্রিয় রিফ্রেশ · প্রতি ৩০ সেকেন্ডে · '+new Date().toLocaleTimeString('bn-BD')+'</div>';
 }catch(e){document.getElementById('app').innerHTML='<div class="err">সার্ভারে পৌঁছানো যাচ্ছে না — একই নেটওয়ার্কে আছেন কি?</div>'}
}
load();setInterval(load,30000);
</script></body></html>`
}

/* Strictly read-only monitor payload (no mutations, no PII beyond names). */
function monitorData(db: DB, businessId: string, businessName: string) {
  const { dashboard } = require('./services/dashboard') as typeof import('./services/dashboard')
  const d = dashboard(db, businessId)
  return {
    business: { id: businessId, name: businessName },
    generated_at: Date.now(),
    today: d.today,
    month: d.month,
    dues: d.dues,
    position: d.position,
    stock: d.stock,
    alerts: d.alerts,
    recent_sales: d.recent.sales
  }
}
