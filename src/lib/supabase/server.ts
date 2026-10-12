import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicEnv } from "@/lib/env";

/**
 * 로그인한 사용자 권한으로 동작하는 서버용 클라이언트.
 * 모든 조회/수정은 RLS 의 적용을 받는다. 요청마다 새로 만든다.
 */
export async function createClient() {
  const env = getPublicEnv();
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component 렌더링 중에는 쿠키를 쓸 수 없다. 세션 갱신은 proxy.ts 가 담당한다.
        }
      },
    },
  });
}
