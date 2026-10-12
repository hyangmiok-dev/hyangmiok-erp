/**
 * 거래처 미수(외상) 계산 (순수 함수).
 * 미수 잔액 = 이월 미수 + 외상 매입 − 결제
 *  - 외상 매입: 지출 중 on_credit = true (거래명세표로 받고 나중에 결제)
 *  - 바로 결제한 매입(on_credit = false)은 원장에 보이지만 잔액은 바뀌지 않는다
 */
import type { DateKey } from "@/lib/period";
import { percent, type Ratio } from "@/lib/format";

export interface LedgerPurchase {
  id: string;
  storeId: string;
  vendorId: string;
  date: DateKey;
  amount: number;
  onCredit: boolean;
  description: string | null;
  /** 품목 요약 (예: '차돌양지 10kg 외 2건') */
  itemsSummary: string | null;
}

export type PaymentKind = "payment" | "opening";

export interface LedgerPayment {
  id: string;
  storeId: string;
  vendorId: string;
  date: DateKey;
  kind: PaymentKind;
  amount: number;
  method: string | null;
  memo: string | null;
  /** 수정 시 동시 수정 감지용 */
  updatedAt?: string;
}

export type LedgerEntryType = "opening" | "purchase" | "purchase_paid" | "payment";

export interface LedgerEntry {
  key: string;
  date: DateKey;
  type: LedgerEntryType;
  refId: string;
  label: string;
  /** 미수 증가 (이월·외상 매입) */
  increase: number;
  /** 미수 감소 (결제) */
  decrease: number;
  /** 바로 결제한 매입 금액 (잔액 영향 없음, 참고용) */
  paidNow: number;
  balance: number;
}

export const METHOD_LABEL: Record<string, string> = {
  transfer: "계좌이체",
  card: "카드",
  cash: "현금",
  other: "기타",
};

const ORDER: Record<LedgerEntryType, number> = { opening: 0, purchase: 1, purchase_paid: 1, payment: 2 };

