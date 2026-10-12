import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env";

/**
 * 브라우저용 클라이언트 (로그인 쿠키를 그대로 쓴다 → RLS 적용).
 * 지금은 거래명세표 사진 올리기(Storage)와 AI 읽기(Edge Function) 호출에만 쓴다.
 * 업무 데이터 저장은 서버 액션으로 한다.
 */
export function createClient() {
  const env = getPublicEnv();
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
