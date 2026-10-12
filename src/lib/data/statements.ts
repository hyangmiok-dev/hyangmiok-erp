import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { StatementStatus } from "@/lib/statements";

export interface StatementRow {
  id: string;
  storeId: string;
  vendorId: string;
  vendorName: string;
  photoPath: string;
  photoBytes: number;
  status: StatementStatus;
  aiResult: unknown;
  aiError: string | null;
  aiAttempts: number;
  aiModel: string | null;
  statementDate: string | null;
  statementTotal: number | null;
  statementBalance: number | null;
  /** 확정한 금액 (= 만들어진 지출 금액) */
  confirmedTotal: number | null;
  memo: string | null;
  expenseId: string | null;
  createdAt: string;
  createdByName: string | null;
  confirmedAt: string | null;
  confirmedByName: string | null;
}

const COLUMNS =
  "id, store_id, vendor_id, photo_path, photo_bytes, status, ai_result, ai_error, ai_attempts, ai_model, statement_date, statement_total, statement_balance, confirmed_total, memo, expense_id, created_at, confirmed_at, vendors(name), creator:profiles!purchase_statements_created_by_fkey(full_name), confirmer:profiles!purchase_statements_confirmed_by_fkey(full_name)";

type Raw = {
  id: string;
  store_id: string;
  vendor_id: string;
  photo_path: string;
  photo_bytes: number;
  status: string;
  ai_result: unknown;
  ai_error: string | null;
  ai_attempts: number;
  ai_model: string | null;
  statement_date: string | null;
  statement_total: number | string | null;
  statement_balance: number | string | null;
  confirmed_total: number | string | null;
  memo: string | null;
  expense_id: string | null;
  created_at: string;
  confirmed_at: string | null;
  vendors: { name: string } | null;
  creator: { full_name: string } | null;
  confirmer: { full_name: string } | null;
};

const num = (v: number | string | null) => (v === null ? null : Number(v));

function toRow(r: Raw): StatementRow {
  return {
    id: r.id,
    storeId: r.store_id,
    vendorId: r.vendor_id,
    vendorName: r.vendors?.name ?? "거래처",
    photoPath: r.photo_path,
    photoBytes: r.photo_bytes,
    status: r.status as StatementStatus,
    aiResult: r.ai_result,
    aiError: r.ai_error,
    aiAttempts: r.ai_attempts,
    aiModel: r.ai_model,
    statementDate: r.statement_date,
    statementTotal: num(r.statement_total),
    statementBalance: num(r.statement_balance),
    confirmedTotal: num(r.confirmed_total),
    memo: r.memo,
    expenseId: r.expense_id,
    createdAt: r.created_at,
    createdByName: r.creator?.full_name ?? null,
    confirmedAt: r.confirmed_at,
    confirmedByName: r.confirmer?.full_name ?? null,
  };
}

/** 지점의 최근 거래명세표 (RLS: 대표 · 소속 본사/지점 관리자) */
export async function listStatements(storeId: string, limit = 60): Promise<StatementRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_statements")
    .select(COLUMNS)
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`거래명세표 조회 실패: ${error.message}`);
  return ((data ?? []) as unknown as Raw[]).map(toRow);
}

export async function getStatement(id: string): Promise<StatementRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("purchase_statements").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`거래명세표 조회 실패: ${error.message}`);
  return data ? toRow(data as unknown as Raw) : null;
}

/** 같은 지점·거래처·날짜에 이미 확정된 거래명세표 (두 번 올린 것 아닌지 확인용) */
export async function confirmedSameDay(opts: { storeId: string; vendorId: string; date: string; excludeId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_statements")
    .select("id, confirmed_total")
    .eq("store_id", opts.storeId)
    .eq("vendor_id", opts.vendorId)
    .eq("statement_date", opts.date)
    .eq("status", "confirmed")
    .neq("id", opts.excludeId);
  return (data ?? []).map((r) => ({ id: r.id as string, total: num(r.confirmed_total as number | null) }));
}

/** 지출 id → 거래명세표 id (지출 목록에 '사진' 링크용) */
export async function statementIdsByExpense(expenseIds: string[]): Promise<Map<string, string>> {
  if (!expenseIds.length) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.from("purchase_statements").select("id, expense_id").in("expense_id", expenseIds);
  return new Map((data ?? []).map((r) => [r.expense_id as string, r.id as string]));
}

/** 보관 사진 보기용 임시 주소 (30분). RLS: 그 지점 관리자·대표만 */
export async function statementPhotoUrl(path: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.storage.from("statements").createSignedUrl(path, 60 * 30);
  return data?.signedUrl ?? null;
}

/** 사진 보관 용량 합계 (대표: 전체, 그 외: 볼 수 있는 지점) */
export async function photoBytesTotal(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.from("purchase_statements").select("photo_bytes");
  return (data ?? []).reduce((n, r) => n + Number(r.photo_bytes), 0);
}

export interface VendorOption {
  id: string;
  name: string;
  items: string | null;
  onCredit: boolean;
  /** 이 지점과 거래하는 곳 */
  linked: boolean;
}

/** 거래명세표를 올릴 때 고를 거래처 (거래 중인 곳만). 지점 관리자도 볼 수 있다 (0700 정책) */
export async function vendorOptionsForStore(storeId: string): Promise<VendorOption[]> {
  const supabase = await createClient();
  const [{ data: vendors, error }, { data: links }] = await Promise.all([
    supabase.from("vendors").select("id, name, items, on_credit, sort_order").eq("is_active", true).order("sort_order").order("name"),
    supabase.from("vendor_stores").select("vendor_id").eq("store_id", storeId),
  ]);
  if (error) throw new Error(`거래처 조회 실패: ${error.message}`);
  const linked = new Set((links ?? []).map((l) => l.vendor_id as string));
  return (vendors ?? [])
    .map((v) => ({ id: v.id as string, name: v.name as string, items: v.items as string | null, onCredit: Boolean(v.on_credit), linked: linked.has(v.id as string) }))
    .sort((a, b) => Number(b.linked) - Number(a.linked));
}
