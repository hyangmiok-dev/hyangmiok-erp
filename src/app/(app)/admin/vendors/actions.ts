"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { vendorFormToObject, vendorInputSchema } from "@/lib/validation/vendors";
import { toFieldErrors, type ActionResult } from "@/lib/validation/users";

function refresh() {
  revalidatePath("/admin/vendors");
  revalidatePath("/expenses");
  revalidatePath("/purchases");
}

function dbMessage(msg: string): string {
  if (msg.includes("vendors_name_key") || msg.includes("duplicate key")) return "같은 이름의 거래처가 이미 있습니다.";
  if (msg.includes("row-level security") || msg.includes("권한")) return "거래처는 대표만 수정할 수 있습니다.";
  if (msg.includes("foreign key") || msg.includes("violates")) {
    return "지출·결제 기록이 있는 거래처는 삭제할 수 없어요. 삭제 대신 [수정]에서 '거래 중' 체크를 해제하세요.";
  }
  return "저장 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.";
}

export async function saveVendorAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction(["owner"]);
  if (!auth.ok) return { ok: false, message: auth.message };

  const parsed = vendorInputSchema.safeParse(vendorFormToObject(fd));
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  const v = parsed.data;

  const supabase = await createClient();
  const row = {
    name: v.name,
    items: v.items,
    default_category_id: v.defaultCategoryId,
    contact_name: v.contactName,
    phone: v.phone,
    memo: v.memo,
    is_active: v.isActive,
    on_credit: v.onCredit,
  };

  let vendorId = v.id;
  if (vendorId) {
    const { data, error } = await supabase.from("vendors").update(row).eq("id", vendorId).select("id");
    if (error) return { ok: false, message: dbMessage(error.message) };
    if (!data?.length) return { ok: false, message: "거래처를 찾을 수 없습니다." };
  } else {
    // 새 거래처는 목록 맨 뒤에
    const { data: last } = await supabase
      .from("vendors")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data, error } = await supabase
      .from("vendors")
      .insert({ ...row, sort_order: (last?.sort_order ?? 0) + 10 })
      .select("id")
      .single();
    if (error) return { ok: false, message: dbMessage(error.message) };
    vendorId = data.id;
  }

  const { error: linkErr } = await supabase.rpc("set_vendor_stores", { p_vendor_id: vendorId, p_store_ids: v.storeIds });
  if (linkErr) return { ok: false, message: `거래처는 저장했지만 거래 지점 저장에 실패했습니다: ${dbMessage(linkErr.message)}` };

  refresh();
  return { ok: true, message: `${v.name} 저장했습니다.` };
}

/** 지출·결제 기록이 없는 거래처만 삭제된다 (기록이 있으면 DB 가 막음 → '거래 중' 해제 안내) */
export async function deleteVendorAction(id: string): Promise<ActionResult> {
  const auth = await authorizeAction(["owner"]);
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, message: "잘못된 요청입니다." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("vendors").delete().eq("id", id).select("name");
  if (error) return { ok: false, message: dbMessage(error.message) };
  if (!data?.length) return { ok: false, message: "이미 삭제되었거나 찾을 수 없습니다." };
  refresh();
  return { ok: true, message: `${data[0].name} 거래처를 삭제했습니다.` };
}
