/**
 * 월 손익 계산 (순수 함수).
 * - 매출원가 = 기초재고 + 당월 식재료 매입 − 기말재고  (재고 실사가 양쪽 다 있을 때만 '실제')
 *   재고가 없으면 '매입 − 냉장고 재고(지점별 대표 설정 5~10%)'로 보고 추정 표시
 * - 영업이익 = 실매출 − 매출원가 − 인건비 − 기타 영업비용   (section 'excluded' 는 제외)
 * - 미입력은 0 으로 확정하지 않는다: 매출 미입력 일수, 지난달엔 있었는데 이번 달 없는 항목을 경고
 */
import { addDays, endOfMonth, type DateKey, type DateRange } from "@/lib/period";
import { percent, type Ratio } from "@/lib/format";
import { summarize, type SaleRow, type Summary } from "@/lib/sales/summary";

/** 냉장고 재고 비율 선택지 (%) — 대표만 지점별로 정한다 (stores.stock_reserve_pct, DB 에서 5~10 강제) */
export const STOCK_RESERVE_OPTIONS = [5, 6, 7, 8, 9, 10] as const;

/**
 * 매출원가
 *  - 재고 실사(전월 말·이달 말)가 둘 다 있으면 실제: 기초 + 매입 − 기말
 *  - 없으면 추정: 매입 − 냉장고 재고(매입 × 비율, 원 단위 반올림)
 */
export function costOfGoods(opts: { purchases: number; begin: number | null; end: number | null; reservePct: number }): {
  cogs: number;
  basis: "actual" | "estimated";
  reserveAmount: number;
} {
  if (opts.begin !== null && opts.end !== null) {
    return { cogs: opts.begin + opts.purchases - opts.end, basis: "actual", reserveAmount: 0 };
  }
  const reserveAmount = Math.round((opts.purchases * opts.reservePct) / 100);
  return { cogs: opts.purchases - reserveAmount, basis: "estimated", reserveAmount };
}

export type Section = "cogs" | "labor" | "opex" | "excluded";

export const SECTION_LABEL: Record<Section, string> = {
  cogs: "식재료 매입",
  labor: "인건비",
  opex: "기타 영업비용",
  excluded: "영업이익 계산 제외",
};

export interface ExpenseItem {
  storeId: string;
  date: DateKey;
  categoryId: string;
  categoryName: string;
  section: Section;
  amount: number;
  basis: "actual" | "estimated";
  /** 외상 매입 (거래처 미수로 잡힌 것) */
  onCredit?: boolean;
}

export interface InventoryCount {
  storeId: string;
  date: DateKey;
  amount: number;
}

export interface CategoryLine {
  categoryId: string;
  name: string;
  section: Section;
  amount: number;
  hasEstimated: boolean;
}

export interface StorePnl {
  storeId: string;
  sales: Summary;
  purchases: number;
  /** 식재료 매입 중 외상 */
  creditPurchases: number;
  beginInventory: number | null;
  endInventory: number | null;
  /** 냉장고 재고 비율(%) — 대표 설정 */
  stockReservePct: number;
  /** 추정일 때 매입에서 뺀 냉장고 재고 금액 (실제 재고를 쓰면 0) */
  stockReserveAmount: number;
  /** 매출원가 */
  cogs: number;
  cogsBasis: "actual" | "estimated";
  labor: number;
  opex: number;
  excluded: number;
  lines: CategoryLine[];
  operatingProfit: number | null;
  cogsRate: Ratio;
  laborRate: Ratio;
  operatingMargin: Ratio;
  /** 지난달엔 있었는데 이번 달 입력이 없는 항목 */
  missingCategories: string[];
  hasEstimatedExpense: boolean;
  status: "confirmed" | "estimated";
  reasons: string[];
}

export function monthRange(month: string): DateRange {
  const start = `${month}-01`;
  return { start, end: endOfMonth(start) };
}

export function prevMonth(month: string): string {
  return addDays(`${month}-01`, -1).slice(0, 7);
}

