/**
 * Print template engine — layouts designed for paper, independent of the UI.
 * A4 / A5 / 80mm / 58mm. Bengali webfont is inlined from the app bundle by
 * referencing the same font stack the OS render pipeline resolves locally.
 */

export interface BizInfo {
  name: string
  owner_name?: string | null
  phone?: string | null
  address?: string | null
  email?: string | null
  logo_data?: string | null
}

export interface PrintOptions {
  paper: 'A4' | 'A5' | '80mm' | '58mm'
  landscape?: boolean
  printer?: string
  copies?: number
  savePdf?: boolean
  fileName?: string
}

interface Bridge {
  print: (req: Record<string, unknown>) => Promise<{ ok: boolean; pdfPath?: string; message?: string }>
}

function bridge(): Bridge | null {
  return (window as unknown as { merqo?: Bridge }).merqo ?? null
}

const PAGE_CSS: Record<string, string> = {
  A4: '@page{size:A4;margin:14mm 12mm}.doc{width:186mm}',
  A5: '@page{size:A5;margin:10mm}.doc{width:128mm}',
  '80mm': '@page{size:80mm auto;margin:3mm 2mm}.doc{width:74mm}',
  '58mm': '@page{size:58mm auto;margin:2mm 1.5mm}.doc{width:54mm}'
}

export function docShell(inner: string, paper: string, title: string): string {
  return `<!doctype html><html lang="bn"><head><meta charset="utf-8"><title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Hind Siliguri','Noto Sans Bengali','Nirmala UI','Vrinda','Inter',sans-serif; color:#101828; font-size: 13px; line-height:1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  ${PAGE_CSS[paper] ?? PAGE_CSS.A4}
  .doc { margin: 0 auto; }
  table { width:100%; border-collapse: collapse; }
  .num { font-variant-numeric: tabular-nums; }
  .r { text-align: right; }
  .c { text-align: center; }
  .muted { color:#667085; }
  hr { border:none; border-top:1px solid #d0d5dd; margin:8px 0; }
</style></head><body><div class="doc">${inner}</div></body></html>`
}

function bizHead(biz: BizInfo, paper: string): string {
  const compact = paper === '80mm' || paper === '58mm'
  const logo = biz.logo_data ? `<img src="${biz.logo_data}" style="height:${compact ? 34 : 46}px;margin-bottom:6px" alt="">` : ''
  if (compact) {
    return `<div class="c">${logo}<div style="font-size:16px;font-weight:700">${esc(biz.name)}</div>
      <div class="muted" style="font-size:11px">${esc(biz.address ?? '')}</div>
      <div class="muted" style="font-size:11px">${esc(biz.phone ?? '')}</div></div><hr>`
  }
  return `<table><tr>
    <td style="vertical-align:top">${logo}<div style="font-size:19px;font-weight:800">${esc(biz.name)}</div>
      <div class="muted" style="font-size:12px">${esc(biz.address ?? '')}</div></td>
    <td class="r muted" style="vertical-align:top;font-size:12px">
      ${biz.phone ? `<div>ফোন: ${esc(biz.phone)}</div>` : ''}
      ${biz.email ? `<div>${esc(biz.email)}</div>` : ''}
    </td></tr></table><hr>`
}

export function esc(s: string | null | undefined): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function moneyStr(poisha: number, decimals = true): string {
  const v = (poisha ?? 0) / 100
  return v.toLocaleString('en-IN', { minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: 2 })
}

/* ───────────── Invoice (A4/A5) & thermal receipt ───────────── */

export interface InvoiceData {
  invoice_no: string
  date: number
  customer_name?: string | null
  customer_phone?: string | null
  items: Array<{ name: string; sku?: string | null; unit?: string | null; qty: number; unit_price: number; discount: number; line_total: number }>
  subtotal: number
  item_discount: number
  invoice_discount: number
  tax: number
  total: number
  paid: number
  due: number
  payment_method: string
  note?: string | null
  user_name?: string | null
  footer?: string
}

const METHOD_BN: Record<string, string> = {
  cash: 'ক্যাশ', bank: 'ব্যাংক', card: 'কার্ড', cheque: 'চেক',
  bkash: 'বিকাশ', nagad: 'নগদ', rocket: 'রকেট', upay: 'Upay', other: 'অন্যান্য', due_adjust: 'বকেয়া সমন্বয়'
}

