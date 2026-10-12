"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth/dal";
import { canManageStore } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { addDays, shortDateKo } from "@/lib/period";
import { seoulDateKey, formatKRW } from "@/lib/format";
import { importPayloadSchema, saleFormToObject, saleInputSchema } from "@/lib/validation/sales";
import { toFieldErrors, type ActionResult } from "@/lib/validation/users";

const MANAGERS = ["owner", "hq_manager", "store_manager"] as const;

const CONFLICT = "다른 사람이 방금 이 날짜 매출을 저장했습니다. 화면을 새로고침해서 확인한 뒤 다시 저장하세요.";

function dbMessage(msg: string): string {
  if (msg.includes("7일이 지난")) return "7일이 지난 매출은 대표만 입력·수정할 수 있습니다.";
  if (msg.includes("미래 날짜")) return "미래 날짜의 매출은 입력할 수 없습니다.";
  if (msg.includes("row-level security") || msg.includes("권한")) return "이 지점의 매출을 입력할 권한이 없습니다.";
  return "저장 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.";
}

export async function saveSaleAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction(MANAGERS);
  if (!auth.ok) return { ok: false, message: auth.message };

  const parsed = saleInputSchema.safeParse(saleFormToObject(fd));
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  const v = parsed.data;

  if (!canManageStore(auth.user, v.storeId)) return { ok: false, message: "이 지점의 매출을 입력할 권한이 없습니다." };
  const today = seoulDateKey();
  if (v.businessDate > today) return { ok: false, fieldErrors: { businessDate: "미래 날짜는 입력할 수 없습니다." } };
  if (auth.user.role !== "owner" && v.businessDate < addDays(today, -7)) {
    return { ok: false, fieldErrors: { businessDate: "7일이 지난 매출은 대표만 입력·수정할 수 있습니다." } };
  }

  const supabase = await createClient();
  const values = {
    net_sales: v.netSales!,
    order_count: v.orderCount!,
    is_closed: v.isClosed,
    memo: v.memo,
    source: "manual" as const,
  };

  const { data: existing, error: findErr } = await supabase
    .from("daily_sales")
    .select("id, updated_at")
    .eq("store_id", v.storeId)
    .eq("business_date", v.businessDate)
    .maybeSingle();
  if (findErr) return { ok: false, message: dbMessage(findErr.message) };

  if (existing) {
    // 수정: 화면을 열었을 때의 값과 DB 값이 같을 때만 저장 (점장·부점장 동시 입력 대비)
    if (!v.expectedUpdatedAt || new Date(v.expectedUpdatedAt).getTime() !== new Date(existing.updated_at).getTime()) {
      return { ok: false, message: CONFLICT };
    }
    const { data: updated, error } = await supabase
      .from("daily_sales")
      .update(values)
      .eq("id", existing.id)
      .eq("updated_at", existing.updated_at)
      .select("id");
    if (error) return { ok: false, message: dbMessage(error.message) };
    if (!updated?.length) return { ok: false, message: CONFLICT };
  } else {
    const { error } = await supabase
      .from("daily_sales")
      .insert({ store_id: v.storeId, business_date: v.businessDate, ...values });
    if (error) return { ok: false, message: error.code === "23505" ? CONFLICT : dbMessage(error.message) };
  }

  revalidatePath("/sales");
  revalidatePath("/");
  return {
    ok: true,
    message: v.isClosed
      ? `${shortDateKo(v.businessDate)} 휴무로 저장했습니다.`
      : `${shortDateKo(v.businessDate)} 저장 완료: ${formatKRW(v.netSales!)} · ${v.orderCount}건`,
  };
}

export interface ImportResult extends ActionResult {
  inserted?: number;
  updated?: number;
  skipped?: number;
}

export async function importSalesAction(payload: unknown): Promise<ImportResult> {
  const auth = await authorizeAction(MANAGERS);
  if (!auth.ok) return { ok: false, message: auth.message };

  const parsed = importPayloadSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const { fileName, overwrite, rows } = parsed.data;

  const today = seoulDateKey();
  const minDate = auth.user.role === "owner" ? "0000-01-01" : addDays(today, -7);
  const bad = rows.find(
    (r) => !canManageStore(auth.user, r.store_id) || r.business_date > today || r.business_date < minDate,
  );
  if (bad) {
    return {
      ok: false,
      message:
        bad.business_date > today
          ? `미래 날짜(${bad.business_date})가 있습니다.`
          : bad.business_date < minDate
            ? `7일이 지난 날짜(${bad.business_date})는 대표만 등록할 수 있습니다.`
            : "권한이 없는 지점의 행이 있습니다.",
    };
  }
  const closedWithSales = rows.find((r) => r.is_closed && (r.net_sales > 0 || r.order_count > 0));
  if (closedWithSales) return { ok: false, message: `휴무인데 매출이 있는 행이 있습니다 (${closedWithSales.business_date}).` };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_daily_sales", {
    p_file_name: fileName,
    p_rows: rows,
    p_overwrite: overwrite,
  });
  if (error) return { ok: false, message: `등록 실패 (아무것도 저장되지 않았습니다): ${dbMessage(error.message)}` };

  const r = data as { inserted: number; updated: number; skipped: number };
  revalidatePath("/sales");
  revalidatePath("/");
  return {
    ok: true,
    ...r,
    message: `새로 ${r.inserted}건 등록, ${r.updated}건 덮어씀, ${r.skipped}건 건너뜀(이미 있음)`,
  };
}
