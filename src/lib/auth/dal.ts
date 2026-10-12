import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isEnvConfigured } from "@/lib/env";
import { isRole, type Role, type SessionUser } from "@/lib/auth/roles";

/**
 * Data Access Layer: 현재 사용자 확인은 반드시 여기를 거친다.
 * - JWT 는 getClaims() 로 서명 검증한다 (쿠키를 그대로 믿지 않음).
 * - 프로필이 비활성이면 로그인하지 않은 것으로 취급한다.
 * - 같은 요청 안에서는 React cache 로 한 번만 조회한다.
 * 쿠키를 읽으므로, 이 함수를 쓰는 컴포넌트는 <Suspense> 안에 있어야 한다 (cacheComponents).
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  // 환경변수 미설정이면 비로그인 취급 → /login 에서 설정 안내를 보여준다.
  if (!isEnvConfigured()) return null;
  const supabase = await createClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (error || !userId) return null;

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role, login_id, is_active").eq("id", userId).maybeSingle(),
    supabase.from("store_members").select("store_id").eq("user_id", userId),
  ]);

  if (!profile || !profile.is_active || !isRole(profile.role)) return null;

  return {
    id: profile.id as string,
    fullName: profile.full_name as string,
    role: profile.role,
    loginId: (profile.login_id as string | null) ?? null,
    email: (claimsData.claims.email as string | undefined) ?? null,
    storeIds: (memberships ?? []).map((m) => m.store_id as string),
  };
});

/** 로그인 필수. 아니면 /login 으로 이동. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** 특정 역할만 허용. 권한 없으면 /forbidden 으로 이동. */
export async function requireRole(roles: readonly Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/forbidden");
  return user;
}

/** 서버 액션용: redirect/forbidden 대신 결과 객체를 돌려준다. */
export async function authorizeAction(
  roles: readonly Role[],
): Promise<{ ok: true; user: SessionUser } | { ok: false; message: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "로그인이 필요합니다. 다시 로그인해 주세요." };
  if (!roles.includes(user.role)) return { ok: false, message: "이 작업을 할 권한이 없습니다." };
  return { ok: true, user };
}
