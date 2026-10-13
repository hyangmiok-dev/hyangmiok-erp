"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAction } from "@/lib/auth/dal";
import { canAccessStore, canManageStore } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { formatKRW } from "@/lib/format";
import type { ActionResult } from "@/lib/validation/users";

const ALL = ["owner", "hq_manager", "store_manager", "staff"] as const;
const MANAGERS = ["owner", "hq_manager", "store_manager"] as const;

function dbMessage(msg: string): string {
  // DB 함수가 한국어로 알려 주는 이유는 그대로 보여 준다
  if (/[가-힣]/.test(msg)) return msg.slice(0, 200);
  if (msg.includes("row-level security") || msg.includes("permission denied")) return "권한이 없습니다.";
  return "저장 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.";
}

const qty = z
  .union([z.number(), z.string()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,7}(\.\d{1,3})?$/.test(v) && Number(v) > 0, "수량을 확인하세요.");

const saveOrderSchema = z.object({
  storeId: z.uuid(),
  lines: z.array(z.object({ itemId: z.uuid(), qty })).max(200),
  submit: z.boolean(),
});

/** 발주 저장 / [발주 완료] — DB 함수 save_order 가 권한·시간(밤 9시)·품목을 다시 검사 */
export async function saveOrderAction(input: z.input<typeof saveOrderSchema>): Promise<ActionResult> {
  const auth = await authorizeAction(ALL);
  if (!auth.ok) return { ok: false, message: auth.message };
  const parsed = saveOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  const v = parsed.data;
  if (!canAccessStore(auth.user, v.storeId)) return { ok: false, message: "이 지점의 발주를 할 권한이 없습니다." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_order", {
    p_store_id: v.storeId,
    p_lines: v.lines.map((l) => ({ item_id: l.itemId, qty: l.qty })),
    p_submit: v.submit,
  });
  if (error) return { ok: false, message: dbMessage(error.message) };
  revalidatePath("/orders");
  return {
    ok: true,
    message: v.lines.length === 0 ? "발주를 비웠어요." : v.submit ? `발주 완료! ${v.lines.length}개 품목 — 밤 9시에 텔레그램으로 가요.` : "저장했어요.",
  };
}

const priceStr = z.string().trim().regex(/^\d{1,9}$/, "단가를 숫자로 적어 주세요.");
const completeSchema = z.object({
  orderId: z.uuid(),
  vendorId: z.uuid({ message: "거래처를 골라 주세요." }),
  lines: z
    .array(
      z.discriminatedUnion("status", [
        z.object({ line_id: z.uuid(), status: z.literal("ok") }),
        z.object({ line_id: z.uuid(), status: z.literal("missing") }),
        z.object({
          line_id: z.uuid(),
          status: z.literal("changed"),
          qty: z.string().trim().regex(/^\d{1,7}(\.\d{1,3})?$/, "받은 수량을 숫자로 적어 주세요."),
          price: priceStr,
        }),
      ]),
    )
    .min(1, "확인할 품목이 없습니다."),
  vat: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{1,9}$/.test(v), "부가세는 숫자로 적어 주세요.")
    .transform((v) => (v === "" ? 0 : Number(v))),
  receiptTotal: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{1,10}$/.test(v), "영수증 합계는 숫자로 적어 주세요.")
    .transform((v) => (v === "" ? null : Number(v))),
  memo: z.string().trim().max(200, "메모는 200자 이하로 적어 주세요."),
});

/** [입고 완료] — DB 함수 complete_receipt 가 모든 줄 확인·합계·권한을 다시 검사하고 지출을 만든다 */
export async function completeReceiptAction(input: z.input<typeof completeSchema>): Promise<ActionResult> {
  const auth = await authorizeAction(ALL);
  if (!auth.ok) return { ok: false, message: auth.message };
  const parsed = completeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_receipt", {
    p_order_id: v.orderId,
    p_vendor_id: v.vendorId,
    p_lines: v.lines,
    p_vat: v.vat,
    p_receipt_total: v.receiptTotal,
    p_memo: v.memo || null,
  });
  if (error) return { ok: false, message: dbMessage(error.message) };
  revalidatePath("/receiving");
  revalidatePath("/orders");
  revalidatePath("/payables", "layout");
  revalidatePath("/expenses");
  revalidatePath("/");
  return { ok: true, message: `입고 완료! ${v.receiptTotal !== null ? formatKRW(v.receiptTotal) : ""}`.trim() };
}

/** 대표: 텔레그램 연결 시험 */
export async function sendTelegramTestAction(): Promise<ActionResult> {
  const auth = await authorizeAction(["owner"]);
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("send_telegram_test");
  if (error) return { ok: false, message: dbMessage(error.message) };
  return data
    ? { ok: true, message: "시험 메시지를 보냈어요. 텔레그램을 확인해 보세요." }
    : { ok: false, message: "텔레그램 열쇠(봇 토큰·방 번호)가 아직 Supabase 에 없어요." };
}

/** 관리자: 오늘 발주를 지금 바로 보내기 */
export async function sendOrdersNowAction(storeId: string): Promise<ActionResult> {
  const auth = await authorizeAction(MANAGERS);
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!canManageStore(auth.user, storeId)) return { ok: false, message: "권한이 없습니다." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("send_orders_now");
  if (error) return { ok: false, message: dbMessage(error.message) };
  revalidatePath("/orders");
  revalidatePath("/receiving");
  return Number(data) > 0
    ? { ok: true, message: `텔레그램으로 ${data}통 보냈어요. (오늘 완료된 모든 지점 발주)` }
    : { ok: false, message: "보낼 발주가 없거나, 텔레그램 열쇠가 아직 없어요." };
}
