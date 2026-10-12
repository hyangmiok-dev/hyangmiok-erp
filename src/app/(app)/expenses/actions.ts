"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { endOfMonth } from "@/lib/period";
import { formatKRW, seoulDateKey } from "@/lib/format";
import { isMonthKey, monthRange, prevMonth } from "@/lib/pnl";
import { expenseFormToObject, expenseInputSchema, inventoryInputSchema } from "@/lib/validation/expenses";
import { toFieldErrors, type ActionResult } from "@/lib/validation/users";

const OWNER = ["owner"] as const;
const CONFLICT = "다른 화면에서 이 지출이 먼저 수정되었습니다. 새로고침 후 다시 시도하세요.";

function refresh() {
  revalidatePath("/expenses");
  revalidatePath("/pnl");
  revalidatePath("/");
}

function dbMessage(msg: string): string {
  if (msg.includes("미래 날짜")) return "미래 날짜는 입력할 수 없습니다.";
  if (msg.includes("row-level security")) return "지출은 대표만 입력할 수 있습니다.";
  if (msg.includes("지점은 바꿀 수 없습니다")) return "지점은 바꿀 수 없습니다. 삭제 후 다시 입력하세요.";
  if (msg.includes("거래처를 골라야")) return "외상(미수)은 거래처를 골라야 기록할 수 있어요.";
  return "저장 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.";
}

export async function saveExpenseAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction(OWNER);
  if (!auth.ok) return { ok: false, message: auth.message };

  const parsed = expenseInputSchema.safeParse(expenseFormToObject(fd));
  if (!parsed.success) {
    // 품목 줄 오류는 '몇 번째 줄'인지 알려준다
    const lineIssue = parsed.error.issues.find((i) => i.path[0] === "lines");
    const fieldErrors = toFieldErrors(parsed.error);
    if (lineIssue) {
      const n = typeof lineIssue.path[1] === "number" ? `${lineIssue.path[1] + 1}번째 줄: ` : "";
      fieldErrors.lines = `${n}${lineIssue.message}`;
    }
    return { ok: false, fieldErrors };
  }
  const v = parsed.data;
  if (v.expenseDate > seoulDateKey()) return { ok: false, fieldErrors: { expenseDate: "미래 날짜는 입력할 수 없습니다." } };

  const supabase = await createClient();

  // 거래처 연결: 버튼으로 고른 거래처, 또는 직접 쓴 이름이 거래처 목록과 같으면 자동 연결
  let vendorId: string | null = v.vendorId ?? null;
  let vendorName = v.vendor;
  if (vendorId) {
    const { data: found } = await supabase.from("vendors").select("id, name").eq("id", vendorId).maybeSingle();
    if (found) vendorName = vendorName ?? found.name;
    else vendorId = null;
  } else if (vendorName) {
    const { data: found } = await supabase.from("vendors").select("id").eq("name", vendorName).maybeSingle();
    vendorId = found?.id ?? null;
  }
  if (v.onCredit && !vendorId) {
    return {
      ok: false,
      fieldErrors: { vendor: "외상(미수)은 거래처 목록에 있는 거래처만 가능해요. 거래처 버튼을 누르거나 거래처 관리에서 먼저 추가하세요." },
    };
  }

  // 지출 + 품목 줄을 한 번에 저장 (DB 함수가 합계 검증·동시 수정 감지)
  const { error } = await supabase.rpc("save_expense_with_lines", {
    p_expense: {
      id: v.id ?? null,
      store_id: v.storeId,
      expense_date: v.expenseDate,
      category_id: v.categoryId,
      vendor: vendorName,
      vendor_id: vendorId,
      description: v.description,
      amount: v.amount,
      basis: v.basis,
      on_credit: v.onCredit,
    },
    p_lines: v.lines.map((l) => ({
      item_name: l.itemName,
      quantity: l.quantity,
      unit: l.unit,
      unit_price: l.unitPrice,
      amount: l.amount,
    })),
    p_expected_updated_at: v.id ? (v.expectedUpdatedAt ?? null) : null,
  });
  if (error) {
    if (error.message.includes("먼저 수정")) return { ok: false, message: CONFLICT };
    if (error.message.includes("품목 금액 합계")) return { ok: false, fieldErrors: { lines: "품목 금액 합계가 맞지 않습니다. 다시 확인하세요." } };
    return { ok: false, message: dbMessage(error.message) };
  }

  refresh();
  revalidatePath("/payables");
  revalidatePath("/purchases");
  return {
    ok: true,
    message: `${v.id ? "수정" : "저장"}: ${vendorName ?? ""} ${formatKRW(v.amount)}${v.onCredit ? " (외상·미수)" : ""}`.trim(),
  };
}
export async function deleteExpenseAction(id: string): Promise<ActionResult> {
  const auth = await authorizeAction(OWNER);
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, message: "잘못된 요청입니다." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("expenses").delete().eq("id", id).select("id");
  if (error) return { ok: false, message: dbMessage(error.message) };
  if (!data?.length) return { ok: false, message: "이미 삭제되었거나 찾을 수 없습니다." };
  refresh();
  return { ok: true, message: "삭제했습니다. (변경 이력에 남습니다)" };
}

