import { describe, expect, it } from "vitest";
import {
  changedEntries,
  clearedNames,
  digitsOnly,
  earliestSlipDate,
  initialValues,
  pickSlipDate,
  sheetTotal,
  withCommas,
  type SlipRow,
} from "@/lib/slips";
import { slipsInputSchema } from "@/lib/validation/slips";

const row = (over: Partial<SlipRow> = {}): SlipRow => ({
  vendorId: "v1",
  vendorName: "엠앤아이",
  onCredit: true,
  amount: null,
  hasLines: false,
  enteredBy: null,
  enteredAt: null,
  enteredLabel: null,
  ...over,
});

describe("전표 입력 칸", () => {
  it("숫자만 남기고 쉼표로 보여 준다 (최대 10자리)", () => {
    expect(digitsOnly("75,000원")).toBe("75000");
    expect(digitsOnly("007")).toBe("7");
    expect(digitsOnly("123456789012")).toBe("1234567890");
    expect(withCommas("1234000")).toBe("1,234,000");
    expect(withCommas("")).toBe("");
  });

  it("바뀐 칸만 저장, 빈칸은 0(지우기), 품목 상세가 붙은 전표는 빼고", () => {
    const rows = [
      row({ vendorId: "a", amount: 75000 }),
      row({ vendorId: "b" }),
      row({ vendorId: "c", amount: 30000 }),
      row({ vendorId: "d", amount: 64000, hasLines: true }),
    ];
    const values = { ...initialValues(rows), b: "120000", c: "", d: "1" };
    expect(initialValues(rows)).toEqual({ a: "75000", b: "", c: "30000", d: "64000" });
    expect(changedEntries(rows, values)).toEqual([
      { vendorId: "b", amount: 120000 },
      { vendorId: "c", amount: 0 },
    ]);
    expect(changedEntries(rows, initialValues(rows))).toEqual([]);
    expect(sheetTotal(rows, values)).toBe(75000 + 120000 + 64000);
    expect(clearedNames([...rows.slice(0, 2), row({ vendorId: "c", vendorName: "씨앤푸드", amount: 30000 })], changedEntries(rows, values))).toEqual([
      "씨앤푸드",
    ]);
  });

  it("날짜: 미래·형식 오류는 오늘, 대표 외에는 7일 전까지", () => {
    const today = "2026-10-13";
    expect(earliestSlipDate(today, false)).toBe("2026-10-06");
    expect(earliestSlipDate(today, true)).toBeNull();
    expect(pickSlipDate(undefined, today, false)).toBe(today);
    expect(pickSlipDate("2026-10-14", today, true)).toBe(today);
    expect(pickSlipDate("2026-02-30", today, true)).toBe(today);
    expect(pickSlipDate("2026-10-06", today, false)).toBe("2026-10-06");
    expect(pickSlipDate("2026-10-05", today, false)).toBe(today);
    expect(pickSlipDate("2026-09-01", today, true)).toBe("2026-09-01");
  });

  it("서버 검사: 정수 금액·같은 거래처 두 번 금지", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const base = { storeId: id, date: "2026-10-13" };
    expect(slipsInputSchema.safeParse({ ...base, entries: [{ vendorId: id, amount: 75000 }] }).success).toBe(true);
    expect(slipsInputSchema.safeParse({ ...base, entries: [{ vendorId: id, amount: 1.5 }] }).success).toBe(false);
    expect(slipsInputSchema.safeParse({ ...base, entries: [{ vendorId: id, amount: -1 }] }).success).toBe(false);
    expect(slipsInputSchema.safeParse({ ...base, entries: [] }).success).toBe(false);
    expect(
      slipsInputSchema.safeParse({
        ...base,
        entries: [
          { vendorId: id, amount: 1 },
          { vendorId: id, amount: 2 },
        ],
      }).success,
    ).toBe(false);
  });
});
