import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DateKey, DateRange } from "@/lib/period";
import type { SaleRow } from "@/lib/sales/summary";

export interface SaleDetail extends SaleRow {
  id: string;
  memo: string | null;
  updatedByName: string | null;
}

const COLUMNS = "id, store_id, business_date, net_sales, order_count, is_closed, memo, source, updated_at, updated_by";

type DbRow = {
  id: string;
  store_id: string;
  business_date: string;
  net_sales: number | string;
  order_count: number;
  is_closed: boolean;
  memo: string | null;
  source: SaleRow["source"];
  updated_at: string;
  updated_by: string | null;
};

function toDetail(r: DbRow, names: Map<string, string>): SaleDetail {
  return {
    id: r.id,
    storeId: r.store_id,
    date: r.business_date,
    // bigint 는 문자열로 올 수 있다. 원 단위 정수는 Number 안전 범위(9천조) 안이다.
    netSales: Number(r.net_sales),
    orderCount: r.order_count,
    isClosed: r.is_closed,
    memo: r.memo,
    source: r.source,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
    updatedByName: r.updated_by ? (names.get(r.updated_by) ?? null) : null,
  };
}

/** 기간 매출 (RLS: 재무 조회 권한이 있는 지점만 반환) */
export async function listSales(range: DateRange, storeIds?: string[]): Promise<SaleDetail[]> {
  const supabase = await createClient();
  let q = supabase
    .from("daily_sales")
    .select(COLUMNS)
    .gte("business_date", range.start)
    .lte("business_date", range.end)
    .order("business_date");
  if (storeIds?.length) q = q.in("store_id", storeIds);
  const { data, error } = await q;
  if (error) throw new Error(`매출 조회 실패: ${error.message}`);
  const rows = (data ?? []) as DbRow[];

  const ids = [...new Set(rows.map((r) => r.updated_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: people } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    for (const p of people ?? []) names.set(p.id, p.full_name);
  }
  return rows.map((r) => toDetail(r, names));
}

export async function getSale(storeId: string, date: DateKey): Promise<SaleDetail | null> {
  const rows = await listSales({ start: date, end: date }, [storeId]);
  return rows[0] ?? null;
}
