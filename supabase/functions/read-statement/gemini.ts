/**
 * 구글 Gemini 로 거래명세표 읽기 (REST 직접 호출).
 * @google/genai SDK 는 의존 패키지까지 수십 MB 라 Edge Function 크기 제한(서버 번들 5MB)에 걸릴 수 있어,
 * SDK 가 보내는 것과 같은 모양(v1beta generateContent, x-goog-api-key 헤더)으로 fetch 한다.
 * Deno 전용 코드를 쓰지 않아 Node 테스트(tests/unit/read-statement.test.ts)로 검증한다.
 */
import type { ExtractOutcome } from "./handler.ts";
import { MODELS, StatementRead, statementJsonSchema, systemPrompt, userPrompt } from "./schema.ts";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
/** Edge Function 은 150초 안에 끝나야 한다: 첫 모델 최대 90초, 다음 모델은 첫 시도가 빨리 끝났을 때만 */
const FIRST_TIMEOUT_MS = 90_000;
const NEXT_TIMEOUT_MS = 50_000;

export interface ExtractInput {
  imageBase64: string;
  vendorName: string;
  today: string;
}

export function buildGeminiRequest(input: ExtractInput) {
  return {
    contents: [
      {
        role: "user",
        parts: [{ inlineData: { mimeType: "image/jpeg", data: input.imageBase64 } }, { text: userPrompt(input.vendorName) }],
      },
    ],
    systemInstruction: { role: "user", parts: [{ text: systemPrompt(input.today) }] },
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: statementJsonSchema(),
      thinkingConfig: { thinkingLevel: "MEDIUM" },
      mediaResolution: "MEDIA_RESOLUTION_HIGH",
      maxOutputTokens: 16000,
    },
  };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

interface GeminiError {
  error?: { code?: number; status?: string; details?: { reason?: string }[] };
}

/** 응답 → 결과. 생각(thought) 부분은 빼고 답 글자만 모아 JSON 으로 읽는다 */
export function parseGeminiResponse(model: string, data: GeminiResponse): ExtractOutcome {
  const u = data.usageMetadata;
  const usage = {
    input_tokens: u?.promptTokenCount ?? 0,
    output_tokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
  };
  if (data.promptFeedback?.blockReason) {
    return { ok: false, error: "AI가 이 사진을 읽지 않았습니다. 직접 적어 주세요.", model, usage };
  }
  const candidate = data.candidates?.[0];
  if (candidate?.finishReason === "MAX_TOKENS") {
    return { ok: false, error: "품목이 너무 많아 다 읽지 못했습니다. 직접 적어 주세요.", model, usage };
  }
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
  if (!text) return { ok: false, error: "AI 결과가 비어 있습니다. 다시 해 보거나 직접 적어 주세요.", model, usage };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "AI 결과를 해석하지 못했습니다. 다시 해 보거나 직접 적어 주세요.", model, usage };
  }
  const parsed = StatementRead.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: "AI 결과 형식이 맞지 않습니다. 다시 해 보거나 직접 적어 주세요.", model, usage };
  }
  return { ok: true, result: parsed.data, model, usage };
}

const isAbort = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");

export async function extractWithGemini(
  input: ExtractInput,
  opts: { apiKey: string | undefined; fetch?: typeof fetch; now?: () => number; log?: (msg: string) => void },
): Promise<ExtractOutcome> {
  if (!opts.apiKey) return { ok: false, error: "AI 열쇠(GEMINI_API_KEY)가 아직 설정되지 않았습니다. 대표에게 알려 주세요." };
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const body = JSON.stringify(buildGeminiRequest(input));
  const started = now();
  let lastError = "AI 연결에 실패했습니다. 잠시 후 다시 해 주세요.";

  for (const [i, model] of MODELS.entries()) {
    if (i > 0 && now() - started > 30_000) break; // 남은 시간이 부족하면 다음 모델은 시도하지 않는다
    let res: Response;
    try {
      res = await doFetch(`${BASE_URL}/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
        body,
        signal: AbortSignal.timeout(i === 0 ? FIRST_TIMEOUT_MS : NEXT_TIMEOUT_MS),
      });
    } catch (e) {
      if (isAbort(e)) return { ok: false, error: "AI 응답이 너무 오래 걸렸어요. 다시 해 보거나 직접 적어 주세요.", model };
      log(`Gemini 연결 실패 ${model}`);
      lastError = "구글 AI에 연결하지 못했어요. 잠시 후 다시 해 주세요.";
      continue;
    }

    if (res.ok) {
      let data: GeminiResponse;
      try {
        data = (await res.json()) as GeminiResponse;
      } catch {
        return { ok: false, error: "AI 응답을 읽지 못했어요. 다시 해 주세요.", model };
      }
      return parseGeminiResponse(model, data);
    }

    const err = ((await res.json().catch(() => null)) ?? {}) as GeminiError;
    log(`Gemini 오류 ${model} ${res.status} ${err.error?.status ?? ""}`);
    if (res.status === 429) {
      // 무료 한도는 모델마다 따로 → 다음 모델로
      lastError = "오늘 무료 AI 사용량을 다 썼거나 잠깐 몰렸어요. 조금 뒤 다시 하거나 직접 적어 주세요.";
      continue;
    }
    if (res.status >= 500) {
      lastError = "구글 AI가 잠시 바빠요. 1~2분 뒤 다시 해 주세요.";
      continue;
    }
    const keyProblem = res.status === 401 || res.status === 403 || (err.error?.details ?? []).some((d) => d.reason === "API_KEY_INVALID");
    return {
      ok: false,
      error: keyProblem
        ? "AI 열쇠(GEMINI_API_KEY)가 올바르지 않아요. 대표에게 알려 주세요."
        : "AI 요청이 거절됐어요. 직접 적어 주시고, 대표에게 알려 주세요.",
      model,
    };
  }
  return { ok: false, error: lastError };
}
