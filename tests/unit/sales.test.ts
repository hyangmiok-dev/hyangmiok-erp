import { describe, expect, it } from "vitest";
import {
  addDays,
  eachDay,
  endOfMonth,
  isDateKey,
  resolvePeriod,
  sameDaysLastMonth,
  startOfWeek,
} from "@/lib/period";
import { compare, entryWarnings, formatChange, storeAlerts, summarize, type SaleRow } from "@/lib/sales/summary";
import { mapSalesCsv, parseAmountCell, parseCsv, parseDateCell, toCsv } from "@/lib/sales/csv";
import { formatKoreanWon } from "@/lib/format";

const TODAY = "2026-10-13"; // 화요일

describe("기간 계산", () => {
  it("프리셋", () => {
    expect(resolvePeriod("today", TODAY)).toEqual({ start: TODAY, end: TODAY });
    expect(resolvePeriod("yesterday", TODAY)).toEqual({ start: "2026-10-12", end: "2026-10-12" });
    expect(resolvePeriod("last7", TODAY)).toEqual({ start: "2026-10-07", end: TODAY });
    expect(resolvePeriod("thisWeek", TODAY)).toEqual({ start: "2026-10-12", end: TODAY }); // 월요일 시작
    expect(resolvePeriod("thisMonth", TODAY)).toEqual({ start: "2026-10-01", end: TODAY });
    expect(resolvePeriod("lastMonth", TODAY)).toEqual({ start: "2026-09-01", end: "2026-09-30" });
  });
  it("직접 선택: 미래는 오늘로 자르고, 순서가 바뀌면 교정", () => {
    expect(resolvePeriod("custom", TODAY, { from: "2026-10-20", to: "2026-10-01" })).toEqual({
      start: "2026-10-01",
      end: TODAY,
    });
    expect(resolvePeriod("custom", TODAY, { from: "엉터리" }).end).toBe(TODAY);
  });
  it("월말·윤년", () => {
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(startOfWeek("2026-10-18")).toBe("2026-10-12"); // 일요일 → 그 주 월요일
  });
  it("지난달 같은 기간 (31일 → 30일 달 보정)", () => {
    expect(sameDaysLastMonth({ start: "2026-10-01", end: "2026-10-13" })).toEqual({
      start: "2026-09-01",
      end: "2026-09-13",
    });
    expect(sameDaysLastMonth({ start: "2026-10-01", end: "2026-10-31" })).toEqual({
      start: "2026-09-01",
      end: "2026-09-30",
    });
  });
  it("eachDay", () => {
    expect(eachDay({ start: "2026-09-29", end: "2026-10-02" })).toEqual([
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ]);
  });
});

const row = (storeId: string, date: string, netSales: number, orderCount: number, isClosed = false): SaleRow => ({
  storeId,
  date,
  netSales,
  orderCount,
  isClosed,
  updatedAt: "",
  updatedBy: null,
  source: "manual",
});

describe("매출 집계", () => {
  const range = { start: "2026-10-12", end: TODAY };
  it("하나도 입력되지 않으면 0원이 아니라 미입력(null)", () => {
    const s = summarize([], ["A", "B"], range);
    expect(s.netSales).toBeNull();
    expect(s.avgTicket.status).toBe("missing");
    expect(s.missing).toHaveLength(4);
  });
  it("부분 입력: 합계는 입력분만, complete=false", () => {
    const s = summarize([row("A", TODAY, 100_000, 10)], ["A", "B"], range);
    expect(s.netSales).toBe(100_000);
    expect(s.complete).toBe(false);
    expect(s.entered).toBe(1);
  });
  it("휴무는 입력으로 인정되고 일평균에서 제외", () => {
    const s = summarize([row("A", "2026-10-12", 0, 0, true), row("A", TODAY, 300_000, 30)], ["A"], range);
    expect(s.complete).toBe(true);
    expect(s.dailyAverage).toEqual({ status: "ok", value: 300_000 });
    expect(s.avgTicket).toEqual({ status: "ok", value: 10_000 });
  });
  it("건수 0 → 건단가 계산불가", () => {
    const s = summarize([row("A", TODAY, 0, 0, true)], ["A"], { start: TODAY, end: TODAY });
    expect(s.avgTicket.status).toBe("not_computable");
  });
  it("다른 지점·기간 밖 행은 제외", () => {
    const s = summarize([row("Z", TODAY, 999, 1), row("A", "2026-10-01", 999, 1)], ["A"], range);
    expect(s.netSales).toBeNull();
  });
});

