import { describe, expect, it } from "vitest";
import {
  cleanQty,
  cleanWon,
  deliveryTotal,
  fillLastTime,
  newRow,
  rowAmount,
  rowProblems,
  rowsFromItems,
  stepQty,
  toDeliveryLines,
  type DeliveryItem,
} from "@/lib/deliveries";
import { deliveryInputSchema } from "@/lib/validation/deliveries";

const items: DeliveryItem[] = [
  { itemName: "숙주", unit: "박스", lastPrice: 15000, lastQty: 2, lastDate: "2026-10-12", times: 5, inLast: true },
  { itemName: "차돌양지", unit: "kg", lastPrice: 32000, lastQty: 10, lastDate: "2026-10-01", times: 2, inLast: false },
];

describe("입고 빠른 입력", () => {
  it("전에 받은 품목이 지난 단가와 함께 빈 수량으로 나온다", () => {
    const rows = rowsFromItems(items);
    expect(rows.map((r) => [r.itemName, r.unit, r.price, r.qty])).toEqual([
      ["숙주", "박스", "15000", ""],
      ["차돌양지", "kg", "32000", ""],
    ]);
    expect(deliveryTotal(rows, 0)).toBe(0);
  });

  it("[지난번과 똑같이]는 지난번 입고에 있던 품목만 채운다", () => {
    const rows = fillLastTime(rowsFromItems(items));
    expect(rows.map((r) => r.qty)).toEqual(["2", ""]);
    expect(deliveryTotal(rows, 0)).toBe(30000);
  });

  it("[−][+]는 1씩, 0 이하는 빈칸, 소수 수량도 유지", () => {
    expect(stepQty("", 1)).toBe("1");
    expect(stepQty("1", -1)).toBe("");
    expect(stepQty("", -1)).toBe("");
    expect(stepQty("2.5", 1)).toBe("3.5");
  });

  it("금액 = 수량 × 단가 (원 단위 반올림), 부가세는 합계에 더한다", () => {
    const [a, b] = rowsFromItems(items);
    const rows = [
      { ...a, qty: "2.5" },
      { ...b, qty: "1.333", price: "10000" },
    ];
    expect(rowAmount(rows[0])).toBe(37500);
    expect(rowAmount(rows[1])).toBe(13330);
    expect(deliveryTotal(rows, 5000)).toBe(37500 + 13330 + 5000);
  });

  it("수량을 넣은 새 품목인데 이름·단가가 없으면 저장 전에 알려 준다", () => {
    const blank = { ...newRow(), qty: "1" };
    expect(rowProblems([blank])).toEqual(["품목 이름이 빈 줄이 있어요."]);
    expect(rowProblems([{ ...blank, itemName: "고수" }])).toEqual(["'고수' 단가를 넣어 주세요."]);
    expect(rowProblems([{ ...newRow() }])).toEqual([]); // 수량 없는 빈 줄은 무시
  });

  it("서버로는 수량을 넣은 줄만 보낸다", () => {
    const rows = fillLastTime(rowsFromItems(items));
    expect(toDeliveryLines(rows)).toEqual([{ itemName: "숙주", quantity: "2", unit: "박스", unitPrice: "15000" }]);
  });

  it("입력 정리: 숫자만, 소수 셋째 자리까지", () => {
    expect(cleanQty("2.5678개")).toBe("2.567");
    expect(cleanWon("15,000원")).toBe("15000");
    expect(cleanWon("0012")).toBe("12");
  });
});

describe("입고 저장 입력 검사 (서버)", () => {
  const base = {
    storeId: "11111111-1111-4111-8111-111111111111",
    vendorId: "22222222-2222-4222-8222-222222222222",
    date: "2026-10-13",
    lines: [{ itemName: "숙주", quantity: "2", unit: "박스", unitPrice: "15000" }],
    vat: "",
    onCredit: true,
    memo: "",
  };

  it("정상 입력", () => {
    const r = deliveryInputSchema.safeParse(base);
    expect(r.success).toBe(true);
    expect(r.success && r.data.vat).toBe(0);
    expect(r.success && r.data.lines[0].unit).toBe("박스");
  });

  it("받은 품목이 없거나, '부가세'를 품목으로 넣거나, 단가가 비면 거부", () => {
    expect(deliveryInputSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
    expect(deliveryInputSchema.safeParse({ ...base, lines: [{ ...base.lines[0], itemName: "부가세" }] }).success).toBe(false);
    expect(deliveryInputSchema.safeParse({ ...base, lines: [{ ...base.lines[0], unitPrice: "" }] }).success).toBe(false);
    expect(deliveryInputSchema.safeParse({ ...base, lines: [{ ...base.lines[0], quantity: "0" }] }).success).toBe(false);
    expect(deliveryInputSchema.safeParse({ ...base, vendorId: "" }).success).toBe(false);
  });
});
