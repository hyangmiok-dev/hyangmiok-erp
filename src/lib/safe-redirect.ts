/** 로그인 후 이동 경로: 같은 사이트 내부 경로만 허용 (오픈 리다이렉트 방지). */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string") return "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (next.startsWith("/login")) return "/";
  return next;
}
