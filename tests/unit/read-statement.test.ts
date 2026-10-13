import { describe, expect, it, vi } from "vitest";
import { base64Bytes, readStatement, toBase64, type ReadDeps } from "../../supabase/functions/read-statement/handler.ts";
import { MODELS, StatementRead, statementJsonSchema, systemPrompt } from "../../supabase/functions/read-statement/schema.ts";
import { buildGeminiRequest, extractWithGemini } from "../../supabase/functions/read-statement/gemini.ts";

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
    extract: vi.fn(async () => ({ ok: true as const, result, model: "gemini-3.8-flash", usage: { input_tokens: 10, output_tokens: 5 } })),
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
    expect(d.finish).toHaveBeenCalledWith(ID, expect.objectContaining({ ok: true, result, model: "gemini-3.8-flash" }));
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

  it("Gemini 용 JSON Schema: 지원되는 키워드만, 모든 칸 필수(null 로 비우기)", () => {
    const schema = statementJsonSchema();
    expect(schema.$schema).toBeUndefined();
    const allowed = new Set(["type", "properties", "required", "items", "enum", "anyOf", "description", "additionalProperties"]);
    const used = new Set<string>();
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node)) {
        used.add(k);
        if (k === "properties") Object.values(v as object).forEach(walk);
        else if (k === "items") walk(v);
        else if (k === "anyOf") (v as unknown[]).forEach(walk);
      }
    };
    walk(schema);
    expect([...used].filter((k) => !allowed.has(k))).toEqual([]);
    const top = schema as { properties: Record<string, unknown>; required: string[] };
    expect(top.required.sort()).toEqual(Object.keys(top.properties).sort());
    expect(MODELS[0]).toBe("gemini-3.8-flash");
  });

  it("AI 출력 형식: 못 읽은 칸은 null 허용", () => {
    expect(StatementRead.safeParse({ ...result, total: null, lines: [{ ...result.lines[0], amount: null, unclear: ["amount"] }] }).success).toBe(
      true,
    );
    expect(StatementRead.safeParse({ ...result, lines: [{ ...result.lines[0], unclear: ["price"] }] }).success).toBe(false);
  });
});

describe("구글 Gemini 호출 (REST, 가짜 fetch 로 확인)", () => {
  const input = { imageBase64: JPEG, vendorName: "엠앤아이", today: "2026-10-13" };
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const fail = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
  const answer = (r: unknown, extra: Record<string, unknown> = {}) =>
    ok({
      candidates: [{ content: { parts: [{ text: "생각…", thought: true }, { text: JSON.stringify(r) }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 400, thoughtsTokenCount: 300 },
      ...extra,
    });

  it("요청 모양: 사진(inlineData) + 지시문 + JSON 형식 + 생각 수준 + 고해상도", () => {
    const req = buildGeminiRequest(input);
    expect(req.contents[0].parts[0]).toEqual({ inlineData: { mimeType: "image/jpeg", data: JPEG } });
    expect(req.contents[0].parts[1].text).toContain("엠앤아이");
    expect(req.systemInstruction.parts[0].text).toContain("2026-10-13");
    expect(req.generationConfig).toMatchObject({
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "MEDIUM" },
      mediaResolution: "MEDIA_RESOLUTION_HIGH",
    });
    expect(req.generationConfig.responseJsonSchema).toEqual(statementJsonSchema());
  });

  it("성공: 첫 모델 주소로 열쇠를 헤더에 담아 보내고, 생각 부분은 빼고 결과를 읽는다", async () => {
    const f = vi.fn(async () => answer(result));
    const r = await extractWithGemini(input, { apiKey: "test-key", fetch: f });
    expect(r).toEqual({ ok: true, result, model: MODELS[0], usage: { input_tokens: 1500, output_tokens: 700 } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${MODELS[0]}:generateContent`);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    expect(JSON.parse(String(init.body)).generationConfig.responseMimeType).toBe("application/json");
  });

  it("무료 한도 초과(429)면 다음 모델로 다시 시도", async () => {
    const f = vi.fn().mockResolvedValueOnce(fail(429, { error: { status: "RESOURCE_EXHAUSTED" } })).mockResolvedValueOnce(answer(result));
    const r = await extractWithGemini(input, { apiKey: "k", fetch: f });
    expect(r.ok).toBe(true);
    expect(r.model).toBe(MODELS[1]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("두 모델 다 한도 초과면 안내 문구", async () => {
    const f = vi.fn(async () => fail(429));
    const r = await extractWithGemini(input, { apiKey: "k", fetch: f });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("무료 AI 사용량") });
  });

  it("열쇠가 틀리면(API_KEY_INVALID) 다른 모델을 시도하지 않고 대표에게 알리라고 한다", async () => {
    const f = vi.fn(async () => fail(400, { error: { status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } }));
    const r = await extractWithGemini(input, { apiKey: "bad", fetch: f });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("GEMINI_API_KEY");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("열쇠가 없으면 구글을 부르지 않는다", async () => {
    const f = vi.fn();
    const r = await extractWithGemini(input, { apiKey: undefined, fetch: f });
    expect(!r.ok && r.error).toContain("GEMINI_API_KEY");
    expect(f).not.toHaveBeenCalled();
  });

  it("차단·글자 수 초과·JSON 아님·형식 불일치는 실패로", async () => {
    const cases = [
      ok({ promptFeedback: { blockReason: "SAFETY" } }),
      ok({ candidates: [{ content: { parts: [{ text: "{" }] }, finishReason: "MAX_TOKENS" }] }),
      ok({ candidates: [{ content: { parts: [{ text: "표를 읽었습니다" }] }, finishReason: "STOP" }] }),
      answer({ ...result, lines: "없음" }),
      ok({ candidates: [{ content: { parts: [] }, finishReason: "STOP" }] }),
    ];
    for (const c of cases) {
      const r = await extractWithGemini(input, { apiKey: "k", fetch: vi.fn(async () => c) });
      expect(r.ok).toBe(false);
    }
  });

  it("시간 초과는 바로 안내 (다음 모델 시도 안 함)", async () => {
    const timeout = Object.assign(new Error("timeout"), { name: "TimeoutError" });
    const f = vi.fn(async () => Promise.reject(timeout));
    const r = await extractWithGemini(input, { apiKey: "k", fetch: f });
    expect(!r.ok && r.error).toContain("너무 오래");
    expect(f).toHaveBeenCalledTimes(1);
  });
});
