import { useEffect, useState } from 'react'
import { Mail, MonitorSmartphone, ShieldCheck, Wifi, Database } from 'lucide-react'

export function About() {
  const [info, setInfo] = useState<{ version: string; electron: boolean; platform: string; mode: string; dbFile: string } | null>(null)

  useEffect(() => { document.title = 'সম্পর্কে — MERQO Retail Suite' }, [])
  useEffect(() => {
    const bridge = (window as unknown as { merqo?: { serverInfo: () => Promise<Record<string, unknown>> } }).merqo
    bridge?.serverInfo().then((s) => setInfo(s as never)).catch(() => setInfo(null))
  }, [])

  return (
    <div className="page" style={{ maxWidth: 680 }}>
      <div className="card card-pad" style={{ textAlign: 'center', padding: '36px 24px' }}>
        <div className="brand-mark" style={{ width: 64, height: 64, fontSize: 30, borderRadius: 18, margin: '0 auto 14px' }}>
          M<span className="brand-dot" style={{ color: '#dbe7ff' }}>.</span>
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>MERQO<span style={{ color: 'var(--primary)' }}>.</span> Retail Suite</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          ছোট ও মাঝারি খুচরা ব্যবসার জন্য পূর্ণাঙ্গ পয়েন্ট-অব-সেল ও ব্যবসা ব্যবস্থাপনা
        </p>
        <div className="badge" style={{ marginTop: 10 }}>ভার্সন {info?.version ?? '1.0.0'}</div>
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 12 }}>বৈশিষ্ট্য</h3>
        <ul className="feature-list">
          <li><MonitorSmartphone size={15} /> POS, বিক্রয়, ফেরত, ক্রয়, স্টক (WAC), বকেয়া, খরচ, MFS এজেন্ট</li>
          <li><ShieldCheck size={15} /> ইউজার ও গ্রানুলার অনুমতি, পিন লক, পূর্ণ অডিট লগ</li>
          <li><Wifi size={15} /> LAN সার্ভার মোড — এক পিসি সার্ভার, বাকিগুলো ক্লায়েন্ট</li>
          <li><Database size={15} /> সম্পূর্ণ অফলাইন; ডেটা নিজের পিসিতে; যাচাইকৃত ব্যাকআপ/রিস্টোর</li>
        </ul>
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 12 }}>যোগাযোগ ও সাপোর্ট</h3>
        <div className="sum-row"><span>ইমেইল</span><a className="strong" href="mailto:merqoonline@gmail.com" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Mail size={14} /> merqoonline@gmail.com</a></div>
        <div className="sum-row"><span>ব্র্যান্ড</span><b>MERQO.</b></div>
        {info ? (
          <>
            <div className="sum-row"><span>চালানোর ধরন</span><b>{info.mode === 'client' ? 'ক্লায়েন্ট (LAN সার্ভার)' : info.electron ? 'ডেস্কটপ (Windows)' : 'ব্রাউজার'}</b></div>
            <div className="sum-row"><span>প্ল্যাটফর্ম</span><b className="num">{info.platform}</b></div>
          </>
        ) : null}
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 10 }}>স্বীকৃতি (ওপেন সোর্স)</h3>
        <p className="small muted" style={{ lineHeight: 1.9 }}>
          এই সফটওয়্যার নিম্নলিখিত ওপেন সোর্স লাইব্রেরি ব্যবহার করে: Electron, React, React Router, TanStack Query,
          Recharts, Express, better-sqlite3, papaparse, lucide-react, Inter ও Hind Siliguri ফন্ট (SIL Open Font License) —
          সবগুলোর লাইসেন্স (MIT/ISC/OFL) অ্যাপ ইনস্টল ফোল্ডারের LICENSES ফাইলে রয়েছে।
        </p>
      </div>
    </div>
  )
}
