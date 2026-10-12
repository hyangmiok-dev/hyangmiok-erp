/**
 * 거래처별 월 매입 현황 (순수 함수) — 대표 엑셀 '원재료(원가율)' 표와 같은 모양.
 * 행 = 거래처, 열 = 1~12월, 칸 = 매입액(부가세 포함) / 그 달 실매출 대비 %.
 * 원가율은 '매입 기준'(재고 변동 미반영)이며, 매출 미입력 달은 계산하지 않는다.
 */
import { endOfMonth, type DateKey } from "@/lib/period";
import { percent, type Ratio } from "@/lib/format";
import { summarize, type SaleRow, type Summary } from "@/lib/sales/summary";

export interface PurchaseExpense {
  date: DateKey;
  amount: number;
  vendorId: string | null;
  vendor: string | null;
}

export interface VendorRef {
  id: string;
  name: string;
  sortOrder: number;
}

export interface PurchaseRow {
  key: string;
  name: string;
  vendorId: string | null;
  /** 거래처 관리 목록에 있는 거래처인지 */
  listed: boolean;
  months: number[]; // 길이 12
  total: number;
  share: Ratio; // 연간 매입 중 비중
}

export interface MonthSales {
  month: number; // 1~12
  started: boolean;
  summary: Summary | null; // started=false 면 null
}

export interface PurchaseMatrix {
  rows: PurchaseRow[];
  monthTotals: number[];
  total: number;
  sales: MonthSales[];
  /** 매입 ÷ 실매출 × 100 (매입 기준 원가율) */
  rates: (Ratio & { incomplete?: boolean })[];
}

const NO_VENDOR = "__none__";

export function buildPurchaseMatrix(opts: {
  year: number;
  storeId: string;
  today: DateKey;
  expenses: PurchaseExpense[];
  sales: SaleRow[];
  vendors: VendorRef[];
  /** 이 지점과 거래하는 거래처(거래가 없어도 행을 보여줌) */
  storeVendorIds: string[];
}): PurchaseMatrix {
  const { year, storeId, today } = opts;
  const vendorById = new Map(opts.vendors.map((v) => [v.id, v]));
  const vendorByName = new Map(opts.vendors.map((v) => [v.name, v]));
  const rows = new Map<string, PurchaseRow>();

  const ensure = (key: string, name: string, vendorId: string | null, listed: boolean) => {
    let row = rows.get(key);
    if (!row) {
      row = { key, name, vendorId, listed, months: Array(12).fill(0), total: 0, share: { status: "missing" } };
      rows.set(key, row);
    }
    return row;
  };

  for (const id of opts.storeVendorIds) {
    const v = vendorById.get(id);
    if (v) ensure(v.id, v.name, v.id, true);
  }

  for (const e of opts.expenses) {
    if (Number(e.date.slice(0, 4)) !== year) continue;
    const m = Number(e.date.slice(5, 7)) - 1;
    // 거래처 연결이 없어도 이름이 목록과 같으면 같은 거래처로 본다
    const v = (e.vendorId && vendorById.get(e.vendorId)) || (e.vendor ? vendorByName.get(e.vendor.trim()) : undefined);
    const row = v
      ? ensure(v.id, v.name, v.id, true)
      : e.vendor?.trim()
        ? ensure(`text:${e.vendor.trim()}`, e.vendor.trim(), null, false)
        : ensure(NO_VENDOR, "(거래처 미입력)", null, false);
    row.months[m] += e.amount;
    row.total += e.amount;
  }

  const total = [...rows.values()].reduce((n, r) => n + r.total, 0);
  const order = (r: PurchaseRow) => (r.vendorId ? (vendorById.get(r.vendorId)?.sortOrder ?? 1e9) : 2e9);
  const sorted = [...rows.values()]
    .map((r) => ({ ...r, share: percent(r.total, total) }))
    .sort((a, b) => order(a) - order(b) || b.total - a.total || a.name.localeCompare(b.name, "ko"));

  const monthTotals = Array.from({ length: 12 }, (_, m) => sorted.reduce((n, r) => n + r.months[m], 0));

  const sales: MonthSales[] = Array.from({ length: 12 }, (_, m) => {
    const start = `${year}-${String(m + 1).padStart(2, "0")}-01`;
    if (start > today) return { month: m + 1, started: false, summary: null };
    const end = endOfMonth(start) > today ? today : endOfMonth(start);
    return { month: m + 1, started: true, summary: summarize(opts.sales, [storeId], { start, end }) };
  });

  const rates = sales.map((s, m) => {
    if (!s.started || !s.summary || s.summary.netSales === null) return { status: "missing" as const };
    const r = percent(monthTotals[m], s.summary.netSales);
    return r.status === "ok" ? { ...r, incomplete: !s.summary.complete } : r;
  });

  return { rows: sorted, monthTotals, total, sales, rates };
}
