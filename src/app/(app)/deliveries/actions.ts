"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth/dal";
import { canManageStore } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { formatKRW } from "@/lib/format";
import { lineAmount } from "@/lib/payables";
import { deliveryInputSchema, type DeliveryInput } from "@/lib/validation/deliveries";
import type { ActionResult } from "@/lib/validation/users";

const ROLES = ["owner", "hq_manager", "store_manager"] as const;

function dbMessage(msg: string): string {
  // DB 함수가 한국어로 알려 주는 이유(권한·날짜·품목)는 그대로 보여 준다
  if (/[가-힣]/.test(msg)) return msg.slice(0, 200);
  return "저장 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.";
}

function refresh() {
  revalidatePath("/deliveries");
  revalidatePath("/expenses");
  revalidatePath("/payables", "layout");
  revalidatePath("/");
}

/** 입고 저장 → 식재료 지출 + 품목 줄 (DB 함수 record_delivery 가 권한·날짜·금액을 다시 검사) */
export async function recordDeliveryAction(input: DeliveryInput): Promise<ActionResult> {
  const auth = await authorizeAction(ROLES);
  if (!auth.ok) return { ok: false, message: auth.message };
  const parsed = deliveryInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  const v = parsed.data;
  if (!canManageStore(auth.user, v.storeId)) return { ok: false, message: "이 지점에 입고를 입력할 권한이 없습니다." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_delivery", {
    p_store_id: v.storeId,
    p_vendor_id: v.vendorId,
    p_date: v.date,
    p_lines: v.lines.map((l) => ({ item_name: l.itemName, quantity: l.quantity, unit: l.unit, unit_price: l.unitPrice })),
    p_vat: v.vat,
    p_on_credit: v.onCredit,
    p_memo: v.memo,
  });
  if (error) return { ok: false, message: dbMessage(error.message) };

  const total = v.lines.reduce((n, l) => n + lineAmount(Number(l.quantity), Number(l.unitPrice)), 0) + v.vat;
  refresh();
  return { ok: true, message: `저장했어요: ${formatKRW(total)}${v.onCredit ? " (외상 → 거래처 미수)" : ""}` };
}

export async function cancelDeliveryAction(id: string): Promise<ActionResult> {
  const auth = await authorizeAction(ROLES);
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, message: "잘못된 요청입니다." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_delivery", { p_expense_id: id });
  if (error) return { ok: false, message: dbMessage(error.message) };
  refresh();
  return { ok: true, message: "취소했어요. (변경 이력에 남아요)" };
}
