/**
 * 전표 입력 — 아침에 거래명세표가 오면 거래처마다 맨 아래 '총금액'만 적는다 (순수 함수).
 * 대표 결정 2026-10-13: 텔레그램·앱 발주·품목 체크 대신, 일일정산 앱처럼 거래처 목록 + 금액 칸.
 * 칸에는 쉼표 붙은 글자, 저장은 원 단위 정수. 빈칸 = 0 = 그 날 그 거래처 전표 지우기.
 */
import { addDays, isDateKey, type DateKey } from "@/lib/period";

export const MAX_SLIP_DIGITS = 10; // 9,999,999,999원 (지출 금액 한도)
/** 대표 외에는 오늘부터 7일 전까지 (DB save_slips 와 같음) */
export const SLIP_BACK_DAYS = 7;

export interface SlipRow {
  vendorId: string;
  vendorName: string;
  /** 외상 거래처 → 저장하면 거래처 미수에 쌓인다 */
  onCredit: boolean;
  /** 그 날 적힌 금액 (없으면 null) */
  amount: number | null;
  /** 대표가 [지출 입력]에서 품목 줄을 넣은 전표 → 여기서는 못 고친다 */
  hasLines: boolean;
  enteredBy: string | null;
  enteredAt: string | null;
  /** '10. 14. 오전 8:12' (서버에서 한국 시간으로 만든 글자 — 화면마다 다르게 보이지 않게) */
  enteredLabel: string | null;
}

export interface SlipEntry {
  vendorId: string;
  amount: number;
}

/** 입력 글자 → 숫자만 (앞의 0 제거, 최대 10자리) */
export function digitsOnly(v: string): string {
  return v.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "").slice(0, MAX_SLIP_DIGITS);
}

export function withCommas(digits: string): string {
  return digits ? Number(digits).toLocaleString("ko-KR") : "";
}

/** 칸 글자 → 원 (빈칸은 0) */
export function amountOf(digits: string | undefined): number {
  return digits ? Number(digits) : 0;
}

/** 처음 칸 값 (vendorId → 숫자 글자) */
export function initialValues(rows: SlipRow[]): Record<string, string> {
  return Object.fromEntries(rows.map((r) => [r.vendorId, r.amount ? String(r.amount) : ""]));
}

/** 처음과 달라진 칸만 저장한다 (품목 상세가 붙은 전표는 빼고) */
export function changedEntries(rows: SlipRow[], values: Record<string, string>): SlipEntry[] {
  return rows.flatMap((r) => {
    if (r.hasLines) return [];
    const now = amountOf(values[r.vendorId]);
    return now === (r.amount ?? 0) ? [] : [{ vendorId: r.vendorId, amount: now }];
  });
}

/** 지금 칸에 보이는 합계 */
export function sheetTotal(rows: SlipRow[], values: Record<string, string>): number {
  return rows.reduce((n, r) => n + (r.hasLines ? (r.amount ?? 0) : amountOf(values[r.vendorId])), 0);
}

/** 지울 칸 (전에 금액이 있었는데 비운 곳) — 저장 전에 한 번 더 묻는다 */
export function clearedNames(rows: SlipRow[], entries: SlipEntry[]): string[] {
  const byId = new Map(rows.map((r) => [r.vendorId, r]));
  return entries.filter((e) => e.amount === 0 && (byId.get(e.vendorId)?.amount ?? 0) > 0).map((e) => byId.get(e.vendorId)!.vendorName);
}

/** 고를 수 있는 가장 이른 날짜 (대표는 제한 없음) */
export function earliestSlipDate(today: DateKey, isOwner: boolean): DateKey | null {
  return isOwner ? null : addDays(today, -SLIP_BACK_DAYS);
}

/** ?date= 값 → 쓸 날짜 (형식이 틀리거나, 미래거나, 범위 밖이면 오늘) */
export function pickSlipDate(raw: string | undefined, today: DateKey, isOwner: boolean): DateKey {
  if (!isDateKey(raw) || raw > today) return today;
  const min = earliestSlipDate(today, isOwner);
  return min && raw < min ? today : raw;
}
