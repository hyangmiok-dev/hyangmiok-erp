import { describe, expect, it } from "vitest";
import { expenseInputSchema } from "@/lib/validation/expenses";

const U = "11111111-1111-4111-8111-111111111111";
const base = {
  storeId: U,
  expenseDate: "2026-10-13",
  categoryId: U,
  vendor: "엠앤아이",
  vendorId: U,
  description: "",
  amount: "0",
  basis: "actual",
  onCredit: true,
  lines: [] as unknown[],
};
const line = (o: Partial<Record<string, string>> = {}) => ({
  itemName: "차돌양지",
  quantity: "10",
  unit: "kg",
  unitPrice: "32,000",
  amount: "320,000",
  ...o,
});

describe("지출 + 품목 검증", () => {
  it("품목이 있으면 금액은 품목 합계로 다시 계산된다 (화면 값을 믿지 않음)", () => {
    const r = expenseInputSchema.safeParse({
      ...base,
      amount: "1",
      lines: [line(), line({ itemName: "숙주", quantity: "2", unit: "박스", unitPrice: "15000", amount: "30000" })],
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.amount).toBe(350000);
    expect(r.success && r.data.lines[0]).toMatchObject({ itemName: "차돌양지", quantity: 10, unit: "kg", unitPrice: 32000 });
  });

  it("품목이 없으면 입력한 금액 그대로", () => {
    const r = expenseInputSchema.safeParse({ ...base, amount: "1,100,000" });
    expect(r.success && r.data.amount).toBe(1100000);
  });

  it("수량은 소수점 3자리까지, 0 이하 거부", () => {
    expect(expenseInputSchema.safeParse({ ...base, lines: [line({ quantity: "1.25", amount: "40000" })] }).success).toBe(true);
    expect(expenseInputSchema.safeParse({ ...base, lines: [line({ quantity: "1.2345" })] }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ ...base, lines: [line({ quantity: "0" })] }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ ...base, lines: [line({ quantity: "abc" })] }).success).toBe(false);
  });

  it("품목 이름은 필수", () => {
    const r = expenseInputSchema.safeParse({ ...base, lines: [line({ itemName: " " })] });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path.slice(0, 3)).toEqual(["lines", 0, "itemName"]);
  });

  it("외상인데 거래처 이름이 없으면 거부", () => {
    const r = expenseInputSchema.safeParse({ ...base, vendor: "", amount: "1000" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["vendor"]);
  });

  it("품목 줄이 깨진 데이터면 거부", () => {
    expect(expenseInputSchema.safeParse({ ...base, lines: "invalid" }).success).toBe(false);
  });
});
