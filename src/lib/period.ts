/**
 * 영업일 기간 계산 (한국 날짜 'YYYY-MM-DD' 문자열 기준).
 * 날짜 산술은 UTC 자정 Date 로만 하므로 시간대 영향이 없다.
 */

export type DateKey = string; // 'YYYY-MM-DD'

export interface DateRange {
  start: DateKey;
  end: DateKey; // 포함
}

export const PERIOD_PRESETS = ["today", "yesterday", "last7", "thisWeek", "thisMonth", "lastMonth", "custom"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_LABEL: Record<PeriodPreset, string> = {
  today: "오늘",
  yesterday: "어제",
  last7: "최근 7일",
  thisWeek: "이번 주",
  thisMonth: "이번 달",
  lastMonth: "지난달",
  custom: "직접 선택",
};

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(v: unknown): v is DateKey {
  if (typeof v !== "string" || !KEY_RE.test(v)) return false;
  const d = toUtc(v);
  return !Number.isNaN(d.getTime()) && fromUtc(d) === v;
}

function toUtc(key: DateKey): Date {
  return new Date(`${key}T00:00:00Z`);
}

function fromUtc(d: Date): DateKey {
  return d.toISOString().slice(0, 10); // UTC 자정 Date 이므로 안전
}

export function addDays(key: DateKey, n: number): DateKey {
  const d = toUtc(key);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

export function daysBetween(a: DateKey, b: DateKey): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

/** 기간에 포함된 날짜 수 */
export function rangeLength(r: DateRange): number {
  return daysBetween(r.start, r.end) + 1;
}

export function eachDay(r: DateRange): DateKey[] {
  const out: DateKey[] = [];
  for (let k = r.start; k <= r.end; k = addDays(k, 1)) out.push(k);
  return out;
}

/** 0=일 ~ 6=토 */
export function weekday(key: DateKey): number {
  return toUtc(key).getUTCDay();
}

export const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function startOfMonth(key: DateKey): DateKey {
  return `${key.slice(0, 7)}-01`;
}

export function endOfMonth(key: DateKey): DateKey {
  const d = toUtc(startOfMonth(key));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return fromUtc(d);
}

/** 월요일 시작 */
export function startOfWeek(key: DateKey): DateKey {
  return addDays(key, -((weekday(key) + 6) % 7));
}

/** 프리셋 → 기간. 미래는 포함하지 않는다(오늘까지). */
export function resolvePeriod(
  preset: PeriodPreset,
  today: DateKey,
  custom?: { from?: string; to?: string },
): DateRange {
  switch (preset) {
    case "today":
      return { start: today, end: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { start: y, end: y };
    }
    case "last7":
      return { start: addDays(today, -6), end: today };
    case "thisWeek":
      return { start: startOfWeek(today), end: today };
    case "thisMonth":
      return { start: startOfMonth(today), end: today };
    case "lastMonth": {
      const lastDay = addDays(startOfMonth(today), -1);
      return { start: startOfMonth(lastDay), end: lastDay };
    }
    case "custom": {
      let from = isDateKey(custom?.from) ? custom!.from! : addDays(today, -6);
      let to = isDateKey(custom?.to) ? custom!.to! : today;
      if (from > to) [from, to] = [to, from];
      if (to > today) to = today;
      if (from > to) from = to;
      // 너무 긴 기간은 1년으로 제한
      if (daysBetween(from, to) > 366) from = addDays(to, -366);
      return { start: from, end: to };
    }
  }
}

/** 지난달 같은 기간: 이번 달 1일~d일 ↔ 지난달 1일~min(d, 지난달 말일) */
export function sameDaysLastMonth(mtd: DateRange): DateRange {
  const lastMonthEnd = addDays(mtd.start, -1);
  const lastMonthStart = startOfMonth(lastMonthEnd);
  const len = rangeLength(mtd);
  const end = addDays(lastMonthStart, len - 1);
  return { start: lastMonthStart, end: end > lastMonthEnd ? lastMonthEnd : end };
}

export function parsePreset(v: unknown): PeriodPreset {
  return (PERIOD_PRESETS as readonly string[]).includes(v as string) ? (v as PeriodPreset) : "today";
}

/** 10. 13.(화) 형식 */
export function shortDateKo(key: DateKey): string {
  return `${Number(key.slice(5, 7))}. ${Number(key.slice(8, 10))}.(${WEEKDAY_KO[weekday(key)]})`;
}

export function rangeLabel(r: DateRange): string {
  return r.start === r.end ? shortDateKo(r.start) : `${shortDateKo(r.start)} ~ ${shortDateKo(r.end)}`;
}
