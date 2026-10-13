"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth/dal";
import { canAccessStore } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { slipsInputSchema, type SlipsInput } from "@/lib/validation/slips";
import type { ActionResult } from "@/lib/validation/users";

const ALL = ["owner", "hq_manager", "store_manager", "staff"] as const;

function dbMessage(msg: string): string {
  // DB 함수가 한국어로 알려 주는 이유(권한·날짜·거래처·품목 상세)는 그대로 보여 준다
  if (/[가-힣]/.test(msg)) return msg.slice(0, 200);
  if (msg.includes("permission denied")) return "권한이 없습니다.";
  return "저장 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.";
}

/** 전표 저장 — 바뀐 칸만. DB 함수 save_slips 가 권한·날짜·거래처·금액을 다시 검사한다 */
export async function saveSlipsAction(input: SlipsInput): Promise<ActionResult> {
  const auth = await authorizeAction(ALL);
  if (!auth.ok) return { ok: false, message: auth.message };
  const parsed = slipsInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  const v = parsed.data;
  if (!canAccessStore(auth.user, v.storeId)) return { ok: false, message: "이 지점에 전표를 입력할 권한이 없습니다." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_slips", {
    p_store_id: v.storeId,
    p_date: v.date,
    p_entries: v.entries.map((e) => ({ vendor_id: e.vendorId, amount: e.amount })),
  });
  if (error) return { ok: false, message: dbMessage(error.message) };

  revalidatePath("/slips");
  revalidatePath("/payables", "layout");
  revalidatePath("/expenses");
  revalidatePath("/");
  const n = Number(data ?? 0);
  return { ok: true, message: n > 0 ? `저장했어요 (${n}곳)` : "바뀐 금액이 없어요." };
}
