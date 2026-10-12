import { describe, expect, it, vi } from "vitest";
import { base64Bytes, readStatement, toBase64, type ReadDeps } from "../../supabase/functions/read-statement/handler.ts";
import { StatementRead, systemPrompt } from "../../supabase/functions/read-statement/schema.ts";

const ID = "11111111-1111-4111-8111-111111111111";
const JPEG = "/9j/4AAQSkZJRgABAQ==";

const result: StatementRead = {
  is_statement: true,
  vendor_name: "엠앤아이",
  date: "2026-10-12",
  lines: [{ name: "숙주", quantity: 2, unit: "박스", unit_price: 15000, amount: 30000, tax: null, unclear: [] }],
  supply_total: 30000,
  tax_total: null,
  total: 30000,
  previous_balance: null,
  balance: null,
  unclear: [],
  notes: null,
};

function deps(over: Partial<ReadDeps> = {}) {
  const d = {
    today: () => "2026-10-13",
    begin: vi.fn(async () => ({ photo_path: `${ID}/2026-10/${ID}.jpg`, vendor_name: "엠앤아이", attempt: 1 })),
    finish: vi.fn(async () => {}),
    download: vi.fn(async () => new Uint8Array([0xff, 0xd8, 0xff])),
    extract: vi.fn(async () => ({ ok: true as const, result, model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 5 } })),
    ...over,
  };
  return d;
}

describe("Edge Function: 거래명세표 AI 읽기 순서", () => {
  it("성공: 시작 기록 → 받은 사진으로 AI → 결과 기록", async () => {
    const d = deps();
    const r = await readStatement({ statementId: ID, image: JPEG }, d);
    expect(r).toEqual({ status: 200, body: { ok: true, result } });
    expect(d.begin).toHaveBeenCalledWith(ID);
    expect(d.download).not.toHaveBeenCalled();
    expect(d.extract).toHaveBeenCalledWith({ imageBase64: JPEG, vendorName: "엠앤아이", today: "2026-10-13" });
    expect(d.finish).toHaveBeenCalledWith(ID, expect.objectContaining({ ok: true, result, model: "claude-opus-5-5" }));
  });

  it("사진을 안 보내면 보관된 사진을 읽는다 (다시 읽기)", async () => {
    const d = deps();
    await readStatement({ statementId: ID }, d);
    expect(d.download).toHaveBeenCalledWith(`${ID}/2026-10/${ID}.jpg`);
    expect(d.extract).toHaveBeenCalledWith(expect.objectContaining({ imageBase64: toBase64(new Uint8Array([0xff, 0xd8, 0xff])) }));
  });

  it("잘못된 요청은 DB·AI 를 부르지 않는다", async () => {
    const d = deps();
    expect((await readStatement({ statementId: "x" }, d)).status).toBe(400);
    expect((await readStatement({ statementId: ID, image: "not-jpeg" }, d)).status).toBe(400);
    expect((await readStatement(null, d)).status).toBe(400);
    expect(d.begin).not.toHaveBeenCalled();
    expect(d.extract).not.toHaveBeenCalled();
  });

  it("DB 가 거절하면(권한·3번 초과) 그 이유를 보여 주고 AI 는 부르지 않는다", async () => {
    const d = deps({ begin: vi.fn(async () => Promise.reject(new Error("AI 읽기는 한 장에 3번까지예요. 직접 적어 주세요."))) });
    const r = await readStatement({ statementId: ID, image: JPEG }, d);
    expect(r).toEqual({ status: 403, body: { ok: false, error: "AI 읽기는 한 장에 3번까지예요. 직접 적어 주세요." } });
    expect(d.extract).not.toHaveBeenCalled();
  });

  it("AI 실패는 '실패'로 기록하고 안내 문구를 돌려준다", async () => {
    const d = deps({ extract: vi.fn(async () => ({ ok: false as const, error: "AI 응답이 너무 오래 걸렸어요." })) });
    const r = await readStatement({ statementId: ID, image: JPEG }, d);
    expect(r.body).toEqual({ ok: false, error: "AI 응답이 너무 오래 걸렸어요." });
    expect(d.finish).toHaveBeenCalledWith(ID, expect.objectContaining({ ok: false, error: "AI 응답이 너무 오래 걸렸어요." }));
  });

  it("거래명세표가 아닌 사진이면 실패로 기록", async () => {
    const d = deps({
      extract: vi.fn(async () => ({ ok: true as const, result: { ...result, is_statement: false }, model: "m", usage: {} })),
    });
    const r = await readStatement({ statementId: ID, image: JPEG }, d);
    expect(r.body.ok).toBe(false);
    expect(d.finish).toHaveBeenCalledWith(ID, expect.objectContaining({ ok: false }));
  });

  it("너무 큰 사진은 거절", async () => {
    const big = "/9j/" + "A".repeat(7_100_000);
    const r = await readStatement({ statementId: ID, image: big }, deps());
    expect(r.status).toBe(413);
  });

  it("base64 크기 계산", () => {
    expect(base64Bytes(toBase64(new Uint8Array(10)))).toBe(10);
    expect(base64Bytes(toBase64(new Uint8Array(100_001)))).toBe(100_001);
  });

  it("지시문에 오늘 날짜와 '추측하지 말 것'이 들어간다", () => {
    const p = systemPrompt("2026-10-13");
    expect(p).toContain("2026-10-13");
    expect(p).toContain("추측하지 말고 null");
  });

  it("AI 출력 형식: 못 읽은 칸은 null 허용", () => {
    expect(StatementRead.safeParse({ ...result, total: null, lines: [{ ...result.lines[0], amount: null, unclear: ["amount"] }] }).success).toBe(
      true,
    );
    expect(StatementRead.safeParse({ ...result, lines: [{ ...result.lines[0], unclear: ["price"] }] }).success).toBe(false);
  });
});
