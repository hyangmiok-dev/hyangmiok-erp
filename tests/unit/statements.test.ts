import { describe, expect, it } from "vitest";
import {
  draftFromAi,
  fitSize,
  isPhotoPathOf,
  parseAiResult,
  photoPathFor,
  toConfirmLines,
  totalsCheck,
  vendorLooksDifferent,
  type StatementRead,
} from "@/lib/statements";

const TODAY = "2026-10-13";
const S = "11111111-1111-4111-8111-111111111111";

const ai = (over: Partial<StatementRead> = {}): StatementRead => ({
  is_statement: true,
  vendor_name: "(주)엠앤아이",
  date: "2026-10-12",
  lines: [
    { name: "차돌양지 (1kg)", quantity: 10, unit: "kg", unit_price: 32000, amount: 320000, tax: null, unclear: [] },
    { name: "숙주", quantity: 2, unit: "박스", unit_price: 15000, amount: 30000, tax: null, unclear: [] },
  ],
  supply_total: 350000,
  tax_total: null,
  total: 350000,
  previous_balance: 850000,
  balance: 1200000,
  unclear: [],
  notes: null,
  ...over,
});

describe("AI 결과 → 검토 화면", () => {
  it("읽은 값을 그대로 채우고, 명세표 금액은 수량×단가로 덮어쓰지 않는다", () => {
    const d = draftFromAi(ai(), TODAY);
    expect(d.lines[0]).toEqual({
      itemName: "차돌양지 (1kg)",
      quantity: "10",
      unit: "kg",
      unitPrice: "32000",
      amount: "320000",
      amountEdited: true,
      flags: [],
    });
    expect(d.vat).toBe("0");
    expect(d.date).toBe("2026-10-12");
    expect(d.dateFlag).toBe(false);
    expect(d.balance).toBe("1200000");
    expect(d.total).toBe(350000);
  });

  it("못 읽은 칸은 비우고 '확인 필요' 표시 (추측하지 않음)", () => {
    const d = draftFromAi(
      ai({
        lines: [
          { name: null, quantity: null, unit: "kg", unit_price: 9000, amount: null, tax: null, unclear: ["name"] },
          { name: "고수", quantity: 1.25, unit: null, unit_price: null, amount: 12000, tax: null, unclear: ["unit_price"] },
        ],
      }),
      TODAY,
    );
    expect(d.lines[0]).toMatchObject({ itemName: "", quantity: "", amount: "" });
    expect(d.lines[0].flags.sort()).toEqual(["amount", "itemName", "quantity"]);
    expect(d.lines[1]).toMatchObject({ quantity: "1.25", unitPrice: "", amount: "12000" });
    expect(d.lines[1].flags).toEqual(["unitPrice"]);
  });

  it("금액만 못 읽었으면 수량×단가를 넣되 확인 필요로 남긴다", () => {
    const d = draftFromAi(
      ai({ lines: [{ name: "숙주", quantity: 3, unit: "박스", unit_price: 15000, amount: null, tax: null, unclear: [] }], total: null }),
      TODAY,
    );
    expect(d.lines[0]).toMatchObject({ amount: "45000", amountEdited: false, flags: ["amount"] });
  });

  it("세액 칸이 있으면 부가세로 합친다 (합계 = 품목 + 부가세)", () => {
    const d = draftFromAi(
      ai({
        lines: [
          { name: "소스", quantity: 2, unit: "개", unit_price: 10000, amount: 20000, tax: 2000, unclear: [] },
          { name: "면", quantity: 1, unit: "박스", unit_price: 30000, amount: 30000, tax: 3000, unclear: ["tax"] },
        ],
        tax_total: null,
        total: 55000,
      }),
      TODAY,
    );
    expect(d.vat).toBe("5000");
    expect(d.vatFlag).toBe(true);
    expect(totalsCheck(50000, 5000, d.total)).toEqual({ status: "ok", diff: 0 });
  });

  it("세액 칸이 없는데 합계가 더 크면 차이를 부가세로 넣고 확인 요청", () => {
    const d = draftFromAi(ai({ total: 385000 }), TODAY);
    expect(d.vat).toBe("35000");
    expect(d.vatFlag).toBe(true);
  });

  it("이상한 날짜(미래·두 달 넘게 전·형식 오류)는 오늘로 두고 확인 요청", () => {
    expect(draftFromAi(ai({ date: "2026-10-20" }), TODAY)).toMatchObject({ date: TODAY, dateFlag: true });
    expect(draftFromAi(ai({ date: "2026-07-01" }), TODAY)).toMatchObject({ date: TODAY, dateFlag: true });
    expect(draftFromAi(ai({ date: "10/12" }), TODAY)).toMatchObject({ date: TODAY, dateFlag: true });
    expect(draftFromAi(ai({ unclear: ["date"] }), TODAY)).toMatchObject({ date: "2026-10-12", dateFlag: true });
  });

  it("AI 결과가 없으면 빈 화면 (직접 적기)", () => {
    const d = draftFromAi(null, TODAY);
    expect(d.lines).toEqual([]);
    expect(d.date).toBe(TODAY);
  });

  it("저장된 결과가 형식에 안 맞으면 무시한다", () => {
    expect(parseAiResult({ lines: "x" })).toBeNull();
    expect(parseAiResult(ai())).not.toBeNull();
  });
});

