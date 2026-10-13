import { describe, expect, it } from "vitest";
import {
  groupByCategory,
  lineChanges,
  orderDay,
  orderEstimate,
  qtyLabel,
  receiptTotal,
  receiveProblems,
  stepDown,
  stepUp,
  toCompleteLines,
  type ReceiveLine,
} from "@/lib/orders";

describe("발주", () => {
  it("밤 9시(한국) 전엔 오늘, 9시부터는 내일 발주", () => {
    expect(orderDay(new Date("2026-10-13T11:59:00Z"))).toBe("2026-10-13"); // 20:59 KST
    expect(orderDay(new Date("2026-10-13T12:00:00Z"))).toBe("2026-10-14"); // 21:00 KST
    expect(orderDay(new Date("2026-10-13T15:30:00Z"))).toBe("2026-10-14"); // 00:30 KST 다음 날 → 그날
  });

  it("[+] 처음엔 평소 수량, 다음부터 한 번에 늘리는 양 / [−] 0 이하면 빼기", () => {
    const sagol = { defaultQty: 20, step: 10 };
    expect(stepUp(0, sagol)).toBe(20);
    expect(stepUp(20, sagol)).toBe(30);
    expect(stepDown(20, sagol)).toBe(10);
    expect(stepDown(10, sagol)).toBe(0);
    expect(stepUp(0, { defaultQty: 1.5, step: 0.5 })).toBe(1.5);
  });

  it("텔레그램과 같은 수량 표시", () => {
    expect(qtyLabel(2, "박스")).toBe("2박스");
    expect(qtyLabel(1, null)).toBe("");
    expect(qtyLabel(500, "g")).toBe("500g");
    expect(qtyLabel(1.5, "키로")).toBe("1.5키로");
  });

  it("예상 금액: 단가 모르는 품목은 따로 센다", () => {
    expect(orderEstimate([{ qty: 2, unitPrice: 32000 }, { qty: 1, unitPrice: null }])).toEqual({ total: 64000, unknown: 1 });
  });

  it("분류는 정해진 순서, 안에서는 순서·이름순", () => {
    const g = groupByCategory([
      { category: "야채", sortOrder: 2, name: "숙주" },
      { category: "고기", sortOrder: 1, name: "차돌양지" },
      { category: "야채", sortOrder: 1, name: "대파" },
      { category: "새분류", sortOrder: 1, name: "기타" },
    ]);
    expect(g.map((x) => x.category)).toEqual(["고기", "야채", "새분류"]);
    expect(g[1].items.map((x) => x.name)).toEqual(["대파", "숙주"]);
  });
});

describe("아침 입고 확인", () => {
  const base = (over: Partial<ReceiveLine> = {}): ReceiveLine => ({
    lineId: "l1",
    itemName: "숙주",
    unit: "박스",
    orderedQty: 5,
    price: 15000,
    status: null,
    qty: "5",
    newPrice: "15000",
    ...over,
  });

  it("확인 안 한 줄이 있으면 완료 불가", () => {
    expect(receiveProblems([base(), base({ lineId: "l2", status: "ok" })])).toEqual(["아직 확인하지 않은 품목이 1개 있어요."]);
    expect(receiveProblems([base({ status: "ok" })])).toEqual([]);
  });

  it("단가 모르는 품목은 [같음] 불가, [다름]에서 단가를 적어야 한다", () => {
    expect(receiveProblems([base({ status: "ok", price: null })])[0]).toContain("단가를 몰라요");
    expect(receiveProblems([base({ status: "changed", price: null, newPrice: "" })])[0]).toContain("단가를 적어");
  });

  it("합계: 같음=발주대로, 다름=적은 수량×단가, 안 옴=0, 부가세 더하기", () => {
    const lines = [
      base({ status: "ok" }), // 75,000
      base({ lineId: "l2", itemName: "차돌양지", orderedQty: 2, price: 32000, status: "changed", qty: "2", newPrice: "33000" }), // 66,000
      base({ lineId: "l3", itemName: "고수", orderedQty: 2, price: 3000, status: "missing" }), // 0
    ];
    expect(receiptTotal(lines, 0)).toBe(141000);
    expect(receiptTotal(lines, 5000)).toBe(146000);
  });

  it("바뀐 것 표시: 단가 ▲, 수량 다름", () => {
    expect(lineChanges(base({ status: "changed", newPrice: "16000" }))).toEqual({ priceChanged: true, qtyChanged: false });
    expect(lineChanges(base({ status: "changed", qty: "4" }))).toEqual({ priceChanged: false, qtyChanged: true });
    expect(lineChanges(base({ status: "ok" }))).toEqual({ priceChanged: false, qtyChanged: false });
  });

  it("서버로 보낼 줄: 다름만 수량·단가를 같이 보낸다", () => {
    expect(
      toCompleteLines([
        base({ status: "ok" }),
        base({ lineId: "l2", status: "changed", qty: "4", newPrice: "16000" }),
        base({ lineId: "l3", status: "missing" }),
      ]),
    ).toEqual([
      { line_id: "l1", status: "ok" },
      { line_id: "l2", status: "changed", qty: "4", price: "16000" },
      { line_id: "l3", status: "missing" },
    ]);
  });
});
