import { z } from "zod";

/**
 * 환경변수는 이 파일을 통해서만 읽는다.
 * - NEXT_PUBLIC_* : 브라우저에 노출돼도 되는 값
 * - 그 외          : 서버 전용 비밀값 (admin.ts 에서만 사용)
 */

export const APP_ENVS = ["development", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ message: "NEXT_PUBLIC_SUPABASE_URL 이 올바른 URL 이 아닙니다." }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 가 비어 있습니다."),
  NEXT_PUBLIC_APP_ENV: z.enum(APP_ENVS).default("development"),
});

export type PublicEnv = z.infer<typeof publicSchema>;

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

// NEXT_PUBLIC_* 는 빌드 시 문자열로 치환되므로 반드시 process.env.X 형태로 직접 참조해야 한다.
function readPublicRaw() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV || undefined,
  };
}

export function getPublicEnv(): PublicEnv {
  const parsed = publicSchema.safeParse(readPublicRaw());
  if (!parsed.success) {
    throw new EnvError(
      "환경변수가 설정되지 않았습니다. .env.local 을 확인하세요: " +
        parsed.error.issues.map((i) => i.message).join(" / "),
    );
  }
  return parsed.data;
}

export function isEnvConfigured(): boolean {
  return publicSchema.safeParse(readPublicRaw()).success;
}

export function getAppEnv(): AppEnv {
  const v = process.env.NEXT_PUBLIC_APP_ENV;
  return (APP_ENVS as readonly string[]).includes(v ?? "") ? (v as AppEnv) : "development";
}

/** 이메일 없는 직원 아이디를 Supabase Auth 이메일로 바꿀 때 쓰는 도메인 (실제 메일 발송 없음). */
export function getLoginIdDomain(): string {
  return process.env.AUTH_LOGIN_ID_DOMAIN?.trim() || "staff.hyangmiok.invalid";
}
