import { z } from "zod";
import { LOGIN_ID_PATTERN, normalizeIdentifier } from "@/lib/auth/login-id";
import { ROLES, requiresStoreMembership, type Role } from "@/lib/auth/roles";

// ---------------------------------------------------------------------
// 비밀번호 정책
//  - 관리자(대표·본사·지점관리자): 10자 이상, 영문+숫자
//  - 일반 직원: 비밀번호 = 생년월일 6자리 (대표 결정 2026-10-13: 첫 로그인 변경 강제 없음, 원하면 [내 계정]에서 6자리 이상으로 변경)
//  - Supabase 대시보드의 최소 길이는 6 이어야 직원 비밀번호가 허용된다.
// ---------------------------------------------------------------------

export const strongPasswordSchema = z
  .string()
  .min(10, "비밀번호는 10자 이상이어야 합니다.")
  .max(72, "비밀번호는 72자 이하여야 합니다.")
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "비밀번호에는 영문과 숫자가 모두 포함되어야 합니다.");

/** 생년월일 6자리(YYMMDD) — 직원 첫 비밀번호 */
export const birthdatePasswordSchema = z
  .string()
  .regex(/^\d{6}$/, "생년월일 숫자 6자리로 입력하세요. (예: 950312)")
  .refine((v) => {
    const mm = Number(v.slice(2, 4));
    const dd = Number(v.slice(4, 6));
    return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
  }, "생년월일 6자리가 올바르지 않습니다. (예: 950312)");

/** 누구나 짐작할 수 있는 비밀번호인지 (111111, 123456, 654321 등) */
export function isTrivialPassword(v: string): boolean {
  if (/^(.)\1+$/.test(v)) return true;
  if (/^\d+$/.test(v)) {
    const asc = "01234567890123456789";
    const desc = "98765432109876543210";
    if (asc.includes(v) || desc.includes(v)) return true;
  }
  return ["password", "qwerty", "asdfgh", "hyangmiok", "향미옥"].some((w) => v.toLowerCase().includes(w));
}

/** 직원이 직접 바꾸는 비밀번호: 6자리 이상 */
export const staffOwnPasswordSchema = z
  .string()
  .min(6, "비밀번호는 6자리 이상이어야 합니다.")
  .max(72, "비밀번호는 72자 이하여야 합니다.");

/** 대표가 정해주는 첫(임시) 비밀번호 규칙 */
export function initialPasswordSchemaFor(role: Role) {
  return role === "staff" ? birthdatePasswordSchema : strongPasswordSchema;
}

/** 본인이 정하는 비밀번호 규칙 */
export function ownPasswordSchemaFor(role: Role) {
  return role === "staff" ? staffOwnPasswordSchema : strongPasswordSchema.refine((v) => !isTrivialPassword(v), "너무 쉬운 비밀번호입니다.");
}

export function passwordHintFor(role: Role, kind: "initial" | "own"): string {
  if (role === "staff") return kind === "initial" ? "생년월일 숫자 6자리 (예: 950312)" : "6자리 이상";
  return "10자 이상, 영문+숫자 포함";
}

// ---------------------------------------------------------------------
// 계정 입력
// ---------------------------------------------------------------------

const uuid = z.uuid({ message: "올바르지 않은 지점입니다." });

const fullName = z.string().trim().min(1, "이름을 입력하세요.").max(50, "이름은 50자 이하로 입력하세요.");

const storeIds = z.array(uuid).max(50);

function checkStores(v: { role: Role; storeIds: string[] }, ctx: z.RefinementCtx) {
  if (requiresStoreMembership(v.role) && v.storeIds.length === 0) {
    ctx.addIssue({ code: "custom", path: ["storeIds"], message: "소속 지점을 1개 이상 선택하세요." });
  }
}

function checkPassword(schema: z.ZodType<string>, value: string, ctx: z.RefinementCtx, path = "password") {
  const r = schema.safeParse(value);
  if (!r.success) ctx.addIssue({ code: "custom", path: [path], message: r.error.issues[0].message });
}

export const createUserSchema = z
  .object({
    fullName,
    loginType: z.enum(["name", "email"]),
    loginId: z
      .string()
      .optional()
      .transform((v) => (v === undefined ? v : normalizeIdentifier(v).replace(/\s+/g, ""))),
    email: z.string().trim().toLowerCase().optional(),
    password: z.string(),
    role: z.enum(ROLES),
    storeIds,
  })
  .superRefine((v, ctx) => {
    if (v.loginType === "name" && !LOGIN_ID_PATTERN.test(v.loginId ?? "")) {
      ctx.addIssue({
        code: "custom",
        path: ["loginId"],
        message: "아이디는 한글·영문 소문자·숫자 2~20자로 입력하세요. (띄어쓰기 불가, 동명이인은 김민수2)",
      });
    }
    if (v.loginType === "email" && !z.email().safeParse(v.email ?? "").success) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "올바른 이메일을 입력하세요." });
    }
    checkPassword(initialPasswordSchemaFor(v.role), v.password, ctx);
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

export const resetPasswordSchema = z.object({ userId: z.uuid(), password: z.string() });

export function changeOwnPasswordSchema(role: Role, requireCurrent: boolean) {
  return z
    .object({
      currentPassword: requireCurrent ? z.string().min(1, "현재 비밀번호를 입력하세요.") : z.string().optional(),
      newPassword: z.string(),
      confirmPassword: z.string(),
    })
    .superRefine((v, ctx) => {
      checkPassword(ownPasswordSchemaFor(role), v.newPassword, ctx, "newPassword");
      if (v.newPassword !== v.confirmPassword) {
        ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "새 비밀번호가 서로 다릅니다." });
      }
      if (requireCurrent && v.newPassword === v.currentPassword) {
        ctx.addIssue({ code: "custom", path: ["newPassword"], message: "현재 비밀번호와 다른 비밀번호를 사용하세요." });
      }
    });
}

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