export function methodBn(m: string): string {
  return METHOD_BN[m] ?? m
}

export function invoiceHtml(biz: BizInfo, sale: InvoiceData, paper: 'A4' | 'A5' | '80mm' | '58mm'): string {
  const compact = paper === '80mm' || paper === '58mm'
  const d = new Date(sale.date)
  const dateStr = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
  const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const footer = sale.footer || 'কেনার জন্য ধন্যবাদ!'

  if (compact) {
    return docShell(`
      ${bizHead(biz, paper)}
      <div class="c" style="font-weight:700;font-size:13px">চালান / রসিদ</div>
      <div class="c muted" style="font-size:11px">#${esc(sale.invoice_no)} · ${dateStr} ${timeStr}</div>
      ${sale.customer_name ? `<div style="font-size:11.5px;margin-top:3px">গ্রাহক: ${esc(sale.customer_name)}${sale.customer_phone ? ` · ${esc(sale.customer_phone)}` : ''}</div>` : ''}
      <hr>
      <table style="font-size:11px">
        ${sale.items.map((i) => `
          <tr><td style="padding:2px 0">${esc(i.name)}<br>
            <span class="muted">${i.qty}${i.unit ? ' ' + esc(i.unit) : ''} × ${moneyStr(i.unit_price)}${i.discount ? ` − ${moneyStr(i.discount)}` : ''}</span></td>
            <td class="r num" style="vertical-align:top">${moneyStr(i.line_total)}</td></tr>`).join('')}
      </table><hr>
      <table style="font-size:11.5px">
        ${sale.item_discount ? `<tr><td>ডিসকাউন্ট</td><td class="r num">− ${moneyStr(sale.item_discount + sale.invoice_discount)}</td></tr>` : ''}
        ${sale.tax ? `<tr><td>ভ্যাট</td><td class="r num">${moneyStr(sale.tax)}</td></tr>` : ''}
        <tr style="font-weight:700"><td>মোট</td><td class="r num">৳ ${moneyStr(sale.total)}</td></tr>
        <tr><td>পরিশোধ (${methodBn(sale.payment_method)})</td><td class="r num">${moneyStr(sale.paid)}</td></tr>
        ${sale.due ? `<tr style="font-weight:700"><td>বকেয়া</td><td class="r num">৳ ${moneyStr(sale.due)}</td></tr>` : ''}
      </table><hr>
      <div class="c muted" style="font-size:10.5px">${esc(footer)}</div>
      <div class="c muted" style="font-size:10px;margin-top:2px">বিক্রয়কর্মী: ${esc(sale.user_name ?? '—')} · MERQO</div>
    `, paper, `চালান ${sale.invoice_no}`)
  }

  // A4 / A5 full invoice
  return docShell(`
    ${bizHead(biz, paper)}
    <table style="margin-top:6px">
      <tr>
        <td style="vertical-align:top">
          <div style="font-size:17px;font-weight:800;color:var(--primary)">চালান</div>
          <div class="muted" style="font-size:12px">চালান নং: <b class="num">#${esc(sale.invoice_no)}</b></div>
          <div class="muted" style="font-size:12px">তারিখ: ${dateStr} · ${timeStr}</div>
        </td>
        <td class="r" style="vertical-align:top">
          <div style="font-size:12px;font-weight:700" class="muted">গ্রাহক</div>
          <div style="font-weight:600">${esc(sale.customer_name ?? 'নগদ গ্রাহক')}</div>
          ${sale.customer_phone ? `<div class="muted" style="font-size:12px">${esc(sale.customer_phone)}</div>` : ''}
        </td>
      </tr>
    </table>
    <table style="margin-top:12px">
      <thead><tr style="background:#f4f6f9;font-size:12px">
        <th style="text-align:left;padding:7px 8px;border-bottom:1px solid #d0d5dd">পণ্য</th>
        <th class="r" style="padding:7px 8px;border-bottom:1px solid #d0d5dd">পরিমাণ</th>
        <th class="r" style="padding:7px 8px;border-bottom:1px solid #d0d5dd">দাম</th>
        ${sale.items.some((i) => i.discount) ? '<th class="r" style="padding:7px 8px;border-bottom:1px solid #d0d5dd">ছাড়</th>' : ''}
        <th class="r" style="padding:7px 8px;border-bottom:1px solid #d0d5dd">টাকা</th>
      </tr></thead>
      <tbody>
        ${sale.items.map((i) => `
          <tr>
            <td style="padding:6px 8px;border-bottom:1px solid #e8ebef">${esc(i.name)}${i.sku ? ` <span class="muted" style="font-size:11px">(${esc(i.sku)})</span>` : ''}</td>
            <td class="r num" style="padding:6px 8px;border-bottom:1px solid #e8ebef">${i.qty}${i.unit ? ' ' + esc(i.unit) : ''}</td>
            <td class="r num" style="padding:6px 8px;border-bottom:1px solid #e8ebef">${moneyStr(i.unit_price)}</td>
            ${sale.items.some((x) => x.discount) ? `<td class="r num" style="padding:6px 8px;border-bottom:1px solid #e8ebef">${i.discount ? moneyStr(i.discount) : '—'}</td>` : ''}
            <td class="r num" style="padding:6px 8px;border-bottom:1px solid #e8ebef;font-weight:600">${moneyStr(i.line_total)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <table style="margin-top:8px" class="num">
      <tr><td class="r muted" style="padding:2px 8px;font-size:12px">উপমোট</td><td class="r num" style="width:110px">${moneyStr(sale.subtotal)}</td></tr>
      ${sale.item_discount || sale.invoice_discount ? `<tr><td class="r muted" style="padding:2px 8px;font-size:12px">ডিসকাউন্ট</td><td class="r num">− ${moneyStr(sale.item_discount + sale.invoice_discount)}</td></tr>` : ''}
      ${sale.tax ? `<tr><td class="r muted" style="padding:2px 8px;font-size:12px">ভ্যাট</td><td class="r num">${moneyStr(sale.tax)}</td></tr>` : ''}
      <tr><td class="r" style="padding:5px 8px;font-weight:800;font-size:14px;border-top:1px solid #d0d5dd">সর্বমোট</td>
          <td class="r" style="font-weight:800;font-size:14px;border-top:1px solid #d0d5dd">৳ ${moneyStr(sale.total)}</td></tr>
      <tr><td class="r muted" style="padding:2px 8px;font-size:12px">পরিশোধ (${methodBn(sale.payment_method)})</td><td class="r num">${moneyStr(sale.paid)}</td></tr>
      <tr><td class="r" style="padding:2px 8px;font-weight:700;font-size:12.5px;${sale.due ? 'color:#b42318' : ''}">বকেয়া</td>
          <td class="r num" style="font-weight:700;${sale.due ? 'color:#b42318' : ''}">${moneyStr(sale.due)}</td></tr>
    </table>
    ${sale.note ? `<div class="muted" style="margin-top:10px;font-size:12px">নোট: ${esc(sale.note)}</div>` : ''}
    <div style="margin-top:18px;display:flex;justify-content:space-between;align-items:flex-end">
      <div class="muted" style="font-size:11.5px">বিক্রয়কর্মী: ${esc(sale.user_name ?? '—')}</div>
      <div class="c" style="font-weight:600">${esc(footer)}</div>
    </div>
  `, paper, `চালান ${sale.invoice_no}`)
}

/* ───────────── Due-collection receipt (thermal) ───────────── */

export function dueReceiptHtml(biz: BizInfo, r: {
  voucher_no: string; customer_name: string; amount: number
  before?: number; after?: number
  method: string; date: number; note?: string | null; user_name?: string | null
}): string {
  const d = new Date(r.date)
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return docShell(`
    ${bizHead(biz, '80mm')}
    <div class="c" style="font-weight:700;font-size:13px">বকেয়া আদায়ের রসিদ</div>
    <div class="c muted" style="font-size:11px">#${esc(r.voucher_no)} · ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${time}</div>
    <hr>
    <div style="font-size:12px">গ্রাহক: <b>${esc(r.customer_name)}</b></div>
    <div style="font-size:12px;margin-top:4px">আদায় (${methodBn(r.method)}): <b class="num" style="font-size:15px">৳ ${moneyStr(r.amount)}</b></div>
    ${r.before != null ? `<div style="font-size:11px;margin-top:2px">পূর্বের বকেয়া: <span class="num">৳ ${moneyStr(r.before)}</span></div>` : ''}
    ${r.after != null ? `<div style="font-size:11.5px">অবশিষ্ট বকেয়া: <b class="num">৳ ${moneyStr(r.after)}</b></div>` : ''}
    ${r.note ? `<div class="muted" style="font-size:10.5px;margin-top:2px">${esc(r.note)}</div>` : ''}
    <hr>
    <div class="c muted" style="font-size:10.5px">ধন্যবাদ! · MERQO</div>
    ${r.user_name ? `<div class="c muted" style="font-size:10px">গ্রহণ করেন: ${esc(r.user_name)}</div>` : ''}
  `, '80mm', `রসিদ ${r.voucher_no}`)
}

/* ───────────── Purchase document (A4) ───────────── */

export function purchaseHtml(biz: BizInfo, p: {
  ref_no?: string | null; date: number; supplier_name: string; supplier_phone?: string | null
  items: Array<{ name: string; qty: number; unit_cost: number; line_total: number }>
  subtotal?: number; discount?: number; other_cost?: number; invoice_discount?: number
  total: number; paid: number; due: number; note?: string | null
  user_name?: string | null
}): string {
  const subtotal = p.subtotal ?? p.items.reduce((a, i) => a + i.line_total, 0)
  const discount = p.discount ?? p.invoice_discount ?? 0
  const other_cost = p.other_cost ?? 0
  const d = new Date(p.date)
  return docShell(`
    ${bizHead(biz, 'A4')}
    <table style="margin-top:6px">
      <tr><td>
        <div style="font-size:17px;font-weight:800">ক্রয় পত্র</div>
        <div class="muted" style="font-size:12px">রেফারেন্স: <b class="num">${esc(p.ref_no ?? '—')}</b> · তারিখ: ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}${p.supplier_phone ? ` · ${esc(p.supplier_phone)}` : ''}</div>
      </td><td class="r">
        <div style="font-size:12px;font-weight:700" class="muted">সরবরাহকারী</div>
        <div style="font-weight:600">${esc(p.supplier_name)}</div>
      </td></tr>
    </table>
    <table style="margin-top:12px">
      <thead><tr style="background:#f4f6f9;font-size:12px">
        <th class="c" style="padding:7px;border-bottom:1px solid #d0d5dd;width:34px">#</th>
        <th style="text-align:left;padding:7px;border-bottom:1px solid #d0d5dd">পণ্য</th>
        <th class="r" style="padding:7px;border-bottom:1px solid #d0d5dd">পরিমাণ</th>
        <th class="r" style="padding:7px;border-bottom:1px solid #d0d5dd">দর</th>
        <th class="r" style="padding:7px;border-bottom:1px solid #d0d5dd">টাকা</th>
      </tr></thead>
      <tbody>${p.items.map((i, ix) => `
        <tr><td class="c num" style="padding:6px 7px;border-bottom:1px solid #e8ebef">${ix + 1}</td>
          <td style="padding:6px 7px;border-bottom:1px solid #e8ebef">${esc(i.name)}</td>
          <td class="r num" style="padding:6px 7px;border-bottom:1px solid #e8ebef">${i.qty}</td>
          <td class="r num" style="padding:6px 7px;border-bottom:1px solid #e8ebef">${moneyStr(i.unit_cost)}</td>
          <td class="r num" style="padding:6px 7px;border-bottom:1px solid #e8ebef;font-weight:600">${moneyStr(i.line_total)}</td></tr>`).join('')}
      </tbody></table>
    <table style="margin-top:8px" class="num">
      <tr><td class="r muted" style="padding:2px 8px;font-size:12px">উপমোট</td><td class="r num" style="width:110px">${moneyStr(subtotal)}</td></tr>
      ${discount ? `<tr><td class="r muted" style="padding:2px 8px;font-size:12px">ডিসকাউন্ট</td><td class="r num">− ${moneyStr(discount)}</td></tr>` : ''}
      ${other_cost ? `<tr><td class="r muted" style="padding:2px 8px;font-size:12px">অন্যান্য খরচ</td><td class="r num">${moneyStr(other_cost)}</td></tr>` : ''}
      <tr><td class="r" style="padding:5px 8px;font-weight:800;font-size:14px;border-top:1px solid #d0d5dd">সর্বমোট</td><td class="r" style="font-weight:800;font-size:14px;border-top:1px solid #d0d5dd">৳ ${moneyStr(p.total)}</td></tr>
      <tr><td class="r muted" style="padding:2px 8px;font-size:12px">পরিশোধিত</td><td class="r num">${moneyStr(p.paid)}</td></tr>
      <tr><td class="r" style="padding:2px 8px;font-weight:700;font-size:12.5px;${p.due ? 'color:#b42318' : ''}">বাকি</td><td class="r num" style="font-weight:700;${p.due ? 'color:#b42318' : ''}">${moneyStr(p.due)}</td></tr>
    </table>
    ${p.note ? `<div style="margin-top:8px;font-size:12px"><span class="muted">নোট:</span> ${esc(p.note)}</div>` : ''}
    <div style="margin-top:16px" class="muted" style="font-size:11.5px">এন্ট্রি: ${esc(p.user_name ?? '—')} · MERQO</div>
  `, 'A4', `ক্রয় ${p.ref_no ?? ''}`)
}

/* ───────────── Statement (A4) ───────────── */

export function statementHtml(biz: BizInfo, s: {
  title?: string
  party_name: string
  party_phone?: string | null
  date: number
  opening_due: number
  rows: Array<{ date: number; ref?: string; description?: string; label?: string; debit: number; credit: number; balance: number }>
  closing_due: number
}): string {
  const d = new Date()
  const rows = s.rows.map((r) => ({ ...r, label: r.description ?? r.label ?? '' }))
  return docShell(`
    ${bizHead(biz, 'A4')}
    <div style="margin-top:6px">
      <div style="font-size:17px;font-weight:800">${esc(s.title ?? 'বকেয়া স্টেটমেন্ট')}</div>
      <div class="muted" style="font-size:12px">${esc(s.party_name)}${s.party_phone ? ` · ${esc(s.party_phone)}` : ''} · প্রিন্ট: ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}</div>
    </div>
    <table style="margin-top:10px;font-size:12px" class="num">
      <thead><tr style="background:#f4f6f9">
        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #d0d5dd">তারিখ</th>
        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #d0d5dd">বিবরণ</th>
        <th class="r" style="padding:6px 8px;border-bottom:1px solid #d0d5dd">বাকি (+)</th>
        <th class="r" style="padding:6px 8px;border-bottom:1px solid #d0d5dd">পরিশোধ (−)</th>
        <th class="r" style="padding:6px 8px;border-bottom:1px solid #d0d5dd">জমা</th>
      </tr></thead>
      <tbody>
        <tr><td style="padding:5px 8px;border-bottom:1px solid #eef0f3">—</td>
          <td style="padding:5px 8px;border-bottom:1px solid #eef0f3">পুরনো বকেয়া</td>
          <td class="r" style="padding:5px 8px;border-bottom:1px solid #eef0f3">${s.opening_due > 0 ? moneyStr(s.opening_due) : '—'}</td>
          <td style="padding:5px 8px;border-bottom:1px solid #eef0f3"></td>
          <td class="r" style="padding:5px 8px;border-bottom:1px solid #eef0f3">${moneyStr(s.opening_due)}</td></tr>
        ${rows.map((r) => `
          <tr><td style="padding:5px 8px;border-bottom:1px solid #eef0f3">${new Date(r.date).getDate()}/${new Date(r.date).getMonth() + 1}/${new Date(r.date).getFullYear()}</td>
            <td style="padding:5px 8px;border-bottom:1px solid #eef0f3">${esc(r.label)}${r.ref ? ` <span class="muted" style="font-size:11px">${esc(r.ref)}</span>` : ''}</td>
            <td class="r" style="padding:5px 8px;border-bottom:1px solid #eef0f3">${r.debit ? moneyStr(r.debit) : ''}</td>
            <td class="r" style="padding:5px 8px;border-bottom:1px solid #eef0f3">${r.credit ? moneyStr(r.credit) : ''}</td>
            <td class="r" style="padding:5px 8px;border-bottom:1px solid #eef0f3"><b>${moneyStr(r.balance)}</b></td>
          </tr>`).join('')}
      </tbody>
      <tfoot><tr style="background:#f4f6f9;font-weight:700">
        <td style="padding:7px 8px" colspan="4">সর্বশেষ বকেয়া</td>
        <td class="r" style="padding:7px 8px">${moneyStr(s.closing_due)}</td>
      </tr></tfoot>
    </table>
    <div class="muted" style="margin-top:14px;font-size:11px">MERQO Retail Suite · কোনো ভুল মনে হলে দোকানে জানান</div>
  `, 'A4', `স্টেটমেন্ট ${s.party_name}`)
}

export function reportHtml(biz: BizInfo, opts: {
  title: string
  date?: number
  user_name?: string
  rangeLabel?: string
  columns: string[]
  rows: string[][]
}): string {
  const when = opts.date ? new Date(opts.date) : new Date()
  const subtitle = [opts.rangeLabel, when.toLocaleDateString('en-GB'), opts.user_name ? `তৈরি করেন: ${opts.user_name}` : ''].filter(Boolean).join(' · ')
  const isNumCol = (h: string) => /৳|টাকা|মোট|দর|পরিমাণ|স্টক|বকেয়া|পাওনা|ব্যালেন্স|লাভ|আয়|জমা|ভেতরে|বাইরে|প্রবাহ|কমিশন|চার্জ|ক্যাশ|COGS|বিল|সংখ্যা|মূল্য|খরচ|ক্রয়|কেনা|অবশিষ্ট|গড়/.test(h)
  return docShell(`
    ${bizHead(biz, 'A4')}
    <div style="margin-top:4px">
      <div style="font-size:16px;font-weight:800">${esc(opts.title)}</div>
      <div class="muted" style="font-size:12px">${esc(subtitle)}</div>
    </div>
    <table style="margin-top:10px;font-size:12px">
      <thead><tr style="background:#f4f6f9">${opts.columns.map((h, i) => `<th class="${i > 0 && isNumCol(h) ? 'r' : ''}" style="padding:6px 8px;border-bottom:1px solid #d0d5dd">${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${opts.rows.length === 0 ? `<tr><td colspan="${opts.columns.length}" class="c muted" style="padding:20px">কোনো তথ্য নেই</td></tr>` : opts.rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i > 0 && /^-?\$?[0-9]/.test(c) ? 'r num' : ''}" style="padding:5px 8px;border-bottom:1px solid #eef0f3">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
    <div class="muted" style="margin-top:14px;font-size:11px">প্রিন্ট: ${when.toLocaleString('en-GB')} · MERQO Retail Suite</div>
  `, 'A4', opts.title)
}

/* ───────────── product label (barcode) ───────────── */

export function labelHtml(biz: BizInfo, labels: Array<{ name: string; price: number; barcodeSvg: string; sku?: string | null }>, cols: number, labelWmm: number, labelHmm: number): string {
  const cells = labels.map((l) => `
    <div class="lbl">
      <div class="lbl-name">${esc(biz.name)}</div>
      <div class="lbl-product">${esc(l.name)}</div>
      ${l.barcodeSvg}
      ${l.sku ? `<div class="lbl-sku">${esc(l.sku)}</div>` : ''}
      <div class="lbl-price">৳ ${moneyStr(l.price)}</div>
    </div>`).join('')
  return `<!doctype html><html lang="bn"><head><meta charset="utf-8"><title>লেবেল</title><style>
    @page { size: ${labelWmm * cols}mm auto; margin: 2mm; }
    body { font-family:'Hind Siliguri',sans-serif; margin:0; }
    .grid { display:grid; grid-template-columns:repeat(${cols}, ${labelWmm}mm); }
    .lbl { width:${labelWmm}mm; height:${labelHmm}mm; padding:1mm 1.5mm; border:0.2mm dashed #bbb; overflow:hidden; text-align:center; }
    .lbl-name { font-size:7px; color:#667; font-weight:700; letter-spacing:.4px; }
    .lbl-product { font-size:8.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .lbl svg { width:90%; height:9mm; }
    .lbl-sku { font-size:6.5px; color:#667; }
    .lbl-price { font-size:10px; font-weight:800; }
  </style></head><body><div class="grid">${cells}</div></body></html>`
}

/* ───────────── execution ───────────── */

export async function printDoc(html: string, opts: PrintOptions): Promise<{ ok: boolean; message?: string }> {
  const b = bridge()
  if (b) {
    const res = await b.print({ html, paper: opts.paper, landscape: opts.landscape, printer: opts.printer, copies: opts.copies, savePdf: opts.savePdf, fileName: opts.fileName })
    return res
  }
  // browser dev fallback
  const w = window.open('', '_blank')
  if (w) {
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 300)
  }
  return { ok: true }
}

export async function savePdf(html: string, fileName: string, paper: 'A4' | 'A5' = 'A4'): Promise<{ ok: boolean; message?: string }> {
  const b = bridge()
  if (b) return b.print({ html, paper, savePdf: true, fileName })
  return printDoc(html, { paper, savePdf: false })
}
