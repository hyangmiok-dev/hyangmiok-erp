import { describe, expect, it } from "vitest";
import {
  formatDateKo,
  formatKRW,
  formatPercent,
  percent,
  safeDivide,
  seoulDateKey,
} from "@/lib/format";

describe("금액 표시", () => {
  it("원 단위 천단위 구분", () => {
    expect(formatKRW(1234567)).toBe("1,234,567원");
    expect(formatKRW(0)).toBe("0원");
    expect(formatKRW(-5000)).toBe("-5,000원");
  });
  it("값이 없으면 0원이 아니라 '미입력'", () => {
    expect(formatKRW(null)).toBe("미입력");
    expect(formatKRW(undefined)).toBe("미입력");
  });
});

describe("비율 계산", () => {
  it("정상 계산", () => {
    expect(percent(30, 100)).toEqual({ status: "ok", value: 30 });
    expect(formatPercent(percent(1, 3))).toBe("33.3%");
  });
  it("분모 0 → 계산불가", () => {
    expect(safeDivide(100, 0)).toEqual({ status: "not_computable" });
    expect(formatPercent(percent(100, 0))).toBe("계산불가");
  });
  it("데이터 없음 → 미입력", () => {
    expect(safeDivide(null, 100)).toEqual({ status: "missing" });
    expect(formatPercent(percent(100, undefined))).toBe("미입력");
  });
});

describe("한국시간 날짜", () => {
  it("UTC 15:00 이후는 한국 날짜로 다음날", () => {
    expect(seoulDateKey(new Date("2026-10-12T14:59:59Z"))).toBe("2026-10-12");
    expect(seoulDateKey(new Date("2026-10-12T15:00:00Z"))).toBe("2026-10-13");
  });
  it("YYYY-MM-DD 는 한국 날짜로 표시 (하루 밀림 없음)", () => {
    expect(formatDateKo("2026-10-12")).toContain("10. 12.");
    expect(formatDateKo("2026-10-12")).toContain("(월)");
  });
});
