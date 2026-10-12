/**
 * 거래명세표 AI 읽기 — 순서와 검사 (SDK·Deno 를 직접 쓰지 않아 Node 테스트로 검증한다).
 *  1) begin_statement_ai: 권한·횟수 확인 + 시도 기록 (사용자 권한, RLS)
 *  2) 사진: 요청에 담긴 선명한 사진, 없으면 보관된 사진
 *  3) AI 호출 → 4) finish_statement_ai 로 결과 기록 → 5) 화면에 돌려줌
 */
import type { StatementRead } from "./schema.ts";

export type ExtractOutcome =
  | { ok: true; result: StatementRead; model: string; usage: Record<string, number> }
  | { ok: false; error: string; model?: string; usage?: Record<string, number> };

export interface ReadDeps {
  today(): string;
  begin(statementId: string): Promise<{ photo_path: string; vendor_name: string; attempt: number }>;
  finish(
    statementId: string,
    r: { ok: boolean; result: StatementRead | null; model: string | null; usage: Record<string, number> | null; error: string | null },
  ): Promise<void>;
  download(path: string): Promise<Uint8Array>;
  extract(input: { imageBase64: string; vendorName: string; today: string }): Promise<ExtractOutcome>;
}

export interface ReadResponse {
  status: number;
  body: { ok: true; result: StatementRead } | { ok: false; error: string };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** JPEG base64 는 '/9j/' 로 시작한다 */
const JPEG_BASE64 = /^\/9j\/[A-Za-z0-9+/]+={0,2}$/;
/** Claude 이미지 한 장 최대 5MB */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/** 바이트 → base64 (큰 사진도 콜스택이 넘치지 않게 나눠서) */
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function message(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return m.trim().slice(0, 200) || fallback;
}

export async function readStatement(body: unknown, deps: ReadDeps): Promise<ReadResponse> {
  const input = (body ?? {}) as { statementId?: unknown; image?: unknown };
  const statementId = typeof input.statementId === "string" ? input.statementId : "";
  if (!UUID.test(statementId)) return { status: 400, body: { ok: false, error: "잘못된 요청입니다." } };

  let image: string | null = null;
  if (input.image !== undefined && input.image !== null) {
    if (typeof input.image !== "string" || !JPEG_BASE64.test(input.image)) {
      return { status: 400, body: { ok: false, error: "사진 형식이 올바르지 않습니다 (JPEG)." } };
    }
    if (base64Bytes(input.image) > MAX_IMAGE_BYTES) {
      return { status: 413, body: { ok: false, error: "사진이 너무 큽니다 (5MB 이하)." } };
    }
    image = input.image;
  }

  // 1) 권한·횟수 (DB 가 거절하면 그 이유를 그대로 보여 준다)
  let started: Awaited<ReturnType<ReadDeps["begin"]>>;
  try {
    started = await deps.begin(statementId);
  } catch (e) {
    return { status: 403, body: { ok: false, error: message(e, "AI 읽기를 시작할 수 없습니다.") } };
  }

  const fail = async (error: string, extra: { model?: string; usage?: Record<string, number> } = {}): Promise<ReadResponse> => {
    try {
      await deps.finish(statementId, { ok: false, result: null, model: extra.model ?? null, usage: extra.usage ?? null, error });
    } catch {
      // 기록 실패는 화면 안내에 영향 없음
    }
    return { status: 200, body: { ok: false, error } };
  };

  // 2) 사진
  if (!image) {
    try {
      const bytes = await deps.download(started.photo_path);
      if (bytes.length > MAX_IMAGE_BYTES) return fail("보관된 사진이 너무 큽니다.");
      image = toBase64(bytes);
    } catch {
      return fail("보관된 사진을 불러오지 못했습니다. 다시 찍어 올려 주세요.");
    }
  }

  // 3) AI
  let out: ExtractOutcome;
  try {
    out = await deps.extract({ imageBase64: image, vendorName: started.vendor_name, today: deps.today() });
  } catch (e) {
    return fail(message(e, "AI 연결에 실패했습니다."));
  }
  if (!out.ok) return fail(out.error, { model: out.model, usage: out.usage });

  const result: StatementRead = out.result.is_statement ? out.result : { ...out.result, lines: [] };
  if (!result.is_statement) {
    return fail("거래명세표 사진이 아닌 것 같아요. 다시 찍거나 직접 적어 주세요.", { model: out.model, usage: out.usage });
  }

  // 4) 기록
  try {
    await deps.finish(statementId, { ok: true, result, model: out.model, usage: out.usage, error: null });
  } catch (e) {
    return { status: 500, body: { ok: false, error: message(e, "AI 결과를 저장하지 못했습니다.") } };
  }
  return { status: 200, body: { ok: true, result } };
}
