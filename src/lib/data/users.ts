import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isRole, type Role } from "@/lib/auth/roles";

export interface UserRow {
  id: string;
  fullName: string;
  loginId: string | null;
  email: string | null;
  role: Role;
  isActive: boolean;
  storeIds: string[];
  createdAt: string;
}

/** 계정 목록 (RLS: 대표는 전체, 관리자는 같은 지점 사용자만). */
export async function listUsers(): Promise<UserRow[]> {
  const supabase = await createClient();
  const [{ data: profiles, error }, { data: members, error: mErr }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, login_id, email, role, is_active, created_at")
      .order("is_active", { ascending: false })
      .order("full_name"),
    supabase.from("store_members").select("user_id, store_id"),
  ]);
  if (error || mErr) throw new Error(`계정 조회 실패: ${(error ?? mErr)!.message}`);

  const byUser = new Map<string, string[]>();
  for (const m of members ?? []) {
    byUser.set(m.user_id, [...(byUser.get(m.user_id) ?? []), m.store_id]);
  }

  return (profiles ?? [])
    .filter((p) => isRole(p.role))
    .map((p) => ({
      id: p.id,
      fullName: p.full_name,
      loginId: p.login_id,
      email: p.login_id ? null : p.email,
      role: p.role as Role,
      isActive: p.is_active,
      storeIds: byUser.get(p.id) ?? [],
      createdAt: p.created_at,
    }));
}
