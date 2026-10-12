"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { changeOwnPasswordSchema, toFieldErrors, type ActionResult } from "@/lib/validation/users";

/**
 * 본인 비밀번호 변경.
 * - 평소: 현재 비밀번호 재확인 후 변경 (세션 탈취 시 비밀번호 변경 방지)
 * - 첫 로그인(must_change_password): 방금 로그인했으므로 새 비밀번호만 받고, 성공하면 플래그 해제 후 홈으로
 */
export async function changePasswordAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !user.email) return { ok: false, message: "로그인이 필요합니다." };

  const firstTime = user.mustChangePassword;
  const parsed = changeOwnPasswordSchema(user.role, !firstTime).safeParse({
    currentPassword: fd.get("currentPassword") ?? undefined,
    newPassword: fd.get("newPassword"),
    confirmPassword: fd.get("confirmPassword"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };

  const supabase = await createClient();
  if (!firstTime) {
    const { error: verifyErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: parsed.data.currentPassword ?? "",
    });
    if (verifyErr) return { ok: false, fieldErrors: { currentPassword: "현재 비밀번호가 올바르지 않습니다." } };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword });
  if (error) {
    if (error.code === "same_password") {
      return { ok: false, fieldErrors: { newPassword: "처음 받은 비밀번호와 다른 번호로 정해 주세요." } };
    }
    if (error.code === "weak_password") {
      return { ok: false, fieldErrors: { newPassword: "너무 쉬운 비밀번호입니다. 다른 번호로 정해 주세요." } };
    }
    return { ok: false, message: `변경 실패: ${error.message}` };
  }

  if (firstTime) {
    // 사용자는 이 플래그를 직접 바꿀 수 없으므로(DB guard) 서버가 해제한다.
    const { error: flagErr } = await createAdminClient()
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", user.id);
    if (flagErr) return { ok: false, message: "비밀번호는 바뀌었지만 상태 저장에 실패했습니다. 다시 시도해 주세요." };
    redirect("/");
  }

  return { ok: true, message: "비밀번호를 변경했습니다." };
}
