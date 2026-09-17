#!/usr/bin/env bash
# Seed the QA preview instance through the app's own HTTP API (real flows only).
set -euo pipefail
B=http://127.0.0.1:8080/api
jq_post() { jq -c "$1" ; }
post() { local p=$1 d=$2; curl -sS -X POST "$B$p" -H "content-type: application/json" ${TOKEN:+-H "authorization: Bearer $TOKEN"} -d "$d"; }
get() { curl -sS "$B$1" -H "authorization: Bearer $TOKEN"; }

echo "── setup"
TOKEN=$(post /setup '{
  "owner": {"name": "রহিম উদ্দিন", "username": "owner", "password": "merqo123", "phone": "01711000000"},
  "business": {
    "name": "মেরকো সুপার শপ", "owner_name": "রহিম উদ্দিন", "phone": "01711000000",
    "email": "merqoonline@gmail.com", "address": "দপ্তর গেট, টাঙ্গাইল", "biz_type": "super_shop",
    "accounts": [
      {"name": "ক্যাশ বাক্স", "type": "cash", "opening_balance": 5000000},
      {"name": "City Bank", "type": "bank", "opening_balance": 25000000},
      {"name": "bKash এজেন্ট", "type": "mfs", "provider": "bkash", "opening_balance": 800000}
    ]
  }
}' | jq -r .token)
echo "token: ${TOKEN:0:12}…"

echo "── second staff user (ক্যাশিয়ার via role)"
post /staff/users '{"name": "সাজিদ হোসেন", "username": "sajid", "password": "merqo123", "phone": "01822000000"}' >/dev/null
RID=$(get /roles | jq -r '.rows[] | select(.name == "ক্যাশিয়ার") | .id')
UID2=$(get /staff/users | jq -r '.rows[] | select(.username == "sajid") | .id')
post /staff/members "{\"user_id\": \"$UID2\", \"role_id\": \"$RID\"}" >/dev/null

echo "── products"
pid(){ post /products "$1" | jq -r .id; }
P1=$(pid '{"name": "প্রাণ মিনারেল ওয়াটার ১ লি.", "sku": "PRN-WTR-1L", "barcode": "880123400001", "category": "পানীয়", "brand": "প্রাণ", "unit": "পিস", "purchase_price": 1200, "selling_price": 1500, "opening_stock": 120, "min_stock": 24}')
P2=$(pid '{"name": "প্রাণ আমের জুস ২৫০মি.লি.", "sku": "PRN-JUS-250", "barcode": "880123400002", "category": "পানীয়", "brand": "প্রাণ", "unit": "পিস", "purchase_price": 2000, "selling_price": 2500, "opening_stock": 80, "min_stock": 20}')
P3=$(pid '{"name": "ফ্রেশ সয়াবিন তেল ১ লি.", "sku": "FRS-OIL-1L", "barcode": "880123400003", "category": "মুদি বাজার", "brand": "ফ্রেশ", "unit": "লিটার", "purchase_price": 16500, "selling_price": 17500, "opening_stock": 60, "min_stock": 12}')
P4=$(pid '{"name": "চিনি (লুজ) ১ কেজি", "sku": "SGR-LSE-1K", "barcode": "880123400004", "category": "মুদি বাজার", "brand": "মিনা", "unit": "কেজি", "purchase_price": 13500, "selling_price": 14500, "opening_stock": 90, "min_stock": 15}')
P5=$(pid '{"name": "আকাশ চাল পাইকারি ৫০ কেজি", "sku": "RCE-AKS-50", "barcode": "880123400005", "category": "মুদি বাজার", "brand": "আকাশ", "unit": "বস্তা", "purchase_price": 420000, "selling_price": 445000, "opening_stock": 8, "min_stock": 2}')
P6=$(pid '{"name": "টেলিফোন চার্জার ক্যাবল (Type-C)", "sku": "ELC-CBL-TC", "barcode": "880123400006", "category": "ইলেকট্রনিকস", "brand": "হাইওয়ে", "unit": "পিস", "purchase_price": 9500, "selling_price": 13500, "opening_stock": 40, "min_stock": 10}')
P7=$(pid '{"name": "ওয়ালটন এলইডি বাল্ব ৯ওয়াট", "sku": "ELC-BLB-9W", "barcode": "880123400007", "category": "ইলেকট্রনিকস", "brand": "ওয়ালটন", "unit": "পিস", "purchase_price": 18000, "selling_price": 23000, "opening_stock": 25, "min_stock": 6}')
P8=$(pid '{"name": "ডেটা কেবল মাইক্রো USB", "sku": "ELC-CBL-MU", "barcode": "880123400008", "category": "ইলেকট্রনিকস", "brand": "হাইওয়ে", "unit": "পিস", "purchase_price": 6000, "selling_price": 9000, "opening_stock": 0, "min_stock": 8}')
P9=$(pid '{"name": "সাবান স্যান্ডেল ১০০গ্রা.", "sku": "HPC-SND-100", "barcode": "880123400009", "category": "তৈলজাত", "brand": "লালবাগ", "unit": "পিস", "purchase_price": 4000, "selling_price": 4800, "opening_stock": 100, "min_stock": 20}')
P10=$(pid '{"name": "কলগেট টুথপেস্ট ২০০গ্রা.", "sku": "HPC-CLS-200", "barcode": "880123400010", "category": "তৈলজাত", "brand": "কলগেট", "unit": "পিস", "purchase_price": 15500, "selling_price": 18000, "opening_stock": 50, "min_stock": 10}')
P11=$(pid '{"name": "বিস্কুট ক্রিম ক্র্যাকার", "sku": "FOD-CKR-CR", "barcode": "880123400011", "category": "স্ন্যাকস", "brand": "অলিম্পিক", "unit": "প্যাকেট", "purchase_price": 2200, "selling_price": 2600, "opening_stock": 150, "min_stock": 30}')
P12=$(pid '{"name": "চিপস মেক্সিকান হট", "sku": "FOD-CHP-MX", "barcode": "880123400012", "category": "স্ন্যাকস", "brand": "প্রাণ", "unit": "প্যাকেট", "purchase_price": 1200, "selling_price": 1500, "opening_stock": 200, "min_stock": 40}')

