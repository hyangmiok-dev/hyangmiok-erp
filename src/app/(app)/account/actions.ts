"use server";

import { getCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { changeOwnPasswordSchema, toFieldErrors, type ActionResult } from "@/lib/validation/users";

export async function changePasswordAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !user.email) return { ok: false, message: "로그인이 필요합니다." };

  const parsed = changeOwnPasswordSchema.safeParse({
    currentPassword: fd.get("currentPassword"),
    newPassword: fd.get("newPassword"),
    confirmPassword: fd.get("confirmPassword"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };

  const supabase = await createClient();
  // 현재 비밀번호 재확인 (세션 탈취 시 비밀번호 변경 방지)
  const { error: verifyErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.currentPassword,
  });
  if (verifyErr) return { ok: false, fieldErrors: { currentPassword: "현재 비밀번호가 올바르지 않습니다." } };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword });
  if (error) return { ok: false, message: `변경 실패: ${error.message}` };
  return { ok: true, message: "비밀번호를 변경했습니다." };
}
