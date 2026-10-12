"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getLoginIdDomain } from "@/lib/env";
import { toAuthEmail } from "@/lib/auth/login-id";
import { safeNextPath } from "@/lib/safe-redirect";

export interface LoginState {
  message?: string;
  identifier?: string;
}

const schema = z.object({
  identifier: z.string().trim().min(1, "아이디 또는 이메일을 입력하세요.").max(100),
  password: z.string().min(1, "비밀번호를 입력하세요.").max(200),
  next: z.string().optional(),
});

const GENERIC_ERROR = "아이디 또는 비밀번호가 올바르지 않습니다.";

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  const identifier = String(formData.get("identifier") ?? "");
  if (!parsed.success) return { message: parsed.error.issues[0].message, identifier };

  const email = toAuthEmail(parsed.data.identifier, getLoginIdDomain());
  if (!email) return { message: GENERIC_ERROR, identifier };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: parsed.data.password });
  if (error || !data.user) {
    // 로그인 시도 횟수 제한은 Supabase Auth 의 rate limit 이 담당한다.
    const tooMany = error?.status === 429;
    return {
      message: tooMany ? "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요." : GENERIC_ERROR,
      identifier,
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return {
      message: "승인 대기 중이거나 사용이 중지된 계정입니다. 대표(관리자)에게 문의하세요.",
      identifier,
    };
  }

  redirect(safeNextPath(parsed.data.next));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
