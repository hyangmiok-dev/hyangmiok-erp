import { describe, expect, it } from "vitest";
import { buildPurchaseMatrix, type PurchaseExpense } from "@/lib/purchases";
import { eachDay } from "@/lib/period";
import type { SaleRow } from "@/lib/sales/summary";

const S = "store-1";
const vendors = [
  { id: "v-mni", name: "엠앤아이", sortOrder: 10 },
  { id: "v-cn", name: "씨앤푸드", sortOrder: 20 },
  { id: "v-kh", name: "경희상회", sortOrder: 50 },
];
const exp = (date: string, amount: number, vendorId: string | null, vendor: string | null): PurchaseExpense => ({
  date,
  amount,
  vendorId,
  vendor,
});
const sale = (date: string, netSales: number): SaleRow => ({
  storeId: S,
  date,
  netSales,
  orderCount: 10,
  isClosed: false,
  updatedAt: "",
  updatedBy: null,
  source: "manual",
});

describe("거래처별 월 매입 표", () => {
  const sales = eachDay({ start: "2026-09-01", end: "2026-09-30" }).map((d) => sale(d, 1_000_000)); // 9월 3,000만
  const m = buildPurchaseMatrix({
    year: 2026,
    storeId: S,
    today: "2026-10-13",
    vendors,
    storeVendorIds: ["v-mni", "v-cn", "v-kh"],
    sales,
    expenses: [
      exp("2026-09-03", 6_000_000, "v-mni", "엠앤아이"),
      exp("2026-09-20", 3_000_000, null, "엠앤아이"), // 연결 없지만 이름이 같음 → 같은 행
      exp("2026-09-05", 1_000_000, "v-cn", "씨앤푸드"),
      exp("2026-10-02", 500_000, null, "새로운곳"), // 목록에 없는 거래처
      exp("2026-10-03", 100_000, null, null), // 거래처 미입력
      exp("2025-12-30", 999, "v-mni", "엠앤아이"), // 다른 해 제외
    ],
  });

  it("거래가 없어도 지점 거래처는 행으로 보이고, 정해진 순서대로", () => {
    expect(m.rows.map((r) => r.name)).toEqual(["엠앤아이", "씨앤푸드", "경희상회", "새로운곳", "(거래처 미입력)"]);
    expect(m.rows.find((r) => r.name === "경희상회")?.total).toBe(0);
  });

  it("이름이 같으면 같은 거래처로 합산", () => {
    expect(m.rows[0].months[8]).toBe(9_000_000);
  });

  it("목록에 없는 거래처는 표시해서 구분", () => {
    expect(m.rows.find((r) => r.name === "새로운곳")?.listed).toBe(false);
  });

  it("월 합계와 매입 기준 원가율", () => {
    expect(m.monthTotals[8]).toBe(10_000_000);
    expect(m.rates[8].status).toBe("ok");
    expect(m.rates[8].status === "ok" && Math.round(m.rates[8].value * 10) / 10).toBe(33.3);
  });

  it("매출 미입력 달은 원가율 미입력, 아직 안 온 달은 시작 전", () => {
    expect(m.rates[9].status).toBe("missing"); // 10월 매출 없음
    expect(m.sales[10].started).toBe(false); // 11월
  });

  it("매출이 일부만 입력된 달은 '불완전' 표시", () => {
    const partial = buildPurchaseMatrix({
      year: 2026,
      storeId: S,
      today: "2026-10-13",
      vendors,
      storeVendorIds: [],
      sales: [sale("2026-09-01", 1_000_000)],
      expenses: [exp("2026-09-03", 100_000, "v-mni", null)],
    });
    expect(partial.rates[8]).toMatchObject({ status: "ok", incomplete: true });
  });

  it("연간 비중", () => {
    const total = 6_000_000 + 3_000_000 + 1_000_000 + 500_000 + 100_000;
    expect(m.total).toBe(total);
    expect(m.rows[0].share.status === "ok" && m.rows[0].share.value).toBeCloseTo((9_000_000 / total) * 100);
  });
});
