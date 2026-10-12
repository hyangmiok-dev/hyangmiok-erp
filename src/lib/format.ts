/**
 * 한국어 표시 형식 + 계산 안전장치.
 * - 금액은 원(KRW) 정수로 다룬다. DB 도 bigint(원) 로 저장한다.
 * - 값이 없으면 0 이 아니라 '미입력' 으로 표시한다.
 * - 0 으로 나누면 '계산불가' 로 표시한다.
 * - 날짜/시간은 항상 Asia/Seoul 기준.
 */

export const TIME_ZONE = "Asia/Seoul";
export const MISSING_LABEL = "미입력";
export const NOT_COMPUTABLE_LABEL = "계산불가";

const krw = new Intl.NumberFormat("ko-KR");

export function formatKRW(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return MISSING_LABEL;
  return `${krw.format(Math.round(value))}원`;
}

export function formatNumber(value: number | null | undefined, maxFractionDigits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return MISSING_LABEL;
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: maxFractionDigits }).format(value);
}

/** 계산 결과: 값 / 데이터 없음 / 0 으로 나눔 */
export type Ratio =
  | { status: "ok"; value: number }
  | { status: "missing" }
  | { status: "not_computable" };

/** 분자·분모 중 하나라도 없으면 missing, 분모가 0 이면 not_computable. */
export function safeDivide(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): Ratio {
  if (numerator == null || denominator == null || Number.isNaN(numerator) || Number.isNaN(denominator)) {
    return { status: "missing" };
  }
  if (denominator === 0) return { status: "not_computable" };
  return { status: "ok", value: numerator / denominator };
}

export function percent(numerator: number | null | undefined, denominator: number | null | undefined): Ratio {
  const r = safeDivide(numerator, denominator);
  return r.status === "ok" ? { status: "ok", value: r.value * 100 } : r;
}

export function formatRatio(r: Ratio, opts: { suffix?: string; digits?: number } = {}): string {
  if (r.status === "missing") return MISSING_LABEL;
  if (r.status === "not_computable") return NOT_COMPUTABLE_LABEL;
  const digits = opts.digits ?? 1;
  return `${r.value.toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${opts.suffix ?? ""}`;
}

export function formatPercent(r: Ratio, digits = 1): string {
  return formatRatio(r, { suffix: "%", digits });
}

// ---------------------------------------------------------------------
// 날짜 (Asia/Seoul)
// ---------------------------------------------------------------------

/** 한국 시간 기준 'YYYY-MM-DD' (영업일 키로 사용) */
export function seoulDateKey(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** 2026. 10. 12.(월) 형식 */
export function formatDateKo(value: Date | string | null | undefined): string {
  if (!value) return MISSING_LABEL;
  const d = typeof value === "string" ? parseDateInput(value) : value;
  if (!d) return MISSING_LABEL;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(d);
}

/** 2026. 10. 12. 오후 3:05 형식 */
export function formatDateTimeKo(value: Date | string | null | undefined): string {
  if (!value) return MISSING_LABEL;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return MISSING_LABEL;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/** 'YYYY-MM-DD' 는 한국 날짜로 해석(자정 KST). 타임스탬프 문자열은 그대로 파싱. */
function parseDateInput(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+09:00`) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