/** 한 거래처·한 지점의 원장 (날짜순, 같은 날은 이월 → 매입 → 결제 순) */
export function buildLedger(purchases: LedgerPurchase[], payments: LedgerPayment[]): LedgerEntry[] {
  const rows: Omit<LedgerEntry, "balance">[] = [
    ...payments.map((p) => ({
      key: `p:${p.id}`,
      date: p.date,
      type: p.kind === "opening" ? ("opening" as const) : ("payment" as const),
      refId: p.id,
      label:
        p.kind === "opening"
          ? `이월 미수${p.memo ? ` · ${p.memo}` : ""}`
          : `결제${p.method ? ` (${METHOD_LABEL[p.method] ?? p.method})` : ""}${p.memo ? ` · ${p.memo}` : ""}`,
      increase: p.kind === "opening" ? p.amount : 0,
      decrease: p.kind === "payment" ? p.amount : 0,
      paidNow: 0,
    })),
    ...purchases.map((e) => ({
      key: `e:${e.id}`,
      date: e.date,
      type: e.onCredit ? ("purchase" as const) : ("purchase_paid" as const),
      refId: e.id,
      label: [e.itemsSummary, e.description].filter(Boolean).join(" · ") || "매입",
      increase: e.onCredit ? e.amount : 0,
      decrease: 0,
      paidNow: e.onCredit ? 0 : e.amount,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || ORDER[a.type] - ORDER[b.type]);

  let balance = 0;
  return rows.map((r) => {
    balance += r.increase - r.decrease;
    return { ...r, balance };
  });
}

export interface VendorPayableSummary {
  vendorId: string;
  balance: number;
  /** 이번 달 외상 매입 */
  monthCredit: number;
  /** 이번 달 바로 결제한 매입 */
  monthPaidNow: number;
  /** 이번 달 결제 */
  monthPayments: number;
  lastPurchaseDate: DateKey | null;
  lastPaymentDate: DateKey | null;
  hasActivity: boolean;
}

/** 지점의 거래처별 미수 요약 */
export function summarizePayables(opts: {
  vendorIds: string[];
  purchases: LedgerPurchase[];
  payments: LedgerPayment[];
  month: string; // 'YYYY-MM'
}): VendorPayableSummary[] {
  const inMonth = (d: DateKey) => d.slice(0, 7) === opts.month;
  const ids = [...new Set([...opts.vendorIds, ...opts.purchases.map((p) => p.vendorId), ...opts.payments.map((p) => p.vendorId)])];
  return ids.map((vendorId) => {
    const pur = opts.purchases.filter((p) => p.vendorId === vendorId);
    const pay = opts.payments.filter((p) => p.vendorId === vendorId);
    const ledger = buildLedger(pur, pay);
    const lastOf = (ds: DateKey[]) => (ds.length ? ds.reduce((a, b) => (a > b ? a : b)) : null);
    return {
      vendorId,
      balance: ledger.length ? ledger[ledger.length - 1].balance : 0,
      monthCredit: pur.filter((p) => p.onCredit && inMonth(p.date)).reduce((n, p) => n + p.amount, 0),
      monthPaidNow: pur.filter((p) => !p.onCredit && inMonth(p.date)).reduce((n, p) => n + p.amount, 0),
      monthPayments: pay.filter((p) => p.kind === "payment" && inMonth(p.date)).reduce((n, p) => n + p.amount, 0),
      lastPurchaseDate: lastOf(pur.map((p) => p.date)),
      lastPaymentDate: lastOf(pay.filter((p) => p.kind === "payment").map((p) => p.date)),
      hasActivity: pur.length > 0 || pay.length > 0,
    };
  });
}

// ---------------------------------------------------------------------
// 품목 단가 변동
// ---------------------------------------------------------------------

export interface PriceLine {
  date: DateKey;
  itemName: string;
  unit: string | null;
  quantity: number;
  unitPrice: number;
}

export interface ItemPrice {
  key: string;
  itemName: string;
  unit: string | null;
  latestPrice: number;
  latestDate: DateKey;
  /** 바로 전에 다른 가격이었던 때 */
  previousPrice: number | null;
  previousDate: DateKey | null;
  change: Ratio;
  timesBought: number;
}

/** 품목(이름+단위)별 최근 단가와 직전 단가 ('부가세' 줄은 품목이 아니므로 뺀다) */
export function itemPriceHistory(lines: PriceLine[]): ItemPrice[] {
  const groups = new Map<string, PriceLine[]>();
  for (const l of lines) {
    if (l.itemName.trim() === "부가세") continue;
    const key = `${l.itemName.trim()}|${l.unit?.trim() ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const out: ItemPrice[] = [];
  for (const [key, ls] of groups) {
    const sorted = [...ls].sort((a, b) => b.date.localeCompare(a.date));
    const latest = sorted[0];
    const prev = sorted.find((l) => l.unitPrice !== latest.unitPrice && l.date <= latest.date) ?? null;
    out.push({
      key,
      itemName: latest.itemName.trim(),
      unit: latest.unit?.trim() || null,
      latestPrice: latest.unitPrice,
      latestDate: latest.date,
      previousPrice: prev?.unitPrice ?? null,
      previousDate: prev?.date ?? null,
      change: prev ? percent(latest.unitPrice - prev.unitPrice, prev.unitPrice) : { status: "missing" },
      timesBought: ls.length,
    });
  }
  return out.sort((a, b) => b.latestDate.localeCompare(a.latestDate) || a.itemName.localeCompare(b.itemName, "ko"));
}

/** 품목 줄 → 한 줄 요약 ('차돌양지 10kg 외 2건') */
export function summarizeItems(lines: { itemName: string; quantity: number; unit: string | null }[]): string | null {
  if (!lines.length) return null;
  const q = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString("ko-KR", { maximumFractionDigits: 3 }));
  const first = `${lines[0].itemName} ${q(lines[0].quantity)}${lines[0].unit ?? ""}`;
  return lines.length > 1 ? `${first} 외 ${lines.length - 1}건` : first;
}

/** 수량 × 단가 → 원 단위 금액 (반올림) */
export function lineAmount(quantity: number, unitPrice: number): number {
  return Math.round(quantity * unitPrice);
}
