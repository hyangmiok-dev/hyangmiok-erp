import "server-only";
import { createClient } from "@supabase/supabase-js";
import { EnvError, getPublicEnv } from "@/lib/env";

/**
 * 시크릿 키(관리자) 클라이언트. RLS 를 우회하므로 **계정 생성·비밀번호 초기화·세션 차단** 같은
 * Auth 관리 작업에만 사용한다. 업무 데이터 변경은 반드시 createClient()(사용자 권한)로 한다.
 * 호출 전에 반드시 서버에서 대표 권한을 확인할 것 (requireRole).
 */
export function createAdminClient() {
  const env = getPublicEnv();
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) {
    throw new EnvError("SUPABASE_SECRET_KEY 가 설정되지 않아 계정 관리 기능을 사용할 수 없습니다.");
  }
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
