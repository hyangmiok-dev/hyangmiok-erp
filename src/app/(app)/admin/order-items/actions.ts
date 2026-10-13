"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAction } from "@/lib/auth/dal";
import { canManageStore } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/validation/users";

const MANAGERS = ["owner", "hq_manager", "store_manager"] as const;

const num = (msg: string) =>
  z
    .string()
    .trim()
    .refine((v) => /^\d{1,7}(\.\d{1,3})?$/.test(v) && Number(v) > 0, msg)
    .transform(Number);

const itemSchema = z.object({
  id: z.uuid().optional(),
  storeId: z.uuid(),
  category: z.string().trim().min(1, "분류를 적어 주세요.").max(20, "분류는 20자 이하로 적어 주세요."),
  name: z.string().trim().min(1, "품목 이름을 적어 주세요.").max(40, "품목 이름은 40자 이하로 적어 주세요."),
  unit: z
    .string()
    .trim()
    .max(10, "단위는 10자 이하로 적어 주세요.")
    .transform((v) => v || null),
  vendorId: z
    .string()
    .trim()
    .transform((v) => v || null)
    .refine((v) => v === null || /^[0-9a-f-]{36}$/i.test(v), "거래처를 다시 골라 주세요."),
  unitPrice: z
    .string()
    .trim()
    .transform((v) => v.replace(/[,\s원]/g, ""))
    .refine((v) => v === "" || /^\d{1,9}$/.test(v), "단가는 숫자로 적어 주세요.")
    .transform((v) => (v === "" ? null : Number(v))),
  defaultQty: num("평소 수량을 숫자로 적어 주세요."),
  step: num("한 번에 늘리는 양을 숫자로 적어 주세요."),
  sortOrder: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{1,5}$/.test(v), "순서는 숫자로 적어 주세요.")
    .transform((v) => (v === "" ? 0 : Number(v))),
  isActive: z.boolean(),
});

export type OrderItemInput = z.input<typeof itemSchema>;

function dbMessage(msg: string): string {
  if (msg.includes("order_items_store_name_key")) return "이 지점에 같은 이름의 품목이 이미 있어요.";
  if (msg.includes("row-level security")) return "품목표를 고칠 권한이 없습니다.";
  return "저장 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.";
}

/** 품목 추가·고치기 (대표·본사·지점 관리자, RLS order_items_insert/update 가 최종 확인) */
export async function saveOrderItemAction(input: OrderItemInput): Promise<ActionResult> {
  const auth = await authorizeAction(MANAGERS);
  if (!auth.ok) return { ok: false, message: auth.message };
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  const v = parsed.data;
  if (!canManageStore(auth.user, v.storeId)) return { ok: false, message: "품목표를 고칠 권한이 없습니다." };

  const row = {
    category: v.category,
    name: v.name,
    unit: v.unit,
    vendor_id: v.vendorId,
    unit_price: v.unitPrice,
    default_qty: v.defaultQty,
    step: v.step,
    sort_order: v.sortOrder,
    is_active: v.isActive,
  };
  const supabase = await createClient();
  if (v.id) {
    const { data, error } = await supabase.from("order_items").update(row).eq("id", v.id).eq("store_id", v.storeId).select("id");
    if (error) return { ok: false, message: dbMessage(error.message) };
    if (!data?.length) return { ok: false, message: "품목을 찾을 수 없거나 권한이 없습니다." };
  } else {
    const { error } = await supabase.from("order_items").insert({ ...row, store_id: v.storeId });
    if (error) return { ok: false, message: dbMessage(error.message) };
  }
  revalidatePath("/admin/order-items");
  revalidatePath("/orders");
  return { ok: true, message: `${v.name} ${v.id ? "고쳤어요" : "추가했어요"}.` };
}
