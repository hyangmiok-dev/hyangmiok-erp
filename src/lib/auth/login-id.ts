/**
 * 로그인 식별자 처리.
 * 현장 직원은 '이름'(예: 김민수, 동명이인은 김민수2)으로 로그인한다. Supabase Auth 는 이메일이 필요하고
 * 한글 이메일을 허용하지 않을 수 있으므로, 아이디를 UTF-8 16진수로 바꾼 가상 이메일
 * `id-<hex>@<내부도메인>` 을 쓴다. 이 주소로 메일은 발송되지 않으며 비밀번호 초기화는 대표가 한다.
 */

/** 한글·영문 소문자·숫자·._- 2~20자 (DB profiles_login_id_check 와 동일) */
export const LOGIN_ID_PATTERN = /^[가-힣a-z0-9._-]{2,20}$/u;

export function normalizeIdentifier(raw: string): string {
  return raw.normalize("NFC").trim().toLowerCase();
}

/** 이름 → 아이디 후보 (공백 제거) */
export function loginIdFromName(name: string): string {
  return normalizeIdentifier(name).replace(/\s+/g, "");
}

export function isEmail(identifier: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
}

export function loginIdToEmail(loginId: string, domain: string): string {
  const hex = Array.from(new TextEncoder().encode(loginId), (b) => b.toString(16).padStart(2, "0")).join("");
  return `id-${hex}@${domain}`;
}

/** 사용자가 입력한 아이디(이름) 또는 이메일을 Auth 이메일로 변환. 형식이 틀리면 null. */
export function toAuthEmail(raw: string, domain: string): string | null {
  const v = normalizeIdentifier(raw);
  if (!v) return null;
  if (v.includes("@")) return isEmail(v) ? v : null;
  const id = v.replace(/\s+/g, "");
  return LOGIN_ID_PATTERN.test(id) ? loginIdToEmail(id, domain) : null;
}
