/**
 * 발주 · 입고 확인 (순수 함수) — 대표 결정 2026-10-13: 구글폼 발주판을 앱으로.
 * 저녁: 체크(평소 수량) → [발주 완료] → 밤 9시 텔레그램 (9시 이후 발주는 다음 날로)
 * 아침: 줄마다 같음/다름/안 옴 → 모든 줄 확인 + 영수증 합계 비교 → [입고 완료]
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
// 아침 입고 확인
// ---------------------------------------------------------------------

export type CheckStatus = "ok" | "changed" | "missing";

export interface ReceiveLine {
  lineId: string;
  itemName: string;
  unit: string | null;
  orderedQty: number;
  /** 발주 때 단가 (모르면 null) */
  price: number | null;
  status: CheckStatus | null;
  /** '다름'일 때 실제 받은 수량·단가 (문자열 입력) */
  qty: string;
  newPrice: string;
}

export function receivedQty(l: ReceiveLine): number {
  if (l.status === "missing") return 0;
  if (l.status === "changed") return Number(l.qty) || 0;
  return l.orderedQty;
}

export function receivedPrice(l: ReceiveLine): number | null {
  if (l.status === "changed") return l.newPrice === "" ? null : Number(l.newPrice);
  return l.price;
}

export function receiveLineAmount(l: ReceiveLine): number {
  const p = receivedPrice(l);
  const q = receivedQty(l);
  if (p === null || q <= 0) return 0;
  return lineAmount(q, p);
}

export function receiptTotal(lines: ReceiveLine[], vat: number): number {
  return lines.reduce((n, l) => n + receiveLineAmount(l), 0) + (vat > 0 ? vat : 0);
}

/** 완료 전 남은 일 (빈 배열이면 완료 가능) */
export function receiveProblems(lines: ReceiveLine[]): string[] {
  const out: string[] = [];
  const unchecked = lines.filter((l) => l.status === null).length;
  if (unchecked) out.push(`아직 확인하지 않은 품목이 ${unchecked}개 있어요.`);
  for (const l of lines) {
    if (l.status === "changed") {
      if (!(Number(l.qty) >= 0) || l.qty === "") out.push(`'${l.itemName}' 받은 수량을 적어 주세요.`);
      if (l.newPrice === "") out.push(`'${l.itemName}' 단가를 적어 주세요.`);
    }
    if (l.status === "ok" && l.price === null) out.push(`'${l.itemName}'은 단가를 몰라요. [다름]을 눌러 영수증 단가를 적어 주세요.`);
  }
  return out;
}

/** 단가·수량이 발주와 달라진 줄 (화면 표시용) */
export function lineChanges(l: ReceiveLine): { priceChanged: boolean; qtyChanged: boolean } {
  if (l.status !== "changed") return { priceChanged: false, qtyChanged: false };
  return {
    priceChanged: l.newPrice !== "" && Number(l.newPrice) !== l.price,
    qtyChanged: l.qty !== "" && Number(l.qty) !== l.orderedQty,
  };
}

export type CompleteLine =
  | { line_id: string; status: "ok" }
  | { line_id: string; status: "missing" }
  | { line_id: string; status: "changed"; qty: string; price: string };

export function toCompleteLines(lines: ReceiveLine[]): CompleteLine[] {
  return lines.map((l): CompleteLine =>
    l.status === "changed"
      ? { line_id: l.lineId, status: "changed", qty: l.qty, price: l.newPrice }
      : l.status === "missing"
        ? { line_id: l.lineId, status: "missing" }
        : { line_id: l.lineId, status: "ok" },
  );
}
