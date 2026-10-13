/**
 * 발주 · 입고 확인 (순수 함수) — 대표 결정 2026-10-13: 구글폼 발주판을 앱으로.
 * 저녁: 체크(평소 수량) → [발주 완료] → 밤 9시 텔레그램 (9시 이후 발주는 다음 날로)
 * 아침: 품목마다 왔음/안 옴 체크 → 모든 품목 체크 + 거래처 총금액만 입력 → [입고 완료] (금액은 미수로 쌓임)
 */
import { lineAmount } from "@/lib/payables";
import { addDays, type DateKey } from "@/lib/period";
import { seoulDateKey } from "@/lib/format";

export const SEND_HOUR = 21;

/** 지금 발주하면 텔레그램으로 가는 날 (한국 시간 밤 9시 이후면 다음 날) — DB app.order_day() 와 같은 규칙 */
export function orderDay(now: Date = new Date()): DateKey {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", hour: "numeric", hourCycle: "h23" }).format(now));
  const today = seoulDateKey(now);
  return hour >= SEND_HOUR ? addDays(today, 1) : today;
}

export function fmtQty(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/** 텔레그램과 같은 모양: '차돌양지 2박스', 단위 없는 1개는 이름만 */
export function qtyLabel(qty: number, unit: string | null): string {
  if (!unit && qty === 1) return "";
  return `${fmtQty(qty)}${unit ?? ""}`;
}

export interface OrderItem {
  id: string;
  category: string;
  name: string;
  unit: string | null;
  defaultQty: number;
  step: number;
  unitPrice: number | null;
  vendorId: string | null;
  vendorName: string | null;
  sortOrder: number;
  isActive: boolean;
}

export const CATEGORY_ORDER = ["식자재", "고기", "야채", "면", "택배주문", "방앗간", "쿠팡", "포장용기", "네이버", "음료", "주류", "마트"];

export function groupByCategory<T extends { category: string; sortOrder: number; name: string }>(items: T[]): { category: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const i of items) map.set(i.category, [...(map.get(i.category) ?? []), i]);
  const rank = (c: string) => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i < 0 ? 99 : i;
  };
  return [...map.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0], "ko"))
    .map(([category, list]) => ({ category, items: [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ko")) }));
}

/** [+]: 처음이면 평소 수량, 그다음부터 한 번에 늘리는 양만큼 */
export function stepUp(qty: number, item: Pick<OrderItem, "defaultQty" | "step">): number {
  return qty > 0 ? Math.round((qty + item.step) * 1000) / 1000 : item.defaultQty;
}

/** [−]: 한 번에 줄이는 양만큼, 0 이하면 빼기(0) */
export function stepDown(qty: number, item: Pick<OrderItem, "step">): number {
  const next = Math.round((qty - item.step) * 1000) / 1000;
  return next > 0 ? next : 0;
}

/** 예상 금액 (단가 모르는 품목은 빼고, 몇 개 모르는지 같이) */
export function orderEstimate(selected: { qty: number; unitPrice: number | null }[]): { total: number; unknown: number } {
  let total = 0;
  let unknown = 0;
  for (const s of selected) {
    if (s.unitPrice === null) unknown++;
    else total += lineAmount(s.qty, s.unitPrice);
  }
  return { total, unknown };
}

// ---------------------------------------------------------------------
// 아침 입고 확인: 품목 체크(왔음/안 옴) + 거래처 총금액 (대표 결정 2026-10-13)
// ---------------------------------------------------------------------

export type CheckStatus = "ok" | "missing";

export interface ReceiveLine {
  lineId: string;
  itemName: string;
  unit: string | null;
  orderedQty: number;
  status: CheckStatus | null;
}

/** 완료 전 남은 일 (빈 배열이면 완료 가능) */
export function receiveProblems(lines: ReceiveLine[], amount: string, vendorChosen: boolean): string[] {
  const out: string[] = [];
  if (!vendorChosen) out.push("거래처를 골라 주세요.");
  const unchecked = lines.filter((l) => l.status === null).length;
  if (unchecked) out.push(`아직 체크하지 않은 품목이 ${unchecked}개 있어요.`);
  const received = lines.some((l) => l.status === "ok");
  const n = amount === "" ? null : Number(amount);
  if (received && !(n !== null && n > 0)) out.push("거래명세표 총금액을 적어 주세요.");
  if (!received && !unchecked && n !== null && n > 0) out.push("모두 안 왔는데 금액이 있어요. 다시 확인해 주세요.");
  return out;
}

export function toCompleteLines(lines: ReceiveLine[]): { line_id: string; status: CheckStatus }[] {
  return lines.map((l) => ({ line_id: l.lineId, status: l.status ?? "ok" }));
}

/** [모두 왔음] */
export function checkAll(lines: ReceiveLine[]): ReceiveLine[] {
  return lines.map((l) => ({ ...l, status: l.status ?? "ok" }));
}