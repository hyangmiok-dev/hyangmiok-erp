import { describe, expect, it } from "vitest";
import {
  checkAll,
  groupByCategory,
  orderDay,
  orderEstimate,
  qtyLabel,
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

describe("아침 입고 확인 (품목 체크 + 총금액)", () => {
  const line = (over: Partial<ReceiveLine> = {}): ReceiveLine => ({
    lineId: "l1",
    itemName: "숙주",
    unit: "박스",
    orderedQty: 5,
    status: null,
    ...over,
  });

  it("체크 안 한 품목·총금액이 없으면 완료 불가", () => {
    expect(receiveProblems([line(), line({ lineId: "l2", status: "ok" })], "", true)).toEqual([
      "아직 체크하지 않은 품목이 1개 있어요.",
      "거래명세표 총금액을 적어 주세요.",
    ]);
    expect(receiveProblems([line({ status: "ok" })], "75000", true)).toEqual([]);
  });

  it("거래처 미정이면 거래처를 골라야 한다", () => {
    expect(receiveProblems([line({ status: "ok" })], "1000", false)[0]).toBe("거래처를 골라 주세요.");
  });

  it("모두 안 왔으면 금액 없이 완료, 금액을 적으면 확인 요청", () => {
    expect(receiveProblems([line({ status: "missing" })], "", true)).toEqual([]);
    expect(receiveProblems([line({ status: "missing" })], "5000", true)[0]).toContain("모두 안 왔는데");
  });

  it("[모두 왔음]은 체크 안 한 품목만 왔음으로, 이미 '안 옴'은 그대로", () => {
    const r = checkAll([line(), line({ lineId: "l2", status: "missing" })]);
    expect(r.map((x) => x.status)).toEqual(["ok", "missing"]);
  });

  it("서버로 보낼 줄", () => {
    expect(toCompleteLines([line({ status: "ok" }), line({ lineId: "l2", status: "missing" })])).toEqual([
      { line_id: "l1", status: "ok" },
      { line_id: "l2", status: "missing" },
    ]);
  });
});