/**
 * 지난달 고정비 불러오기: 지난달의 인건비·기타 영업비용 중 이번 달에 아직 없는 항목을
 * '추정'으로 복사한다. 식재료(매입)·제외 항목은 복사하지 않는다. 금액 확인 후 '실제'로 바꿔야 확정된다.
 */
export async function copyRecurringAction(storeId: string, month: string): Promise<ActionResult> {
  const auth = await authorizeAction(OWNER);
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!/^[0-9a-f-]{36}$/i.test(storeId) || !isMonthKey(month)) return { ok: false, message: "잘못된 요청입니다." };

  const today = seoulDateKey();
  const cur = monthRange(month);
  const last = monthRange(prevMonth(month));
  const supabase = await createClient();

  const [{ data: lastRows, error: e1 }, { data: curRows, error: e2 }] = await Promise.all([
    supabase
      .from("expenses")
      .select("expense_date, category_id, vendor, vendor_id, description, amount, expense_categories!inner(section)")
      .eq("store_id", storeId)
      .gte("expense_date", last.start)
      .lte("expense_date", last.end)
      .in("expense_categories.section", ["labor", "opex"]),
    supabase.from("expenses").select("category_id").eq("store_id", storeId).gte("expense_date", cur.start).lte("expense_date", cur.end),
  ]);
  if (e1 || e2) return { ok: false, message: dbMessage((e1 ?? e2)!.message) };

  const present = new Set((curRows ?? []).map((r) => r.category_id));
  const toCopy = (lastRows ?? []).filter((r) => !present.has(r.category_id));
  if (toCopy.length === 0) return { ok: true, message: "복사할 항목이 없습니다 (지난달 고정비가 없거나 이미 이번 달에 입력됨)." };

  const rows = toCopy.map((r) => {
    // 같은 '일'로 옮기되, 이번 달에 없는 날(31일 등)·미래면 말일/오늘로
    let date = `${month}-${r.expense_date.slice(8, 10)}`;
    if (date > endOfMonth(cur.start)) date = endOfMonth(cur.start);
    if (date > today) date = today < cur.start ? cur.start : today;
    return {
      store_id: storeId,
      expense_date: date,
      category_id: r.category_id,
      vendor: r.vendor,
      vendor_id: r.vendor_id,
      description: `[지난달 복사·금액 확인 필요] ${r.description ?? ""}`.trim().slice(0, 200),
      amount: r.amount,
      basis: "estimated" as const,
    };
  });
  if (cur.start > today) return { ok: false, message: "아직 시작하지 않은 달에는 복사할 수 없습니다." };

  const { error } = await supabase.from("expenses").insert(rows);
  if (error) return { ok: false, message: dbMessage(error.message) };
  refresh();
  return { ok: true, message: `${rows.length}건을 '추정'으로 복사했습니다. 금액을 확인하고 '실제'로 바꿔 주세요.` };
}

export async function saveInventoryAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction(OWNER);
  if (!auth.ok) return { ok: false, message: auth.message };

  const parsed = inventoryInputSchema.safeParse({
    storeId: fd.get("storeId"),
    countDate: fd.get("countDate"),
    amount: fd.get("amount"),
    memo: fd.get("memo") ?? "",
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  const v = parsed.data;
  if (v.countDate > seoulDateKey()) return { ok: false, message: "아직 오지 않은 날짜의 재고는 입력할 수 없습니다." };
  // 월말 기준으로만 받는다 (손익 계산 기준일)
  if (v.countDate !== endOfMonth(v.countDate)) return { ok: false, message: "재고는 월말 날짜로 입력하세요." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("inventory_counts")
    .upsert(
      { store_id: v.storeId, count_date: v.countDate, amount: v.amount, memo: v.memo },
      { onConflict: "store_id,count_date" },
    );
  if (error) return { ok: false, message: dbMessage(error.message) };
  refresh();
  return { ok: true, message: `${v.countDate} 재고 ${formatKRW(v.amount)} 저장` };
}