export function isMonthKey(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

const inRange = (d: DateKey, r: DateRange) => d >= r.start && d <= r.end;

export function computeStorePnl(opts: {
  storeId: string;
  month: string;
  today: DateKey;
  sales: SaleRow[];
  expenses: ExpenseItem[];
  inventory: InventoryCount[];
  /** 지점의 냉장고 재고 비율(%) */
  stockReservePct: number;
}): StorePnl {
  const { storeId, month, today, stockReservePct } = opts;
  const full = monthRange(month);
  // 진행 중인 달은 오늘까지만 매출 완결성을 본다
  const salesRange: DateRange = { start: full.start, end: full.end > today ? today : full.end };
  const sales = summarize(opts.sales, [storeId], salesRange);

  const mine = opts.expenses.filter((e) => e.storeId === storeId);
  const thisMonth = mine.filter((e) => inRange(e.date, full));
  const lastMonth = mine.filter((e) => inRange(e.date, monthRange(prevMonth(month))));

  const byCat = new Map<string, CategoryLine>();
  for (const e of thisMonth) {
    const line = byCat.get(e.categoryId) ?? {
      categoryId: e.categoryId,
      name: e.categoryName,
      section: e.section,
      amount: 0,
      hasEstimated: false,
    };
    line.amount += e.amount;
    line.hasEstimated ||= e.basis === "estimated";
    byCat.set(e.categoryId, line);
  }
  const lines = [...byCat.values()];
  const total = (s: Section) => lines.filter((l) => l.section === s).reduce((n, l) => n + l.amount, 0);

  const purchases = total("cogs");
  const creditPurchases = thisMonth.filter((e) => e.section === "cogs" && e.onCredit).reduce((n, e) => n + e.amount, 0);
  const inv = opts.inventory.filter((c) => c.storeId === storeId);
  const beginInventory = inv.find((c) => c.date === addDays(full.start, -1))?.amount ?? null;
  const endInventory = inv.find((c) => c.date === full.end)?.amount ?? null;
  const cost = costOfGoods({ purchases, begin: beginInventory, end: endInventory, reservePct: stockReservePct });
  const cogsActual = cost.basis === "actual";
  const cogs = cost.cogs;

  const labor = total("labor");
  const opex = total("opex");
  const excluded = total("excluded");

  const thisCats = new Set(thisMonth.map((e) => e.categoryId));
  const missingCategories = [
    ...new Map(lastMonth.filter((e) => !thisCats.has(e.categoryId)).map((e) => [e.categoryId, e.categoryName])).values(),
  ];
  const hasEstimatedExpense = thisMonth.some((e) => e.basis === "estimated");

  const net = sales.netSales;
  const operatingProfit = net === null ? null : net - cogs - labor - opex;

  const reasons: string[] = [];
  if (!sales.complete) reasons.push(sales.entered === 0 ? "매출 미입력" : `매출 ${sales.missing.length}일 미입력`);
  if (!cogsActual) {
    reasons.push(
      stockReservePct > 0
        ? `월말 재고 없음 → 매입액에서 냉장고 재고 ${stockReservePct}%를 빼고 원가로 계산`
        : "월말 재고 없음 → 매입액을 원가로 계산",
    );
  }
  if (hasEstimatedExpense) reasons.push("추정 금액 포함");
  if (missingCategories.length) reasons.push(`지난달 있던 항목 미입력: ${missingCategories.join(", ")}`);
  if (full.end > today) reasons.push("진행 중인 달");
  if (cogsActual && cogs < 0) reasons.push("매출원가가 음수 — 재고 금액 확인 필요");

  return {
    storeId,
    sales,
    purchases,
    creditPurchases,
    beginInventory,
    endInventory,
    stockReservePct,
    stockReserveAmount: cost.reserveAmount,
    cogs,
    cogsBasis: cost.basis,
    labor,
    opex,
    excluded,
    lines,
    operatingProfit,
    cogsRate: net === null ? { status: "missing" } : percent(cogs, net),
    laborRate: net === null ? { status: "missing" } : percent(labor, net),
    operatingMargin: operatingProfit === null ? { status: "missing" } : percent(operatingProfit, net),
    missingCategories,
    hasEstimatedExpense,
    status: reasons.length === 0 ? "confirmed" : "estimated",
    reasons,
  };
}

/** 여러 지점 합계 (한 곳이라도 추정이면 추정) */
export function combinePnl(
  items: StorePnl[],
): Omit<
  StorePnl,
  "storeId" | "sales" | "beginInventory" | "endInventory" | "creditPurchases" | "stockReservePct" | "stockReserveAmount"
> & {
  netSales: number | null;
  salesComplete: boolean;
} {
  const salesKnown = items.filter((p) => p.sales.netSales !== null);
  const netSales = salesKnown.length ? salesKnown.reduce((n, p) => n + p.sales.netSales!, 0) : null;
  const sum = (k: "purchases" | "cogs" | "labor" | "opex" | "excluded") => items.reduce((n, p) => n + p[k], 0);
  const cogs = sum("cogs");
  const labor = sum("labor");
  const opex = sum("opex");
  const operatingProfit = netSales === null ? null : netSales - cogs - labor - opex;

  const lineMap = new Map<string, CategoryLine>();
  for (const l of items.flatMap((p) => p.lines)) {
    const cur = lineMap.get(l.categoryId);
    if (cur) {
      cur.amount += l.amount;
      cur.hasEstimated ||= l.hasEstimated;
    } else lineMap.set(l.categoryId, { ...l });
  }

  return {
    netSales,
    salesComplete: items.every((p) => p.sales.complete),
    purchases: sum("purchases"),
    cogs,
    cogsBasis: items.every((p) => p.cogsBasis === "actual") ? "actual" : "estimated",
    labor,
    opex,
    excluded: sum("excluded"),
    lines: [...lineMap.values()],
    operatingProfit,
    cogsRate: netSales === null ? { status: "missing" } : percent(cogs, netSales),
    laborRate: netSales === null ? { status: "missing" } : percent(labor, netSales),
    operatingMargin: operatingProfit === null ? { status: "missing" } : percent(operatingProfit, netSales!),
    missingCategories: [...new Set(items.flatMap((p) => p.missingCategories))],
    hasEstimatedExpense: items.some((p) => p.hasEstimatedExpense),
    status: items.every((p) => p.status === "confirmed") ? "confirmed" : "estimated",
    reasons: [...new Set(items.flatMap((p) => p.reasons))],
  };
}
