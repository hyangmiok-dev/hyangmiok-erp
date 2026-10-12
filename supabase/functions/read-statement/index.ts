/**
 * Supabase Edge Function: read-statement
 * 거래명세표 사진을 Claude(Opus 5.5)로 읽는다. 로그인한 사용자 권한(RLS)으로만 동작한다.
 * 비밀값: ANTHROPIC_API_KEY (Supabase 대시보드 → Edge Functions → Secrets 에서 대표가 입력)
 * 배포: npx supabase functions deploy read-statement --project-ref <ref> --use-api
 */
import { withSupabase } from "@supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { readStatement, type ExtractOutcome } from "./handler.ts";
import { MODEL, StatementRead, systemPrompt, userPrompt } from "./schema.ts";

function seoulToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

async function extractWithClaude(input: { imageBase64: string; vendorName: string; today: string }): Promise<ExtractOutcome> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return { ok: false, error: "AI 열쇠(ANTHROPIC_API_KEY)가 아직 설정되지 않았습니다. 대표에게 알려 주세요." };

  // Edge Function 은 150초 안에 끝나야 한다
  const client = new Anthropic({ apiKey, timeout: 115_000, maxRetries: 1 });
  const request = {
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium" as const, format: betaZodOutputFormat(StatementRead) },
    system: systemPrompt(input.today),
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: input.imageBase64 } },
          { type: "text" as const, text: userPrompt(input.vendorName) },
        ],
      },
    ],
  };

  try {
    let res;
    try {
      // 안전 분류기가 잘못 거절해도 다른 모델이 이어서 처리하도록 (fallbacks: "default")
      res = await client.beta.messages.parse({ ...request, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    } catch (e) {
      if (!(e instanceof Anthropic.BadRequestError)) throw e;
      console.warn("fallbacks 요청 거절 → 기본 요청으로 다시 시도", e.status);
      res = await client.beta.messages.parse(request);
    }

    const usage = { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens };
    if (res.stop_reason === "refusal") {
      return { ok: false, error: "AI 가 이 사진을 읽지 않았습니다. 직접 적어 주세요.", model: res.model, usage };
    }
    if (res.stop_reason === "max_tokens") {
      return { ok: false, error: "품목이 너무 많아 다 읽지 못했습니다. 직접 적어 주세요.", model: res.model, usage };
    }
    if (!res.parsed_output) {
      return { ok: false, error: "AI 결과를 해석하지 못했습니다. 다시 해 보거나 직접 적어 주세요.", model: res.model, usage };
    }
    return { ok: true, result: res.parsed_output, model: res.model, usage };
  } catch (e) {
    console.error("Claude 호출 실패", e instanceof Anthropic.APIError ? e.status : "", e instanceof Error ? e.name : "");
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, error: "AI 열쇠가 올바르지 않습니다. 대표에게 알려 주세요." };
    }
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: "AI 사용량이 몰렸어요. 1~2분 뒤 다시 해 주세요." };
    if (e instanceof Anthropic.APIConnectionTimeoutError) {
      return { ok: false, error: "AI 응답이 너무 오래 걸렸어요. 다시 해 보거나 직접 적어 주세요." };
    }
    if (e instanceof Anthropic.BadRequestError) {
      return { ok: false, error: "AI 요청이 거절됐어요 (사용 금액 충전이 필요할 수 있어요). 대표에게 알려 주세요." };
    }
    if (e instanceof Anthropic.APIError) return { ok: false, error: `AI 쪽 오류(${e.status ?? "연결"})예요. 잠시 후 다시 해 주세요.` };
    return { ok: false, error: "AI 연결에 실패했습니다. 잠시 후 다시 해 주세요." };
  }
}

const handler = {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return Response.json({ ok: false, error: "POST 요청만 받습니다." }, { status: 405 });
    const body = await req.json().catch(() => null);

    const out = await readStatement(body, {
      today: seoulToday,
      async begin(statementId) {
        const { data, error } = await ctx.supabase.rpc("begin_statement_ai", { p_statement_id: statementId });
        if (error) throw new Error(error.message);
        return data as { photo_path: string; vendor_name: string; attempt: number };
      },
      async finish(statementId, r) {
        const { error } = await ctx.supabase.rpc("finish_statement_ai", {
          p_statement_id: statementId,
          p_ok: r.ok,
          p_result: r.result,
          p_model: r.model,
          p_usage: r.usage,
          p_error: r.error,
        });
        if (error) throw new Error(error.message);
      },
      async download(path) {
        const { data, error } = await ctx.supabase.storage.from("statements").download(path);
        if (error || !data) throw new Error("download failed");
        return new Uint8Array(await data.arrayBuffer());
      },
      extract: extractWithClaude,
    });

    return Response.json(out.body, { status: out.status });
  }),
};

export default handler;