echo "── customers & suppliers"
C1=$(post /customers '{"name": "কামাল হোসেন", "phone": "01712345678", "address": "নিউ এলাকা, টাঙ্গাইল", "opening_due": 0}' | jq -r .id)
C2=$(post /customers '{"name": "রফিকুল ইসলাম", "phone": "01887654321", "address": "সিলেক্টেড পাড়া", "opening_due": 35000}' | jq -r .id)
C3=$(post /customers '{"name": "নাসরিন আক্তার", "phone": "01933445566", "opening_due": 0}' | jq -r .id)
S1=$(post /suppliers '{"name": "মেসার্স রহমান ট্রেডার্স", "phone": "01711555666", "address": "কাওরান বাজার পাইকারি", "opening_due": 0}' | jq -r .id)
S2=$(post /suppliers '{"name": "প্রাণ-আরএফএল ডিস্ট্রিবিউটর", "phone": "01712999888", "opening_due": 0}' | jq -r .id)

echo "── purchases"
ACC=$(get /accounts)
CASH=$(echo "$ACC" | jq -r '.rows[] | select(.type=="cash") | .id')
BANK=$(echo "$ACC" | jq -r '.rows[] | select(.type=="bank") | .id')
BKSH=$(echo "$ACC" | jq -r '.rows[] | select(.type=="mfs") | .id')
post /purchases "{\"supplier_id\": \"$S1\", \"note\": \"সাপ্তাহিক মুদি বাজার রিফিল\", \"items\": [{\"product_id\": \"$P3\", \"qty\": 30, \"unit_cost\": 16500}, {\"product_id\": \"$P4\", \"qty\": 40, \"unit_cost\": 13500}], \"payments\": [{\"account_id\": \"$BANK\", \"amount\": 800000, \"method\": \"bank\"}]}" | jq -c '.purchase | {total, paid, due}'
post /purchases "{\"supplier_id\": \"$S2\", \"items\": [{\"product_id\": \"$P1\", \"qty\": 60, \"unit_cost\": 1200}, {\"product_id\": \"$P2\", \"qty\": 40, \"unit_cost\": 2000}, {\"product_id\": \"$P12\", \"qty\": 100, \"unit_cost\": 1200}], \"discount\": 3000, \"payments\": [{\"account_id\": \"$CASH\", \"amount\": 100000, \"method\": \"cash\"}]}" | jq -c '.purchase | {total, paid, due}'

echo "── POS sales (cash / bkash / due)"
sale(){ post /sales "$1" | jq -c '.sale | {invoice_no, total, paid, due}'; }
sale "{\"items\": [{\"product_id\": \"$P1\", \"qty\": 2, \"unit_price\": 1500}, {\"product_id\": \"$P11\", \"qty\": 3, \"unit_price\": 2600}], \"payments\": [{\"account_id\": \"$CASH\", \"amount\": 10800, \"method\": \"cash\"}]}"
sale "{\"customer_id\": \"$C1\", \"items\": [{\"product_id\": \"$P3\", \"qty\": 2, \"unit_price\": 17500}, {\"product_id\": \"$P4\", \"qty\": 3, \"unit_price\": 14500}], \"payments\": [{\"account_id\": \"$BKSH\", \"amount\": 60000, \"method\": \"bkash\"}, {\"account_id\": \"$CASH\", \"amount\": 10000, \"method\": \"cash\"}]}"
sale "{\"customer_id\": \"$C2\", \"items\": [{\"product_id\": \"$P5\", \"qty\": 1, \"unit_price\": 445000}, {\"product_id\": \"$P9\", \"qty\": 5, \"unit_price\": 4800}], \"payments\": []}"
sale "{\"items\": [{\"product_id\": \"$P7\", \"qty\": 2, \"unit_price\": 23000}, {\"product_id\": \"$P6\", \"qty\": 1, \"unit_price\": 13500}], \"invoice_discount\": 2000, \"payments\": [{\"account_id\": \"$BANK\", \"amount\": 57500, \"method\": \"card\"}]}"
sale "{\"customer_id\": \"$C3\", \"items\": [{\"product_id\": \"$P10\", \"qty\": 2, \"unit_price\": 18000}, {\"product_id\": \"$P12\", \"qty\": 4, \"unit_price\": 1500}], \"payments\": [{\"account_id\": \"$BKSH\", \"amount\": 30000, \"method\": \"bkash\"}]}"
sale "{\"items\": [{\"product_id\": \"$P11\", \"qty\": 2, \"unit_price\": 2600}, {\"product_id\": \"$P1\", \"qty\": 1, \"unit_price\": 1500}], \"payments\": [{\"account_id\": \"$CASH\", \"amount\": 6700, \"method\": \"cash\"}]}"

