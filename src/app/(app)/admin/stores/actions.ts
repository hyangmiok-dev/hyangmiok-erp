"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { STOCK_RESERVE_OPTIONS } from "@/lib/pnl";
import { storeFormToObject, storeUpdateSchema } from "@/lib/validation/stores";
import { toFieldErrors, type ActionResult } from "@/lib/validation/users";

/** 지점별 냉장고 재고 비율(5~10%) — 대표만 (RLS stores_update 도 대표만 허용) */
export async function setStockReserveAction(storeId: string, pct: number): Promise<ActionResult> {
  const auth = await authorizeAction(["owner"]);
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) return { ok: false, message: "잘못된 요청입니다." };
  if (!(STOCK_RESERVE_OPTIONS as readonly number[]).includes(pct)) {
    return { ok: false, message: "냉장고 재고 비율은 5~10% 중에서 골라 주세요." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.from("stores").update({ stock_reserve_pct: pct }).eq("id", storeId).select("name");
  if (error) return { ok: false, message: "저장 중 오류가 발생했습니다. 잠시 후 다시 시도하세요." };
  if (!data?.length) return { ok: false, message: "지점을 찾을 수 없거나 권한이 없습니다." };

  revalidatePath("/", "layout");
  return { ok: true, message: `${data[0].name} 냉장고 재고 비율을 ${pct}%로 바꿨습니다.` };
}

export async function updateStoreAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction(["owner"]);
  if (!auth.ok) return { ok: false, message: auth.message };

  const parsed = storeUpdateSchema.safeParse(storeFormToObject(fd));
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  const v = parsed.data;

  const hasHours = v.open || v.breakStart || v.closedWeekdays.length > 0;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stores")
    .update({
      name: v.name,
      address: v.address,
      seat_count: v.seatCount,
      area_pyeong: v.areaPyeong,
      business_hours: hasHours
        ? {
            open: v.open,
            close: v.close,
            breakStart: v.breakStart,
            breakEnd: v.breakEnd,
            closedWeekdays: [...new Set(v.closedWeekdays)].sort(),
          }
        : null,
      notes: v.notes,
      is_active: v.isActive,
    })
    .eq("id", v.storeId)
    .select("id");
  if (error) return { ok: false, message: `저장 실패: ${error.message}` };
  if (!data?.length) return { ok: false, message: "지점을 찾을 수 없거나 권한이 없습니다." };

  revalidatePath("/admin/stores");
  revalidatePath("/");
  return { ok: true, message: `${v.name} 정보를 저장했습니다.` };
}
