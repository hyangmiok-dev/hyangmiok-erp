"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth/dal";
import { canManageStore } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { formatKRW } from "@/lib/format";
import { toConfirmLines } from "@/lib/statements";
import { confirmFormToObject, confirmStatementSchema, createStatementSchema } from "@/lib/validation/statements";
import { toFieldErrors, type ActionResult } from "@/lib/validation/users";

const ROLES = ["owner", "hq_manager", "store_manager"] as const;

function dbMessage(msg: string): string {
  // DB 함수가 한국어로 알려 주는 이유(권한·날짜·합계 등)는 그대로 보여 준다
  if (/[가-힣]/.test(msg)) return msg.slice(0, 200);
  if (msg.includes("row-level security")) return "이 지점에 올릴 권한이 없습니다.";
  return "저장 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.";
}

/** 사진을 보관함에 올린 뒤 거래명세표 기록을 만든다 → AI 읽기는 화면에서 Edge Function 으로 */
export async function createStatementAction(input: {
  storeId: string;
  vendorId: string;
  photoPath: string;
  photoBytes: number;
}): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const auth = await authorizeAction(ROLES);
  if (!auth.ok) return { ok: false, message: auth.message };
  const parsed = createStatementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  const v = parsed.data;
  if (!canManageStore(auth.user, v.storeId)) return { ok: false, message: "이 지점에 올릴 권한이 없습니다." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_statements")
    .insert({ store_id: v.storeId, vendor_id: v.vendorId, photo_path: v.photoPath, photo_bytes: v.photoBytes })
    .select("id")
    .single();
  if (error || !data) return { ok: false, message: dbMessage(error?.message ?? "") };
  revalidatePath("/statements");
  return { ok: true, id: data.id as string };
}

/** 확인 후 확정 → 식재료 지출 + 품목 줄 (DB 함수 하나로, 권한·합계는 DB 가 다시 검사) */
export async function confirmStatementAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction(ROLES);
  if (!auth.ok) return { ok: false, message: auth.message };

  const parsed = confirmStatementSchema.safeParse(confirmFormToObject(fd));
  if (!parsed.success) {
    const fieldErrors = toFieldErrors(parsed.error);
    return { ok: false, fieldErrors, message: Object.values(fieldErrors)[0] ?? "입력값을 확인하세요." };
  }
  const v = parsed.data;
  const lines = toConfirmLines(v.lines, v.vat);
  const total = lines.reduce((n, l) => n + l.amount, 0);

  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_purchase_statement", {
    p_statement_id: v.statementId,
    p_date: v.date,
    p_lines: lines,
    p_on_credit: v.onCredit,
    p_statement_total: v.statementTotal,
    p_statement_balance: v.statementBalance,
    p_memo: v.memo,
  });
  if (error) return { ok: false, message: dbMessage(error.message) };

  revalidatePath("/statements", "layout");
  revalidatePath("/expenses");
  revalidatePath("/payables", "layout");
  revalidatePath("/");
  return { ok: true, message: `확정했어요. ${formatKRW(total)}${v.onCredit ? " (외상 → 거래처 미수에 더해짐)" : ""}` };
}

export async function discardStatementAction(id: string, memo: string): Promise<ActionResult> {
  const auth = await authorizeAction(ROLES);
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, message: "잘못된 요청입니다." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("discard_purchase_statement", { p_statement_id: id, p_memo: memo.slice(0, 200) || null });
  if (error) return { ok: false, message: dbMessage(error.message) };
  revalidatePath("/statements", "layout");
  return { ok: true, message: "버렸어요. (사진과 기록은 남아요)" };
}
