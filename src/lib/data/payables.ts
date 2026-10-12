import "server-only";
import { createClient } from "@/lib/supabase/server";
import { summarizeItems, type LedgerPayment, type LedgerPurchase, type PaymentKind, type PriceLine } from "@/lib/payables";

type LineRow = { item_name: string; quantity: number | string; unit: string | null; unit_price: number | string; line_no: number };

/** 지점(·거래처)의 거래처 연결된 매입 (외상 여부 포함, 품목 요약) — RLS: 대표·본사 관리자(소속 지점) */
export async function listLedgerPurchases(
  storeId: string,
  vendorId?: string,
): Promise<{ purchases: LedgerPurchase[]; priceLines: PriceLine[] }> {
  const supabase = await createClient();
  let q = supabase
    .from("expenses")
    .select("id, store_id, vendor_id, expense_date, amount, on_credit, description, expense_lines(item_name, quantity, unit, unit_price, line_no)")
    .eq("store_id", storeId)
    .not("vendor_id", "is", null)
    .order("expense_date");
  if (vendorId) q = q.eq("vendor_id", vendorId);
  const { data, error } = await q;
  if (error) throw new Error(`매입 조회 실패: ${error.message}`);

  const purchases: LedgerPurchase[] = [];
  const priceLines: PriceLine[] = [];
  for (const r of data ?? []) {
    const lines = ((r.expense_lines ?? []) as LineRow[]).sort((a, b) => a.line_no - b.line_no);
    purchases.push({
      id: r.id,
      storeId: r.store_id,
      vendorId: r.vendor_id as string,
      date: r.expense_date,
      amount: Number(r.amount),
      onCredit: r.on_credit,
      description: r.description,
      itemsSummary: summarizeItems(lines.map((l) => ({ itemName: l.item_name, quantity: Number(l.quantity), unit: l.unit }))),
    });
    for (const l of lines) {
      priceLines.push({
        date: r.expense_date,
        itemName: l.item_name,
        unit: l.unit,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unit_price),
      });
    }
  }
  return { purchases, priceLines };
}

/** 지점(·거래처)의 결제·이월 미수 */
export async function listLedgerPayments(storeId: string, vendorId?: string): Promise<LedgerPayment[]> {
  const supabase = await createClient();
  let q = supabase
    .from("vendor_payments")
    .select("id, store_id, vendor_id, paid_date, kind, amount, method, memo, updated_at")
    .eq("store_id", storeId)
    .order("paid_date");
  if (vendorId) q = q.eq("vendor_id", vendorId);
  const { data, error } = await q;
  if (error) throw new Error(`결제 조회 실패: ${error.message}`);
  return (data ?? []).map((p) => ({
    id: p.id,
    storeId: p.store_id,
    vendorId: p.vendor_id,
    date: p.paid_date,
    kind: p.kind as PaymentKind,
    amount: Number(p.amount),
    method: p.method,
    memo: p.memo,
    updatedAt: p.updated_at,
  }));
}
