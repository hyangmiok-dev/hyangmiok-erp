/**
 * 로그인 식별자 처리.
 * 이메일이 없는 현장 직원은 '아이디'로 로그인한다. Supabase Auth 는 이메일이 필요하므로
 * 아이디를 `아이디@<내부도메인>` 형태의 가상 이메일로 변환한다. 이 주소로 메일은 발송되지 않으며
 * 비밀번호 초기화는 대표가 계정 관리 화면에서 한다.
 */

export const LOGIN_ID_PATTERN = /^[a-z0-9._-]{3,30}$/;

export function normalizeIdentifier(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isEmail(identifier: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
}

/** 사용자가 입력한 아이디 또는 이메일을 Auth 이메일로 변환. 형식이 틀리면 null. */
export function toAuthEmail(raw: string, domain: string): string | null {
  const v = normalizeIdentifier(raw);
  if (!v) return null;
  if (v.includes("@")) return isEmail(v) ? v : null;
  return LOGIN_ID_PATTERN.test(v) ? `${v}@${domain}` : null;
}
