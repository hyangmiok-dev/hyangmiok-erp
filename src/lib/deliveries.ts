/**
 * 입고 빠른 입력 (순수 함수) — 대표 결정 2026-10-13: 사진 AI 대신, 아침에 물건 받으며 빨리 적기.
 * 거래처를 고르면 전에 받은 품목이 지난 단가와 함께 나오고, 수량만 누르면 된다.
 * 금액 = 수량 × 단가 (원 단위 반올림). 저장할 때 DB 가 다시 계산한다.
 */
import { lineAmount } from "@/lib/payables";

export interface DeliveryItem {
  itemName: string;
  unit: string | null;
  lastPrice: number;
  lastQty: number;
  lastDate: string;
  times: number;
  /** 바로 지난번 입고에 있던 품목 */
  inLast: boolean;
}

export interface DeliveryRow {
  key: string;
  itemName: string;
  unit: string;
  /** 단가 (원, 숫자 문자열) */
  price: string;
  /** 수량 (빈칸 = 이번에 안 받음) */
  qty: string;
  /** 처음 적는 품목 (이름·단위 입력 칸이 보임) */
  isNew: boolean;
  lastQty: number | null;
  lastPrice: number | null;
  lastDate: string | null;
  inLast: boolean;
}

let seq = 0;
const nextKey = () => `r${++seq}`;

export function rowsFromItems(items: DeliveryItem[]): DeliveryRow[] {
  return items.map((i) => ({
    key: nextKey(),
    itemName: i.itemName,
    unit: i.unit ?? "",
    price: String(i.lastPrice),
    qty: "",
    isNew: false,
    lastQty: i.lastQty,
    lastPrice: i.lastPrice,
    lastDate: i.lastDate,
    inLast: i.inLast,
  }));
}

export function newRow(): DeliveryRow {
  return {
    key: nextKey(),
    itemName: "",
    unit: "",
    price: "",
    qty: "",
    isNew: true,
    lastQty: null,
    lastPrice: null,
    lastDate: null,
    inLast: false,
  };
}

/** [지난번과 똑같이]: 지난번에 받은 품목의 수량을 그대로 채운다 (다른 줄은 그대로) */
export function fillLastTime(rows: DeliveryRow[]): DeliveryRow[] {
  return rows.map((r) => (r.inLast && r.lastQty ? { ...r, qty: formatQty(r.lastQty) } : r));
}

export function formatQty(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/** [−] [+] 버튼: 1씩 (소수 수량도 1씩), 0 이하면 빈칸 */
export function stepQty(qty: string, delta: number): string {
  const cur = Number(qty) || 0;
  const next = Math.round((cur + delta) * 1000) / 1000;
  return next <= 0 ? "" : String(next);
}

/** 수량 입력 정리: 숫자와 점만, 소수 셋째 자리까지 */
export function cleanQty(v: string): string {
  const s = v.replace(/[^\d.]/g, "");
  const [a, ...rest] = s.split(".");
  return rest.length ? `${a}.${rest.join("").slice(0, 3)}` : a;
}

export function cleanWon(v: string, maxDigits = 9): string {
  return v.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "").slice(0, maxDigits);
}

export function rowAmount(r: DeliveryRow): number {
  const q = Number(r.qty);
  if (!(q > 0) || r.price === "") return 0;
  return lineAmount(q, Number(r.price));
}

/** 이번에 받은 줄 (수량이 있는 줄) */
export function receivedRows(rows: DeliveryRow[]): DeliveryRow[] {
  return rows.filter((r) => Number(r.qty) > 0);
}

export function deliveryTotal(rows: DeliveryRow[], vat: number): number {
  return receivedRows(rows).reduce((n, r) => n + rowAmount(r), 0) + (vat > 0 ? vat : 0);
}

/** 저장 전 점검: 수량은 넣었는데 이름·단가가 빈 줄 */
export function rowProblems(rows: DeliveryRow[]): string[] {
  const out: string[] = [];
  for (const r of receivedRows(rows)) {
    if (!r.itemName.trim()) out.push("품목 이름이 빈 줄이 있어요.");
    else if (r.price === "") out.push(`'${r.itemName}' 단가를 넣어 주세요.`);
  }
  return [...new Set(out)];
}

/** 서버로 보낼 줄 */
export function toDeliveryLines(rows: DeliveryRow[]): { itemName: string; quantity: string; unit: string; unitPrice: string }[] {
  return receivedRows(rows).map((r) => ({ itemName: r.itemName.trim(), quantity: r.qty, unit: r.unit.trim(), unitPrice: r.price }));
}
