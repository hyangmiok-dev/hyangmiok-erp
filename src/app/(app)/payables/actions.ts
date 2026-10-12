"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { formatKRW, seoulDateKey } from "@/lib/format";
import { paymentFormToObject, paymentInputSchema } from "@/lib/validation/payables";
import { toFieldErrors, type ActionResult } from "@/lib/validation/users";

const CONFLICT = "다른 화면에서 먼저 수정되었습니다. 새로고침 후 다시 시도하세요.";

function refresh() {
  revalidatePath("/payables", "layout");
}

function dbMessage(msg: string): string {
  if (msg.includes("미래 날짜")) return "미래 날짜는 입력할 수 없습니다.";
  if (msg.includes("row-level security")) return "결제는 대표만 입력할 수 있습니다.";
  return "저장 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.";
}

/** 결제(미수 감소) 또는 이월 미수(미수 증가) 저장 */
export async function savePaymentAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction(["owner"]);
  if (!auth.ok) return { ok: false, message: auth.message };

  const parsed = paymentInputSchema.safeParse(paymentFormToObject(fd));
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  const v = parsed.data;
  if (v.paidDate > seoulDateKey()) return { ok: false, fieldErrors: { paidDate: "미래 날짜는 입력할 수 없습니다." } };

  const row = {
    store_id: v.storeId,
    vendor_id: v.vendorId,
    paid_date: v.paidDate,
    kind: v.kind,
    amount: v.amount,
    method: v.kind === "payment" ? v.method : null,
    memo: v.memo,
  };
  const supabase = await createClient();
  if (v.id) {
    let q = supabase.from("vendor_payments").update(row).eq("id", v.id);
    if (v.expectedUpdatedAt) q = q.eq("updated_at", v.expectedUpdatedAt);
    const { data, error } = await q.select("id");
    if (error) return { ok: false, message: dbMessage(error.message) };
    if (!data?.length) return { ok: false, message: CONFLICT };
  } else {
    const { error } = await supabase.from("vendor_payments").insert(row);
    if (error) return { ok: false, message: dbMessage(error.message) };
  }

  refresh();
  return {
    ok: true,
    message: `${v.kind === "opening" ? "이월 미수" : "결제"} ${formatKRW(v.amount)} ${v.id ? "수정" : "저장"}했습니다.`,
  };
}

export async function deletePaymentAction(id: string): Promise<ActionResult> {
  const auth = await authorizeAction(["owner"]);
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, message: "잘못된 요청입니다." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("vendor_payments").delete().eq("id", id).select("id");
  if (error) return { ok: false, message: dbMessage(error.message) };
  if (!data?.length) return { ok: false, message: "이미 삭제되었거나 찾을 수 없습니다." };
  refresh();
  return { ok: true, message: "삭제했습니다. (변경 이력에 남습니다)" };
}
