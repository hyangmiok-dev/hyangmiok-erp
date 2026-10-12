"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLoginIdDomain } from "@/lib/env";
import { loginIdToEmail } from "@/lib/auth/login-id";
import { isRole } from "@/lib/auth/roles";
import {
  createUserSchema,
  formToObject,
  initialPasswordSchemaFor,
  resetPasswordSchema,
  toFieldErrors,
  updateUserSchema,
  type ActionResult,
} from "@/lib/validation/users";

const OWNER_ONLY = ["owner"] as const;
/** 비활성 계정의 기존 세션을 끊기 위한 Auth 차단 기간(사실상 영구). 재활성화 시 'none'. */
const BAN_FOREVER = "876000h";

function dbErrorMessage(message: string): string {
  if (message.includes("마지막 대표")) return "마지막 대표 계정은 강등하거나 비활성화할 수 없습니다.";
  if (message.includes("duplicate key") && message.includes("login_id")) return "이미 사용 중인 아이디입니다.";
  if (message.includes("권한이 없습니다")) return "권한이 없습니다.";
  return "저장 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.";
}

export async function createUserAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction(OWNER_ONLY);
  if (!auth.ok) return { ok: false, message: auth.message };

  const parsed = createUserSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  const v = parsed.data;

  const loginId = v.loginType === "name" ? v.loginId! : null;
  const email = loginId ? loginIdToEmail(loginId, getLoginIdDomain()) : v.email!;

  // 같은 아이디가 이미 있으면 Auth 계정을 만들기 전에 안내 (동명이인)
  if (loginId) {
    const { data: dup } = await (await createClient())
      .from("profiles")
      .select("id")
      .eq("login_id", loginId)
      .maybeSingle();
    if (dup) {
      return { ok: false, fieldErrors: { loginId: `'${loginId}' 는 이미 있는 아이디입니다. 뒤에 숫자를 붙여 주세요. (예: ${loginId}2)` } };
    }
  }

  // 1) Auth 계정 생성 (시크릿 키 필요). 트리거가 staff·비활성 프로필을 만든다.
  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: v.password,
    email_confirm: true,
    user_metadata: { full_name: v.fullName },
  });
  if (createErr || !created.user) {
    const exists = createErr?.code === "email_exists" || /already/i.test(createErr?.message ?? "");
    return {
      ok: false,
      message: exists ? "이미 사용 중인 아이디 또는 이메일입니다." : `계정 생성 실패: ${createErr?.message ?? "알 수 없음"}`,
    };
  }
  const newId = created.user.id;

  // 2) 역할·소속 지정은 대표 본인 세션으로 수행 → RLS 적용 + 감사 로그에 대표가 기록된다.
  const supabase = await createClient();
  const { error: profErr } = await supabase
    .from("profiles")
    .update({ full_name: v.fullName, role: v.role, is_active: true, login_id: loginId, must_change_password: true })
    .eq("id", newId);
  const { error: memErr } = profErr
    ? { error: null }
    : await supabase.rpc("set_store_memberships", { p_user_id: newId, p_store_ids: v.storeIds });

  if (profErr || memErr) {
    // 보상 처리: 반쯤 만들어진 계정을 남기지 않는다.
    await admin.auth.admin.deleteUser(newId);
    return { ok: false, message: dbErrorMessage((profErr ?? memErr)!.message) };
  }

  revalidatePath("/admin/users");
  return { ok: true, message: `${v.fullName} 계정을 만들었습니다.` };
}

export async function updateUserAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction(OWNER_ONLY);
  if (!auth.ok) return { ok: false, message: auth.message };

  const parsed = updateUserSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  const v = parsed.data;

  if (v.userId === auth.user.id && (v.role !== "owner" || !v.isActive)) {
    return { ok: false, message: "본인 계정의 역할 변경·비활성화는 할 수 없습니다." };
  }

  const supabase = await createClient();
  const { data: before } = await supabase.from("profiles").select("is_active").eq("id", v.userId).maybeSingle();
  if (!before) return { ok: false, message: "계정을 찾을 수 없습니다." };

  const { error: profErr } = await supabase
    .from("profiles")
    .update({ full_name: v.fullName, role: v.role, is_active: v.isActive })
    .eq("id", v.userId);
  if (profErr) return { ok: false, message: dbErrorMessage(profErr.message) };

  const { error: memErr } = await supabase.rpc("set_store_memberships", {
    p_user_id: v.userId,
    p_store_ids: v.storeIds,
  });
  if (memErr) return { ok: false, message: dbErrorMessage(memErr.message) };

  // 활성 상태가 바뀌었으면 Auth 측 로그인 차단/해제 (기존 세션 갱신 불가 처리)
  if (before.is_active !== v.isActive) {
    try {
      const { error } = await createAdminClient().auth.admin.updateUserById(v.userId, {
        ban_duration: v.isActive ? "none" : BAN_FOREVER,
      });
      if (error) throw error;
    } catch {
      revalidatePath("/admin/users");
      return {
        ok: true,
        message: "저장했지만 로그인 차단 상태 반영에 실패했습니다. 데이터 접근은 이미 차단되었습니다.",
      };
    }
  }

  revalidatePath("/admin/users");
  return { ok: true, message: "저장했습니다." };
}

export async function resetPasswordAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction(OWNER_ONLY);
  if (!auth.ok) return { ok: false, message: auth.message };

  const parsed = resetPasswordSchema.safeParse({ userId: fd.get("userId"), password: fd.get("password") });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  const { userId, password } = parsed.data;

  if (userId === auth.user.id) {
    return { ok: false, message: "본인 비밀번호는 [내 계정]에서 바꿔 주세요." };
  }

  // 대상 역할에 맞는 첫 비밀번호 규칙 적용 (직원=생년월일 6자리, 관리자=10자 이상)
  const supabase = await createClient();
  const { data: target } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (!target || !isRole(target.role)) return { ok: false, message: "계정을 찾을 수 없습니다." };
  const pw = initialPasswordSchemaFor(target.role).safeParse(password);
  if (!pw.success) return { ok: false, fieldErrors: { password: pw.error.issues[0].message } };

  try {
    const { error } = await createAdminClient().auth.admin.updateUserById(userId, { password });
    if (error) return { ok: false, message: `비밀번호 변경 실패: ${error.message}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  // 다음 로그인 때 본인 비밀번호로 바꾸게 한다 (대표 세션 → 감사로그에 기록)
  const { error: flagErr } = await supabase.from("profiles").update({ must_change_password: true }).eq("id", userId);
  if (flagErr) return { ok: true, message: "비밀번호는 바꿨지만 '첫 로그인 변경' 설정에 실패했습니다." };

  return {
    ok: true,
    message:
      target.role === "staff"
        ? "생년월일로 초기화했습니다. 직원이 로그인하면 새 비밀번호를 정하게 됩니다."
        : "임시 비밀번호로 초기화했습니다. 로그인하면 새 비밀번호를 정하게 됩니다.",
  };
}
