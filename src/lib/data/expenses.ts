import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DateRange } from "@/lib/period";
import type { ExpenseItem, InventoryCount, Section } from "@/lib/pnl";

export interface Category {
  id: string;
  code: string;
  name: string;
  section: Section;
  description: string | null;
}

export interface ExpenseDetail extends ExpenseItem {
  id: string;
  vendor: string | null;
  vendorId: string | null;
  description: string | null;
  onCredit: boolean;
  updatedAt: string;
}

export interface ExpenseLine {
  expenseId: string;
  lineNo: number;
  itemName: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  amount: number;
}

export async function listCategories(): Promise<Category[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expense_categories")
    .select("id, code, name, section, description")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw new Error(`지출 항목 조회 실패: ${error.message}`);
  return (data ?? []) as Category[];
}

/** 기간 지출 (RLS: 대표 전체, 본사 관리자 소속 지점) */
export async function listExpenses(range: DateRange, storeIds?: string[]): Promise<ExpenseDetail[]> {
  const supabase = await createClient();
  let q = supabase
    .from("expenses")
    .select("id, store_id, expense_date, category_id, vendor, vendor_id, description, amount, basis, on_credit, updated_at, expense_categories(name, section)")
    .gte("expense_date", range.start)
    .lte("expense_date", range.end)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (storeIds?.length) q = q.in("store_id", storeIds);
  const { data, error } = await q;
  if (error) throw new Error(`지출 조회 실패: ${error.message}`);
  return (data ?? []).map((r) => {
    const cat = r.expense_categories as unknown as { name: string; section: Section } | null;
    return {
      id: r.id,
      storeId: r.store_id,
      date: r.expense_date,
      categoryId: r.category_id,
      categoryName: cat?.name ?? "?",
      section: cat?.section ?? "opex",
      vendor: r.vendor,
      vendorId: r.vendor_id,
      description: r.description,
      amount: Number(r.amount),
      basis: r.basis as ExpenseItem["basis"],
      onCredit: r.on_credit,
      updatedAt: r.updated_at,
    };
  });
}

export async function getExpense(id: string): Promise<ExpenseDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("expenses").select("expense_date").eq("id", id).maybeSingle();
  if (!data) return null;
  const rows = await listExpenses({ start: data.expense_date, end: data.expense_date });
  return rows.find((r) => r.id === id) ?? null;
}

export async function listInventory(dates: string[], storeIds?: string[]): Promise<InventoryCount[]> {
  if (!dates.length) return [];
  const supabase = await createClient();
  let q = supabase.from("inventory_counts").select("store_id, count_date, amount").in("count_date", dates);
  if (storeIds?.length) q = q.in("store_id", storeIds);
  const { data, error } = await q;
  if (error) throw new Error(`재고 조회 실패: ${error.message}`);
  return (data ?? []).map((r) => ({ storeId: r.store_id, date: r.count_date, amount: Number(r.amount) }));
}

/** 최근 6개월 거래처 이름 (입력 자동완성용) */
export async function recentVendors(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("expenses")
    .select("vendor")
    .not("vendor", "is", null)
    .order("expense_date", { ascending: false })
    .limit(1000);
  return [...new Set((data ?? []).map((r) => r.vendor as string))].slice(0, 200);
}

/** 지출들의 품목 줄 */
export async function listExpenseLines(expenseIds: string[]): Promise<ExpenseLine[]> {
  if (!expenseIds.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expense_lines")
    .select("expense_id, line_no, item_name, quantity, unit, unit_price, amount")
    .in("expense_id", expenseIds)
    .order("line_no");
  if (error) throw new Error(`품목 조회 실패: ${error.message}`);
  return (data ?? []).map((l) => ({
    expenseId: l.expense_id,
    lineNo: l.line_no,
    itemName: l.item_name,
    quantity: Number(l.quantity),
    unit: l.unit,
    unitPrice: Number(l.unit_price),
    amount: Number(l.amount),
  }));
}

export interface ItemSuggestion {
  name: string;
  unit: string | null;
  lastPrice: number;
  lastDate: string;
}

/** 거래처별 최근 품목(이름·단위·마지막 단가) — 지출 입력 시 자동 채우기용 */
export async function recentItemsByVendor(sinceDate: string): Promise<Record<string, ItemSuggestion[]>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("expense_lines")
    .select("item_name, unit, unit_price, expenses!inner(vendor_id, expense_date)")
    .gte("expenses.expense_date", sinceDate)
    .not("expenses.vendor_id", "is", null)
    .limit(3000);
  const out: Record<string, Map<string, ItemSuggestion>> = {};
  for (const r of data ?? []) {
    const e = r.expenses as unknown as { vendor_id: string; expense_date: string };
    const key = `${r.item_name}|${r.unit ?? ""}`;
    const m = (out[e.vendor_id] ??= new Map());
    const cur = m.get(key);
    if (!cur || e.expense_date > cur.lastDate) {
      m.set(key, { name: r.item_name, unit: r.unit, lastPrice: Number(r.unit_price), lastDate: e.expense_date });
    }
  }
  return Object.fromEntries(
    Object.entries(out).map(([v, m]) => [v, [...m.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate))]),
  );
}