import { z } from "zod";
import { LOGIN_ID_PATTERN } from "@/lib/auth/login-id";
import { ROLES, requiresStoreMembership } from "@/lib/auth/roles";

/** 비밀번호 정책: 10자 이상, 영문+숫자 포함. (Supabase 대시보드의 최소 길이도 10 으로 맞출 것) */
export const passwordSchema = z
  .string()
  .min(10, "비밀번호는 10자 이상이어야 합니다.")
  .max(72, "비밀번호는 72자 이하여야 합니다.")
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "비밀번호에는 영문과 숫자가 모두 포함되어야 합니다.");

const uuid = z.uuid({ message: "올바르지 않은 지점입니다." });

const fullName = z.string().trim().min(1, "이름을 입력하세요.").max(50, "이름은 50자 이하로 입력하세요.");

const storeIds = z.array(uuid).max(50);

function checkStores(
  v: { role: (typeof ROLES)[number]; storeIds: string[] },
  ctx: z.RefinementCtx,
) {
  if (requiresStoreMembership(v.role) && v.storeIds.length === 0) {
    ctx.addIssue({ code: "custom", path: ["storeIds"], message: "소속 지점을 1개 이상 선택하세요." });
  }
}

export const createUserSchema = z
  .object({
    fullName,
    loginType: z.enum(["id", "email"]),
    loginId: z.string().trim().toLowerCase().optional(),
    email: z.string().trim().toLowerCase().optional(),
    password: passwordSchema,
    role: z.enum(ROLES),
    storeIds,
  })
  .superRefine((v, ctx) => {
    if (v.loginType === "id" && !LOGIN_ID_PATTERN.test(v.loginId ?? "")) {
      ctx.addIssue({
        code: "custom",
        path: ["loginId"],
        message: "아이디는 영문 소문자·숫자·._- 3~30자로 입력하세요.",
      });
    }
    if (v.loginType === "email" && !z.email().safeParse(v.email ?? "").success) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "올바른 이메일을 입력하세요." });
    }
    checkStores(v, ctx);
  });

export const updateUserSchema = z
  .object({
    userId: z.uuid(),
    fullName,
    role: z.enum(ROLES),
    isActive: z.boolean(),
    storeIds,
  })
  .superRefine(checkStores);

export const resetPasswordSchema = z.object({ userId: z.uuid(), password: passwordSchema });

export const changeOwnPasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "현재 비밀번호를 입력하세요."),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "새 비밀번호가 서로 다릅니다.",
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "현재 비밀번호와 다른 비밀번호를 사용하세요.",
  });

/** FormData → 객체. 체크박스 다중값(storeIds)과 boolean 처리. */
export function formToObject(fd: FormData) {
  return {
    userId: fd.get("userId") ?? undefined,
    fullName: fd.get("fullName") ?? undefined,
    loginType: fd.get("loginType") ?? undefined,
    loginId: fd.get("loginId") ?? undefined,
    email: fd.get("email") ?? undefined,
    password: fd.get("password") ?? undefined,
    role: fd.get("role") ?? undefined,
    isActive: fd.get("isActive") === "on",
    storeIds: fd.getAll("storeIds").map(String),
  };
}

export type FieldErrors = Record<string, string>;

export function toFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_");
    out[key] ??= issue.message;
  }
  return out;
}

export interface ActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
}