echo "── return + due collect + supplier payment"
SALE3=$(get "/sales?page=1&pageSize=5" | jq -r '.rows[] | select(.customer_name == "রফিকুল ইসলাম") | .id')
ITEM3=$(get "/sales/$SALE3" | jq -r '.items[] | select(.name | contains("সাবান")) | .id')
post /returns "{\"sale_id\": \"$SALE3\", \"items\": [{\"sale_item_id\": \"$ITEM3\", \"qty\": 2}], \"restock\": true, \"refund_mode\": \"due_adjust\", \"reason\": \"ভাঙা প্যাকেট\"}" | jq -c '{no, amount}'
post "/customers/$C2/collect" '{"amount": 200000, "account_id": "PLACEHOLDER", "method": "cash"}' >/dev/null 2>&1 || true
post "/customers/$C2/collect" "{\"amount\": 200000, \"account_id\": \"$CASH\", \"method\": \"cash\"}" | jq -c '{voucher_no, amount, receivable_after}'
SUP1_DUE=$(get "/suppliers/$S1" | jq -r .payable)
post "/suppliers/$S1/pay" "{\"amount\": 100000, \"account_id\": \"$BANK\", \"method\": \"bank\"}" | jq -c '{voucher_no, payable_after}'

echo "── expenses / transfer / MFS"
# the business ships with default expense categories — use those
CATS=$(get /expense-categories)
EC1=$(echo "$CATS" | jq -r '.rows[] | select(.name=="দোকান ভাড়া") | .id')
EC2=$(echo "$CATS" | jq -r '.rows[] | select(.name=="পরিবহন") | .id')
post /expenses "{\"title\": \"দোকান ভাড়া (সেপ্টেম্বর)\", \"category_id\": \"$EC1\", \"amount\": 1500000, \"account_id\": \"$CASH\"}" | jq -c '{no}'
post /expenses "{\"title\": \"বিদ্যুৎ বিল\", \"category_id\": \"$EC1\", \"amount\": 480000, \"account_id\": \"$CASH\"}" | jq -c '{no}'
post /expenses "{\"title\": \"পাইকারি মালামাল পরিবহন\", \"category_id\": \"$EC2\", \"amount\": 250000, \"account_id\": \"$CASH\"}" | jq -c '{no}'
post /transfers "{\"from\": \"$CASH\", \"to\": \"$BANK\", \"amount\": 500000, \"fee\": 0, \"note\": \"নগদ ব্যাংকে জমা\"}" | jq -c '.ok'
post /mfs "{\"provider\": \"bkash\", \"txn_type\": \"cash_in\", \"account_id\": \"$BKSH\", \"counter_account_id\": \"$CASH\", \"amount\": 500000, \"service_charge\": 500, \"customer_phone\": \"01712345678\"}" | jq -c '{id}'
post /mfs "{\"provider\": \"nagad\", \"txn_type\": \"send_money\", \"account_id\": \"$CASH\", \"counter_account_id\": \"$BKSH\", \"amount\": 100000, \"commission\": 0, \"service_charge\": 300}" | jq -c '{id}'

echo "── settings + held sale"
post /held '{"label": "হোল্ড-১ (রফিক ভাই)", "cart": {"lines": [{"product_id": "'$P7'", "name": "ওয়ালটন এলইডি বাল্ব ৯ওয়াট", "qty": 1, "unit_price": 23000, "discount": 0}], "customer_id": null, "invoice_discount": 0}}' | jq -c '.ok'
patch_settings() { curl -sS -X PATCH "$B/settings" -H "content-type: application/json" -H "authorization: Bearer $TOKEN" -d "$1"; }
patch_settings '{"values": {"invoice_footer": "মেরকো সুপার শপ · দপ্তর গেট, টাঙ্গাইল · 01711000000", "receipt_footer": "কেনার জন্য ধন্যবাদ! আবার আসবেন।", "large_due_threshold": 100000, "vat_enabled": false}}' | jq -c '.ok // .values.invoice_footer'
echo "── dashboard"
get /dashboard | jq -c '{today: {sales: .today.sales, count: .today.sales_count, profit: .today.gross_profit, due: .today.due}, position: .position.total, receivable: .dues.receivable, alerts: (.alerts | length)}'
