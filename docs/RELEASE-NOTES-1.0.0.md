# MERQO Retail Suite 1.0.0 — Release Notes
**তারিখ / Date: September 2026 · Commit: `0d3bccb2` (RC) · Installer: `MERQO-Retail-Suite-Setup-1.0.0.exe`**

---

## বাংলা

MERQO Retail Suite 1.0.0 — বাংলাদেশের দোকানের জন্য তৈরি সম্পূর্ণ ডেস্কটপ রিটেইল ব্যবস্থাপনা প্ল্যাটফর্ম। ইন্টারনেট ছাড়া চলে, কোনো ক্লাউড বা সাবস্ক্রিপশন নেই, সম্পূর্ণ ইউজার-ইন্টারফেস বাংলায়।

### প্রধান সামর্থ্যসমূহ
- **পিওএস** — বারকোড স্ক্যান, লাইভ স্টক ব্যাজ, হোল্ড/রিজিউম, ইনভয়েস ডিসকাউন্ট, ভ্যাট, এক বিলে একাধিক পেমেন্ট (নগদ/ব্যাংক/MFS)
- **বিক্রয় ও ফেরত** — আংশিক ফেরত (স্টক ফেরত + নগদ/বকেয়া রিফান্ড), ভয়েড (নিরাপত্তা-গার্ডসহ), সম্পূর্ণ ইনভয়েস হিস্ট্রি
- **ক্রয় ও সরবরাহকারী** — বাকি কেনা, আংশিক পরিশোধ, ডিসকাউন্ট/অন্যান্য খরচ WAC-এ প্রো-রাটা, ভয়েডে স্বয়ংক্রিয় স্টক কাটা
- **মজুদ হিসাব** — WAC ভ্যালুয়েশন, লো/আউট-অব-স্টক, মুভমেন্ট লেজার, সমন্বয়, বারকোড লেবেল
- **গ্রাহক/সরবরাহকারী বকেয়া** — ভাউচারসহ কালেকশন/পরিশোধ, স্টেটমেন্ট, বড় বকেয়া সতর্কতা
- **হিসাব ও আর্থিক** — ক্যাশ/ব্যাংক/MFS অ্যাকাউন্ট, ট্রান্সফার, লেজার, খরচ, P&L ও ক্যাশফ্লো রিপোর্ট; সব সংখ্যা পোয়াশা-নির্ভুল
- **এমএফএস এজেন্ট** — বিকাশ/নাগাদ/রকেট ক্যাশ-ইন/আউট/সেন্ড-মানি; কমিশন-চার্জ কনফিগারযোগ্য (bps), কমিশন আয় ≠ পণ্যের রেভিনিউ
- **রিপোর্ট** — ১৩+ রিপোর্ট + CSV এক্সপোর্ট; ড্যাশবোর্ড, রিপোর্ট ও লেজার — এক উৎস, শূন্য পার্থক্য
- **ছাপাই** — A4/A5 চালান, 80mm/58mm রসিদ, PDF সেভ, বাংলা ফন্ট ফলব্যাক (Windows Nirmala UI সহ)
- **নিরাপত্তা** — লগইন + PIN লক, ৩টি সিস্টেম রোল ও ৩০+ গ্রানুলার পারমিশন, সব যাচাই সার্ভার-সাইড, সম্পূর্ণ অডিট লগ
- **মাল্টি-বিজনেস** — এক ব্যবহারকারী, একাধিক ব্যবসা; ডেটা সম্পূর্ণ পৃথক (সার্ভার-সাইড আইসোলেশন)
- **LAN মোড** — এক কম্পিউটার সার্ভার (০.০.০.০), অন্য ডেস্কটপ ক্লায়েন্ট সংযোগ করতে পারে; মালিকের সম্মতিতেই চালু হয়
- **মোবাইল মনিটর** — মালিকের ফোনে রিড-অনলি ড্যাশবোর্ড (টোকেন-প্রটেক্টেড); ফোন থেকে কোনো লেনদেন করা যায় না
- **ব্যাকআপ/রিস্টোর** — ভেরিফায়েড স্ন্যাপশট (`VACUUM INTO` + integrity_check), করাপ্ট ফাইল প্রত্যাখ্যান
- **ইমপোর্ট/এক্সপোর্ট** — CSV; অপরিপূর্ণ ফাইলে সম্পূর্ণ রোলব্যাক (আংশিক ডেটা কখনো নয়), ডুপ্লিকেট SKU/বারকোড ধরা পড়ে

### নিরাপত্তা ছক
স্ক্রিপ্ট(scrypt) পাসওয়ার্ড হ্যাশ, সেশন টোকেন শুধু হ্যাশ-আকারে সংরক্ষিত, আইডল/অ্যাবসোলিউট এক্সপায়ারি, ব্রুট-ফোর্স লকআউট, `sandbox`+`contextIsolation` Electron, ন্যূনতম IPC, CSP, `npm audit` ০ ভালনারেবিলিটি।

---

## English Summary

MERQO Retail Suite 1.0.0 is an offline-first desktop retail platform: POS, sales/returns, purchases & supplier dues, WAC inventory accounting, customer dues, accounts/expenses/finance, configurable MFS agent module, 13+ reconciled reports with CSV export, A4/thermal printing + PDF, RBAC with full server-side enforcement and audit log, multi-business, opt-in LAN multi-device mode, token-gated read-only phone monitoring, verified backup/restore, and transactional CSV import.

**Integrity guarantees:** every financial multi-write runs inside a database transaction (verified by mid-operation failure injection); ledger postings must always equal account balances; dashboard = reports = ledger (single source of truth); historical invoices are immutable under product edits.

**Security:** scrypt password hashing, hashed session tokens with idle/absolute expiry, brute-force lockout, 30+ granular permissions enforced in the core (never only in UI), sandboxed renderer, minimal IPC, clean `npm audit`.

**Known limitations (environment of record):** Windows installer verified by CI build only (not physically executed in the build sandbox); printer output validated at layout/CSS level, not on physical paper; LAN concurrency proven via parallel API testing, not across physical machines. See `docs/MANUAL-QA-CHECKLIST.md` for pre-deployment validation steps.

**Contact:** MERQO · merqoonline@gmail.com
