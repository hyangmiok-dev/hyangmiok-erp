import { describe, expect, it } from "vitest";
import {
  buildLedger,
  itemPriceHistory,
  lineAmount,
  summarizeItems,
  summarizePayables,
  type LedgerPayment,
  type LedgerPurchase,
} from "@/lib/payables";

const V = "v1";
const S = "s1";
const pur = (id: string, date: string, amount: number, onCredit = true): LedgerPurchase => ({
  id,
  storeId: S,
  vendorId: V,
  date,
  amount,
  onCredit,
  description: null,
  itemsSummary: `품목${id}`,
});
const pay = (id: string, date: string, amount: number, kind: "payment" | "opening" = "payment"): LedgerPayment => ({
  id,
  storeId: S,
  vendorId: V,
  date,
  kind,
  amount,
  method: kind === "payment" ? "transfer" : null,
  memo: null,
});

describe("거래처 원장 (미수 잔액)", () => {
  const ledger = buildLedger(
    [pur("a", "2026-10-02", 300_000), pur("b", "2026-10-05", 200_000), pur("c", "2026-10-05", 50_000, false)],
    [pay("o", "2026-10-01", 1_000_000, "opening"), pay("p", "2026-10-05", 800_000)],
  );

  it("이월 + 외상 매입 − 결제, 날짜순 누적", () => {
    expect(ledger.map((e) => [e.type, e.balance])).toEqual([
      ["opening", 1_000_000],
      ["purchase", 1_300_000],
      ["purchase", 1_500_000],
      ["purchase_paid", 1_500_000], // 바로 결제 — 잔액 그대로
      ["payment", 700_000],
    ]);
  });

  it("같은 날은 매입을 먼저, 결제를 나중에", () => {
    const d5 = ledger.filter((e) => e.date === "2026-10-05").map((e) => e.type);
    expect(d5.indexOf("payment")).toBeGreaterThan(d5.indexOf("purchase"));
  });

  it("바로 결제한 매입은 참고 금액으로만", () => {
    expect(ledger.find((e) => e.type === "purchase_paid")?.paidNow).toBe(50_000);
  });

  it("결제 라벨에 방법 표시", () => {
    expect(ledger.find((e) => e.type === "payment")?.label).toBe("결제 (계좌이체)");
  });
});

describe("지점의 거래처별 미수 요약", () => {
  const s = summarizePayables({
    vendorIds: [V, "v-empty"],
    month: "2026-10",
    purchases: [pur("a", "2026-09-28", 100_000), pur("b", "2026-10-02", 300_000), pur("c", "2026-10-03", 40_000, false)],
    payments: [pay("p", "2026-10-10", 250_000)],
  });
  const v1 = s.find((x) => x.vendorId === V)!;

  it("잔액·이번 달 외상·이번 달 결제·바로 결제", () => {
    expect(v1).toMatchObject({
      balance: 150_000,
      monthCredit: 300_000,
      monthPaidNow: 40_000,
      monthPayments: 250_000,
      lastPaymentDate: "2026-10-10",
      lastPurchaseDate: "2026-10-03",
      hasActivity: true,
    });
  });

  it("거래가 없는 거래처도 0으로 나온다", () => {
    expect(s.find((x) => x.vendorId === "v-empty")).toMatchObject({ balance: 0, hasActivity: false });
  });

  it("결제가 더 많으면 음수(선결제)로 보인다", () => {
    const r = summarizePayables({ vendorIds: [V], month: "2026-10", purchases: [], payments: [pay("p", "2026-10-01", 5000)] });
    expect(r[0].balance).toBe(-5000);
  });
});

describe("품목 단가 변동", () => {
  const h = itemPriceHistory([
    { date: "2026-09-01", itemName: "차돌양지", unit: "kg", quantity: 10, unitPrice: 30000 },
    { date: "2026-09-15", itemName: "차돌양지", unit: "kg", quantity: 10, unitPrice: 30000 },
    { date: "2026-10-02", itemName: "차돌양지", unit: "kg", quantity: 12, unitPrice: 32000 },
    { date: "2026-10-02", itemName: "숙주", unit: "박스", quantity: 2, unitPrice: 15000 },
  ]);

  it("최근 단가와 직전(다른) 단가, 변동률", () => {
    const c = h.find((x) => x.itemName === "차돌양지")!;
    expect(c).toMatchObject({ latestPrice: 32000, previousPrice: 30000, previousDate: "2026-09-15", timesBought: 3 });
    expect(c.change.status === "ok" && Math.round(c.change.value * 10) / 10).toBe(6.7);
  });

  it("한 번만 산 품목은 변동 없음", () => {
    expect(h.find((x) => x.itemName === "숙주")?.change.status).toBe("missing");
  });

  it("거래명세표의 '부가세' 줄은 품목 단가표에 넣지 않는다", () => {
    const v = itemPriceHistory([
      { date: "2026-10-02", itemName: "부가세", unit: null, quantity: 1, unitPrice: 5000 },
      { date: "2026-10-02", itemName: "소스", unit: "개", quantity: 2, unitPrice: 10000 },
    ]);
    expect(v.map((x) => x.itemName)).toEqual(["소스"]);
  });
});

describe("품목 줄 도우미", () => {
  it("요약", () => {
    expect(summarizeItems([{ itemName: "차돌양지", quantity: 10, unit: "kg" }])).toBe("차돌양지 10kg");
    expect(
      summarizeItems([
        { itemName: "차돌양지", quantity: 10.5, unit: "kg" },
        { itemName: "숙주", quantity: 2, unit: "박스" },
      ]),
    ).toBe("차돌양지 10.5kg 외 1건");
    expect(summarizeItems([])).toBeNull();
  });
  it("금액 = 수량 × 단가 (원 단위 반올림)", () => {
    expect(lineAmount(10, 32000)).toBe(320000);
    expect(lineAmount(1.235, 10000)).toBe(12350);
    expect(lineAmount(0.333, 1000)).toBe(333);
  });
});
