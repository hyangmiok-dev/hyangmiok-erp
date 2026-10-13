/**
 * Supabase Edge Function: read-statement
 * 거래명세표 사진을 구글 Gemini(무료 등급)로 읽는다. 로그인한 사용자 권한(RLS)으로만 동작한다.
 * 대표 결정 2026-10-13: 유료 Claude API 대신 Gemini 무료 등급
 *   (무료 등급은 구글이 입력 내용을 제품 개선에 쓸 수 있음 — 대표에게 알리고 선택받음)
 * 비밀값: GEMINI_API_KEY (Google AI Studio 에서 만든 열쇠 → Supabase 대시보드 Edge Functions → Secrets 에 대표가 입력)
 * 배포: npx supabase@2.118.0 functions deploy read-statement --project-ref <ref> --use-api
 */
import { withSupabase } from "@supabase/server";
import { extractWithGemini } from "./gemini.ts";
import { readStatement } from "./handler.ts";

function seoulToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
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
      extract: (input) => extractWithGemini(input, { apiKey: Deno.env.get("GEMINI_API_KEY"), log: (m) => console.warn(m) }),
    });

    return Response.json(out.body, { status: out.status });
  }),
};

export default handler;
