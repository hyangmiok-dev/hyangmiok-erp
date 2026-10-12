"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { storeFormToObject, storeUpdateSchema } from "@/lib/validation/stores";
import { toFieldErrors, type ActionResult } from "@/lib/validation/users";

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