describe("점검", () => {
  it("합계 불일치는 차이를 알려 준다", () => {
    expect(totalsCheck(350000, 0, 360000)).toEqual({ status: "mismatch", diff: -10000 });
    expect(totalsCheck(350000, 0, null).status).toBe("unknown");
  });

  it("거래처 이름 비교: (주)·띄어쓰기는 무시, 전혀 다르면 경고", () => {
    expect(vendorLooksDifferent("엠앤아이", "(주)엠앤아이 푸드")).toBe(false);
    expect(vendorLooksDifferent("경희상회", "경희 상회")).toBe(false);
    expect(vendorLooksDifferent("엠앤아이", "청수상사")).toBe(true);
    expect(vendorLooksDifferent("엠앤아이", null)).toBe(false);
  });

  it("확정 줄: 부가세가 있으면 '부가세' 줄을 더한다", () => {
    const lines = [{ itemName: "소스", quantity: 2, unit: "개", unitPrice: 10000, amount: 20000 }];
    expect(toConfirmLines(lines, 2000)).toEqual([
      { item_name: "소스", quantity: 2, unit: "개", unit_price: 10000, amount: 20000 },
      { item_name: "부가세", quantity: 1, unit: null, unit_price: 2000, amount: 2000 },
    ]);
    expect(toConfirmLines(lines, 0)).toHaveLength(1);
  });
});

describe("사진", () => {
  it("휴대폰 사진(4032×3024)을 AI용·보관용 크기로 줄인다", () => {
    const aiSize = fitSize(4032, 3024, 2576, 3_750_000);
    expect(aiSize.width * aiSize.height).toBeLessThanOrEqual(3_750_000);
    expect(Math.max(aiSize.width, aiSize.height)).toBeLessThanOrEqual(2576);
    const keep = fitSize(3024, 4032, 1600, 2_000_000);
    expect(keep.height).toBeLessThanOrEqual(1600);
    expect(keep.width / keep.height).toBeCloseTo(0.75, 2);
    expect(fitSize(800, 600, 1600, 2_000_000)).toEqual({ width: 800, height: 600 }); // 작은 사진은 그대로
  });

  it("보관 경로는 지점 폴더 아래 (DB 정책과 같은 모양)", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    const p = photoPathFor(S, "2026-10", id);
    expect(p).toBe(`${S}/2026-10/${id}.jpg`);
    expect(isPhotoPathOf(S, p)).toBe(true);
    expect(isPhotoPathOf("33333333-3333-4333-8333-333333333333", p)).toBe(false);
    expect(isPhotoPathOf(S, `${S}/2026-10/../x.jpg`)).toBe(false);
  });
});
