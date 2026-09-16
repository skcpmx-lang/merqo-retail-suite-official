# MERQO Retail Suite

**প্রোডাকশন-রেডি ডেস্কটপ রিটেইল ব্যবস্থাপনা প্ল্যাটফর্ম** — বাংলাদেশের দোকানের জন্য বানানো, সম্পূর্ণ বাংলা ইউজার-ইন্টারফেসসহ। ইন্টারনেট ছাড়াই চলে; কোনো ক্লাউড, সাবস্ক্রিপশন বা পেইড সার্ভিস নেই।

> Production-ready desktop retail management platform (POS · Sales · Purchases · Inventory · Customers/Suppliers with dues · Accounts · Expenses · Finance · MFS agent · Reports · Printing/PDF · Backup · RBAC · Multi-device LAN). Full natural-Bengali UI. Works fully offline.

---

## ✨ ফিচারসমূহ

| মডিউল | বিবরণ |
|---|---|
| **পিওএস (বিক্রয় কেন্দ্র)** | বারকোড স্ক্যান/সার্চ, লাইভ স্টক ব্যাজ, হোল্ড/রিজিউম, ইনভয়েস ডিসকাউন্ট, ভ্যাট, মাল্টি-পেমেন্ট (নগদ/ব্যাংক/বিকাশ) |
| **বিক্রয় ও রিটার্ন** | ইনভয়েস তালিকা/ডিটেইল, আংশিক রিটার্ন (রিস্টক + রিফান্ড: নগদ/বকেয়া কাটা), ভয়েড (গার্ডসহ) |
| **ক্রয়** | সাপ্লায়ার পারচেজ, ডিসকাউন্ট/অন্যান্য খরচ প্রো-রাটা WAC-এ, বাকি হিসাব, ভয়েডে স্টক কাটা |
| **মজুদ** | ভ্যালুয়েশন (cost/price), লো-স্টক ও স্টক-আউট, মুভমেন্ট লেজার, অ্যাডজাস্টমেন্ট, এক্সপায়ারি, বারকোড লেবেল প্রিন্ট |
| **গ্রাহক/সরবরাহকারী** | বকেয়া (due) ট্র্যাকিং, কালেকশন/পেমেন্ট ভাউচার, স্টেটমেন্ট, বড় বকেয়া সতর্কতা |
| **হিসাব ও আর্থিক** | ক্যাশ/ব্যাংক/MFS অ্যাকাউন্ট, ট্রান্সফার, লেজার, খরচ, P&L, ক্যাশফ্লো — সব পোয়াশা-নির্ভুল ইন্টিজার অ্যারিথমেটিক |
| **এমএফএস এজেন্ট** | বিকাশ/নাগাদ/রকেট ক্যাশ-ইন/আউট, সেন্ড-মানি, কমিশন ও চার্জ ট্র্যাকিং (আয় ≠ রেভিনিউ) |
| **রিপোর্ট** | ১৩+ রিপোর্ট + CSV এক্সপোর্ট; ড্যাশবোর্ড = রিপোর্ট = লেজার (এক উৎস, কোনো পার্থক্য নেই) |
| **ছাপাই** | A4/A5/80mm/58mm ইনভয়েস, রসিদ, স্টেটমেন্ট, লেবেল; OS প্রিন্ট স্ট্যাক + PDF সেভ |
| **নিরাপত্তা** | লগইন + PIN লক, গ্রানুলার RBAC (৩০+ পারমিশন), সম্পূর্ণ অডিট লগ, সার্ভার-সাইড ভ্যালিডেশন |
| **মাল্টি-ডিভাইস** | LAN মোড — এক কম্পিউটার সার্ভার, অন্যগুলো ক্লায়েন্ট; মালিকের ফোনে রিড-অনলি মনিটর পেজ |
| **ব্যাকআপ** | এক-ক্লিক ভেরিফায়েড স্ন্যাপশট (`VACUUM INTO` + integrity_check), রিস্টোর, অটো-প্রুন |

## 🚀 ডেভেলপার গাইড

```bash
npm install            # ডিপেন্ডেন্সি
npm run dev            # ডেভ (Electron + Vite HMR)
npm run typecheck      # tsc (main+core, renderer)
npx vitest run --config tests/vitest.config.ts   # সম্পূর্ণ টেস্ট স্যুট (83 টেস্ট, in-memory SQLite)
npm run build          # প্রোডাকশন বিল্ড → out/
npm run dist           # Windows NSIS ইনস্টলার → release/
```

### QA হারনেস (ব্রাউজারে পুরো UI)

```bash
npm run build
npx esbuild scripts/qa-server.ts --bundle --platform=node --format=cjs \
  --external:better-sqlite3 --external:express --outfile=out/qa/server.cjs
node out/qa/server.cjs            # → http://localhost:8080
bash scripts/qa-seed.sh           # ডেমো ডেটা (নিজের API দিয়েই)
npx vitest run --config tests/vitest.config.ts tests/ui-smoke.test.tsx
```

QA হারনেস প্রোডাকশন-বিল্ট SPA + আসল কোর API **এক পোর্টে** চালায় — Electron ছাড়াই পুরো অ্যাপ ব্রাউজারে টেস্ট করা যায়।

## 🏗 আর্কিটেকচার (সংক্ষেপে)

- **Core** (`src/core`) — Express সার্ভার + better-sqlite3; সব বিজনেস রুল, RBAC, অডিট এখানে। ক্লায়েন্ট কোনো ট্রাস্ট নেই।
- **Main** (`src/main`) — Electron বুটস্ট্র্যাপ: কোর চালু, উইন্ডো, প্রিন্ট ইঞ্জিন (হিডেন উইন্ডো), IPC।
- **Renderer** (`src/renderer`) — React SPA; ৩০টি পেজ, কেন্দ্রীয় বাংলা লোকালাইজেশন (`i18n/bn.ts`), লাইট-মোড টোকেন সিস্টেম।
- **Money** = পোয়াশা-ইন্টিজার (১৳ = ১০০), **qty** = 3dp REAL; WAC কস্টিং; মাল্টি-রাইট সব `db.transaction`-এ।

বিস্তারিত: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · রিলিজ নোট: [`docs/RELEASE-NOTES-1.0.0.md`](docs/RELEASE-NOTES-1.0.0.md) · ম্যানুয়াল QA চেকলিস্ট: [`docs/MANUAL-QA-CHECKLIST.md`](docs/MANUAL-QA-CHECKLIST.md) · লাইসেন্স: [`docs/LICENSE-COMMERCIAL.md`](docs/LICENSE-COMMERCIAL.md) · OSS নোটিশ: [`docs/THIRD-PARTY-NOTICES.md`](docs/THIRD-PARTY-NOTICES.md)

## 📦 Windows ইনস্টলার

`npm run dist` → `release/MERQO-Retail-Suite-Setup-1.0.0.exe` (NSIS, x64, ডেস্কটপ শর্টকাট, ইনস্টলেশন ডিরেক্টরি বাছাইযোগ্য, EULA সহ)। GitHub Actions রিলিজ ওয়ার্কফ্লো একই কমান্ডে সাইন-বিহীন ইনস্টলার তৈরি করে (`.github/workflows/`)।

## 📞 যোগাযোগ

**MERQO** · merqoonline@gmail.com

© 2026 MERQO. সর্বস্বত্ব সংরক্ষিত।
