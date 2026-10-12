import { describe, expect, it } from "vitest";
import { combinePnl, computeStorePnl, monthRange, prevMonth, type ExpenseItem } from "@/lib/pnl";
import type { SaleRow } from "@/lib/sales/summary";
import { guessCategoryCode } from "@/lib/expense-hints";
import { eachDay } from "@/lib/period";

const A = "store-a";
const B = "store-b";

function fullMonthSales(store: string, month: string, perDay: number): SaleRow[] {
  return eachDay(monthRange(month)).map((d) => ({
    storeId: store,
    date: d,
    netSales: perDay,
    orderCount: 10,
    isClosed: false,
    updatedAt: "",
    updatedBy: null,
    source: "manual",
  }));
}

const exp = (p: Partial<ExpenseItem> & { amount: number; section: ExpenseItem["section"] }): ExpenseItem => ({
  storeId: A,
  date: "2026-09-15",
  categoryId: p.section,
  categoryName: p.section,
  basis: "actual",
  ...p,
});

const TODAY = "2026-10-13";

describe("월 손익", () => {
  const sales = fullMonthSales(A, "2026-09", 1_000_000); // 30일 × 100만 = 3,000만
  const expenses = [
    exp({ section: "cogs", amount: 9_000_000, categoryId: "food", categoryName: "식재료비" }),
    exp({ section: "labor", amount: 7_500_000, categoryId: "wage", categoryName: "급여" }),
    exp({ section: "opex", amount: 1_100_000, categoryId: "rent", categoryName: "임대료" }),
    exp({ section: "opex", amount: 400_000, categoryId: "util", categoryName: "수도광열비" }),
    exp({ section: "excluded", amount: 2_000_000, categoryId: "tax", categoryName: "세금" }),
  ];

  it("재고 실사가 없으면 매입액=원가, 추정", () => {
    const p = computeStorePnl({ storeId: A, month: "2026-09", today: TODAY, sales, expenses, inventory: [] });
    expect(p.sales.netSales).toBe(30_000_000);
    expect(p.cogs).toBe(9_000_000);
    expect(p.cogsBasis).toBe("estimated");
    expect(p.operatingProfit).toBe(30_000_000 - 9_000_000 - 7_500_000 - 1_500_000); // 세금 제외
    expect(p.cogsRate).toEqual({ status: "ok", value: 30 });
    expect(p.laborRate).toEqual({ status: "ok", value: 25 });
    expect(p.status).toBe("estimated");
    expect(p.reasons[0]).toMatch(/월말 재고 없음/);
  });

  it("기초·기말 재고가 있으면 실제 매출원가, 모두 갖추면 확정", () => {
    const p = computeStorePnl({
      storeId: A,
      month: "2026-09",
      today: TODAY,
      sales,
      expenses,
      inventory: [
        { storeId: A, date: "2026-08-31", amount: 2_000_000 },
        { storeId: A, date: "2026-09-30", amount: 2_500_000 },
      ],
    });
    expect(p.cogs).toBe(2_000_000 + 9_000_000 - 2_500_000);
    expect(p.cogsBasis).toBe("actual");
    expect(p.status).toBe("confirmed");
  });

  it("매출 미입력 → 영업이익·비율은 미입력 (0으로 계산하지 않음)", () => {
    const p = computeStorePnl({ storeId: A, month: "2026-09", today: TODAY, sales: [], expenses, inventory: [] });
    expect(p.operatingProfit).toBeNull();
    expect(p.cogsRate.status).toBe("missing");
    expect(p.reasons).toContain("매출 미입력");
  });

  it("지난달 있던 항목이 이번 달 없으면 경고", () => {
    const last = exp({ section: "opex", amount: 1_100_000, categoryId: "rent", categoryName: "임대료", date: "2026-08-10" });
    const p = computeStorePnl({
      storeId: A,
      month: "2026-09",
      today: TODAY,
      sales,
      expenses: [last, exp({ section: "cogs", amount: 100 })],
      inventory: [],
    });
    expect(p.missingCategories).toEqual(["임대료"]);
  });

  it("추정 금액이 있으면 추정", () => {
    const p = computeStorePnl({
      storeId: A,
      month: "2026-09",
      today: TODAY,
      sales,
      expenses: [exp({ section: "opex", amount: 100, basis: "estimated" })],
      inventory: [
        { storeId: A, date: "2026-08-31", amount: 0 },
        { storeId: A, date: "2026-09-30", amount: 0 },
      ],
    });
    expect(p.status).toBe("estimated");
    expect(p.reasons).toContain("추정 금액 포함");
  });

  it("진행 중인 달은 오늘까지만 매출 완결성을 보고, 추정으로 표시", () => {
    const oct = fullMonthSales(A, "2026-10", 100).filter((s) => s.date <= TODAY);
    const p = computeStorePnl({ storeId: A, month: "2026-10", today: TODAY, sales: oct, expenses: [], inventory: [] });
    expect(p.sales.complete).toBe(true);
    expect(p.reasons).toContain("진행 중인 달");
  });

  it("매출 0원(전부 휴무) → 비율 계산불가", () => {
    const closed = fullMonthSales(A, "2026-09", 0).map((s) => ({ ...s, isClosed: true, orderCount: 0 }));
    const p = computeStorePnl({ storeId: A, month: "2026-09", today: TODAY, sales: closed, expenses, inventory: [] });
    expect(p.cogsRate.status).toBe("not_computable");
  });

  it("여러 지점 합계", () => {
    const pa = computeStorePnl({ storeId: A, month: "2026-09", today: TODAY, sales, expenses, inventory: [] });
    const pb = computeStorePnl({
      storeId: B,
      month: "2026-09",
      today: TODAY,
      sales: fullMonthSales(B, "2026-09", 500_000),
      expenses: [exp({ storeId: B, section: "cogs", amount: 4_500_000, categoryId: "food", categoryName: "식재료비" })],
      inventory: [],
    });
    const t = combinePnl([pa, pb]);
    expect(t.netSales).toBe(45_000_000);
    expect(t.cogs).toBe(13_500_000);
    expect(t.lines.find((l) => l.categoryId === "food")?.amount).toBe(13_500_000);
    expect(t.cogsRate).toEqual({ status: "ok", value: 30 });
  });

  it("월 계산", () => {
    expect(prevMonth("2026-01")).toBe("2025-12");
    expect(monthRange("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });
});

describe("지출 항목 추측 (오입력 방지)", () => {
  it("실제 사례: 거래처에 '임대료' → 임대료 항목", () => {
    expect(guessCategoryCode("임대료")?.code).toBe("rent");
    expect(guessCategoryCode("10월 월세")?.code).toBe("rent");
  });
  it("가장 구체적인 단어 우선 ('건물 관리비' → 관리비)", () => {
    expect(guessCategoryCode("건물 관리비")?.code).toBe("maintenance");
    expect(guessCategoryCode("한전 9월분")?.code).toBe("utilities");
    expect(guessCategoryCode("부가세 2기 예정")?.code).toBe("tax");
  });
  it("모르는 거래처는 추측하지 않음", () => {
    expect(guessCategoryCode("청수상사")).toBeNull();
    expect(guessCategoryCode("")).toBeNull();
  });
});