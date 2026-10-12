/**
 * 매출 집계 (순수 함수).
 * 원칙: 입력되지 않은 날은 0 이 아니다. 기간·지점 중 하나라도 미입력이면 '부분 합계'로 표시하고,
 * 증감률 비교는 양쪽 모두 완전히 입력된 경우에만 계산한다.
 */
import { eachDay, type DateKey, type DateRange } from "@/lib/period";
import { percent, safeDivide, type Ratio } from "@/lib/format";

export interface SaleRow {
  storeId: string;
  date: DateKey;
  netSales: number;
  orderCount: number;
  isClosed: boolean;
  updatedAt: string;
  updatedBy: string | null;
  source: "manual" | "csv" | "pos";
}

export interface Summary {
  /** 입력된 날의 실매출 합계. 하나도 입력되지 않았으면 null(미입력) */
  netSales: number | null;
  orderCount: number | null;
  /** 건단가 = 매출 ÷ 건수 */
  avgTicket: Ratio;
  /** 영업일 평균 매출 (휴무 제외) */
  dailyAverage: Ratio;
  expected: number; // 지점 × 일수
  entered: number; // 입력(휴무 포함)된 칸 수
  closedDays: number;
  complete: boolean;
  missing: { storeId: string; date: DateKey }[];
}

export function summarize(rows: SaleRow[], storeIds: string[], range: DateRange): Summary {
  const days = eachDay(range);
  const stores = new Set(storeIds);
  const byKey = new Map<string, SaleRow>();
  for (const r of rows) {
    if (stores.has(r.storeId) && r.date >= range.start && r.date <= range.end) byKey.set(`${r.storeId}|${r.date}`, r);
  }

  let net = 0;
  let orders = 0;
  let closed = 0;
  const missing: Summary["missing"] = [];
  for (const storeId of storeIds) {
    for (const date of days) {
      const r = byKey.get(`${storeId}|${date}`);
      if (!r) {
        missing.push({ storeId, date });
        continue;
      }
      net += r.netSales;
      orders += r.orderCount;
      if (r.isClosed) closed++;
    }
  }

  const entered = byKey.size;
  const openDays = entered - closed;
  return {
    netSales: entered ? net : null,
    orderCount: entered ? orders : null,
    avgTicket: entered ? safeDivide(net, orders) : { status: "missing" },
    dailyAverage: entered ? safeDivide(net, openDays) : { status: "missing" },
    expected: storeIds.length * days.length,
    entered,
    closedDays: closed,
    complete: storeIds.length > 0 && entered === storeIds.length * days.length,
    missing,
  };
}

export type Change = Ratio | { status: "incomplete" };

/** 증감률(%). 양쪽 모두 완전히 입력된 경우만 계산 */
export function compare(current: Summary, previous: Summary): Change {
  if (!current.complete || !previous.complete) return { status: "incomplete" };
  if (current.netSales === null || previous.netSales === null) return { status: "missing" };
  return percent(current.netSales - previous.netSales, previous.netSales);
}

export function formatChange(c: Change): string {
  switch (c.status) {
    case "incomplete":
      return "비교 불가 (미입력 포함)";
    case "missing":
      return "미입력";
    case "not_computable":
      return "계산불가";
    case "ok": {
      const v = Math.round(c.value * 10) / 10;
      return `${v > 0 ? "▲" : v < 0 ? "▼" : ""} ${Math.abs(v).toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`.trim();
    }
  }
}

export interface StoreAlert {
  level: "warning" | "critical";
  message: string;
}

/** 지점별 경고 */
export function storeAlerts(opts: {
  todayEntered: boolean;
  missingLast7: number;
  weekChange: Change;
}): StoreAlert[] {
  const out: StoreAlert[] = [];
  if (!opts.todayEntered) out.push({ level: "warning", message: "오늘 매출 미입력" });
  if (opts.missingLast7 > 0) {
    out.push({
      level: opts.missingLast7 >= 3 ? "critical" : "warning",
      message: `최근 7일 중 ${opts.missingLast7}일 미입력`,
    });
  }
  if (opts.weekChange.status === "ok" && opts.weekChange.value <= -20) {
    out.push({
      level: opts.weekChange.value <= -40 ? "critical" : "warning",
      message: `최근 7일 매출이 전주보다 ${Math.abs(Math.round(opts.weekChange.value))}% 감소`,
    });
  }
  return out;
}

/** 입력값 점검 경고 (저장은 가능, 확인 유도) */
export function entryWarnings(v: {
  netSales: number;
  orderCount: number;
  isClosed: boolean;
  sameWeekdayLastWeek?: number | null;
}): string[] {
  if (v.isClosed) return [];
  const w: string[] = [];
  if (v.netSales === 0) w.push("매출이 0원입니다. 쉬는 날이면 '휴무'를 체크하세요.");
  if (v.netSales > 0 && v.orderCount === 0) w.push("매출은 있는데 건수가 0입니다.");
  if (v.netSales > 0 && v.orderCount > 0) {
    const ticket = v.netSales / v.orderCount;
    if (ticket < 5_000) w.push(`건당 ${Math.round(ticket).toLocaleString("ko-KR")}원으로 너무 낮습니다. 숫자를 다시 확인하세요.`);
    if (ticket > 100_000) w.push(`건당 ${Math.round(ticket).toLocaleString("ko-KR")}원으로 너무 높습니다. 0을 더 붙이지 않았는지 확인하세요.`);
  }
  const prev = v.sameWeekdayLastWeek;
  if (prev && prev > 0 && v.netSales > 0) {
    const ratio = v.netSales / prev;
    if (ratio >= 2 || ratio <= 0.5) {
      w.push(`지난주 같은 요일(${prev.toLocaleString("ko-KR")}원)과 차이가 큽니다. 숫자를 다시 확인하세요.`);
    }
  }
  return w;
}