describe("증감 비교", () => {
  const d = { start: TODAY, end: TODAY };
  const y = { start: "2026-10-12", end: "2026-10-12" };
  it("양쪽 완전 입력 시 계산", () => {
    const c = compare(summarize([row("A", TODAY, 110, 1)], ["A"], d), summarize([row("A", "2026-10-12", 100, 1)], ["A"], y));
    expect(c.status).toBe("ok");
    expect(c.status === "ok" && c.value).toBeCloseTo(10);
    expect(formatChange(c)).toBe("▲ 10.0%");
  });
  it("한쪽이라도 미입력이면 비교 불가", () => {
    const c = compare(summarize([row("A", TODAY, 110, 1)], ["A", "B"], d), summarize([row("A", "2026-10-12", 100, 1)], ["A", "B"], y));
    expect(formatChange(c)).toBe("비교 불가 (미입력 포함)");
  });
  it("이전 매출 0 → 계산불가", () => {
    const c = compare(summarize([row("A", TODAY, 110, 1)], ["A"], d), summarize([row("A", "2026-10-12", 0, 0, true)], ["A"], y));
    expect(formatChange(c)).toBe("계산불가");
  });
});

describe("경고", () => {
  it("지점 경고", () => {
    const a = storeAlerts({ todayEntered: false, missingLast7: 3, weekChange: { status: "ok", value: -45 } });
    expect(a.map((x) => x.level)).toEqual(["warning", "critical", "critical"]);
  });
  it("입력값 점검", () => {
    expect(entryWarnings({ netSales: 0, orderCount: 0, isClosed: false })[0]).toMatch(/휴무/);
    expect(entryWarnings({ netSales: 12_340_000, orderCount: 87, isClosed: false })[0]).toMatch(/너무 높습니다/);
    expect(entryWarnings({ netSales: 1_234_000, orderCount: 87, isClosed: false, sameWeekdayLastWeek: 1_100_000 })).toEqual([]);
    expect(entryWarnings({ netSales: 1_234_000, orderCount: 87, isClosed: false, sameWeekdayLastWeek: 400_000 })[0]).toMatch(/차이가 큽니다/);
  });
  it("한국식 금액 읽기", () => {
    expect(formatKoreanWon(1_234_000)).toBe("123만 4,000원");
    expect(formatKoreanWon(150_000_000)).toBe("1억 5,000만원");
    expect(formatKoreanWon(null)).toBe("미입력");
  });
});

describe("CSV", () => {
  const stores = [
    { id: "s1", code: "S1", name: "향미옥 1호점" },
    { id: "s2", code: "S2", name: "향미옥 2호점" },
  ];
  it("따옴표·쉼표 포함 금액", () => {
    expect(parseCsv('a,"1,234,000",b\r\nc,d,e')).toEqual([
      ["a", "1,234,000", "b"],
      ["c", "d", "e"],
    ]);
  });
  it("날짜 형식들", () => {
    for (const s of ["2026-10-01", "2026.10.01", "2026/10/1", "2026. 10. 1.", "20261001"]) {
      expect(parseDateCell(s)).toBe("2026-10-01");
    }
    expect(parseDateCell("2026-13-01")).toBeNull();
    expect(parseAmountCell("1,234,000원")).toBe(1234000);
    expect(parseAmountCell("-5")).toBeNull();
    expect(parseAmountCell("12.5")).toBeNull();
  });
  it("행 변환 + 오류 + 중복", () => {
    const text = [
      "날짜,지점,실매출,건수,휴무,메모",
      '2026-10-01,1호점,"1,234,000",87,,',
      "2026-10-01,S2,,,휴무,정기휴무",
      "2026-10-02,4호점,100,1,,",
      "2026-10-01,향미옥 1호점,5,1,,",
      "2026-10-03,1호점,abc,1,,",
    ].join("\n");
    const r = mapSalesCsv(text, stores);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ storeId: "s1", netSales: 1234000, orderCount: 87, line: 2 });
    expect(r.rows[1]).toMatchObject({ storeId: "s2", isClosed: true, netSales: 0, memo: "정기휴무" });
    expect(r.errors.map((e) => e.line)).toEqual([4, 5, 6]);
    expect(r.errors[1].message).toMatch(/2행과 같은/);
  });
  it("필수 열이 없으면 알려줌", () => {
    expect(mapSalesCsv("날짜,지점\n2026-10-01,1호점", stores).missingColumns).toEqual(["실매출", "건수"]);
  });
  it("내보내기: BOM + 따옴표 처리", () => {
    expect(toCsv([["메모", 'a,"b"']])).toBe('﻿메모,"a,""b"""\r\n');
  });
});
