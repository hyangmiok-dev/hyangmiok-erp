import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DeliveryItem } from "@/lib/deliveries";

export interface VendorOption {
  id: string;
  name: string;
  items: string | null;
  onCredit: boolean;
  /** 이 지점과 거래하는 곳 */
  linked: boolean;
}

/** 입고 입력에서 고를 거래처 (거래 중인 곳만). 지점 관리자도 볼 수 있다 (0700 정책) */
export async function vendorOptionsForStore(storeId: string): Promise<VendorOption[]> {
  const supabase = await createClient();
  const [{ data: vendors, error }, { data: links }] = await Promise.all([
    supabase.from("vendors").select("id, name, items, on_credit, sort_order").eq("is_active", true).order("sort_order").order("name"),
    supabase.from("vendor_stores").select("vendor_id").eq("store_id", storeId),
  ]);
  if (error) throw new Error(`거래처 조회 실패: ${error.message}`);
  const linked = new Set((links ?? []).map((l) => l.vendor_id as string));
  return (vendors ?? [])
    .map((v) => ({
      id: v.id as string,
      name: v.name as string,
      items: v.items as string | null,
      onCredit: Boolean(v.on_credit),
      linked: linked.has(v.id as string),
    }))
    .sort((a, b) => Number(b.linked) - Number(a.linked));
}

/** 거래처별로 전에 받은 품목 (DB 함수 delivery_items — 지점 관리자도 자기 지점만) */
export async function deliveryItems(storeId: string): Promise<Record<string, DeliveryItem[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delivery_items", { p_store_id: storeId });
  if (error) throw new Error(`품목 조회 실패: ${error.message}`);
  const out: Record<string, DeliveryItem[]> = {};
  for (const r of (data ?? []) as {
    vendor_id: string;
    item_name: string;
    unit: string | null;
    last_price: number | string;
    last_qty: number | string;
    last_date: string;
    times: number;
    in_last: boolean;
  }[]) {
    (out[r.vendor_id] ??= []).push({
      itemName: r.item_name,
      unit: r.unit,
      lastPrice: Number(r.last_price),
      lastQty: Number(r.last_qty),
      lastDate: r.last_date,
      times: r.times,
      inLast: r.in_last,
    });
  }
  return out;
}

export interface RecentDelivery {
  id: string;
  date: string;
  vendorName: string;
  amount: number;
  itemCount: number;
  firstItem: string | null;
  onCredit: boolean;
  createdByName: string | null;
  createdAt: string;
  canCancel: boolean;
}

/** 최근 3일 입고 (DB 함수 recent_deliveries) */
export async function recentDeliveries(storeId: string): Promise<RecentDelivery[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recent_deliveries", { p_store_id: storeId });
  if (error) throw new Error(`최근 입고 조회 실패: ${error.message}`);
  return ((data ?? []) as {
    id: string;
    expense_date: string;
    vendor_name: string;
    amount: number | string;
    item_count: number;
    first_item: string | null;
    on_credit: boolean;
    created_by_name: string | null;
    created_at: string;
    can_cancel: boolean;
  }[]).map((r) => ({
    id: r.id,
    date: r.expense_date,
    vendorName: r.vendor_name,
    amount: Number(r.amount),
    itemCount: r.item_count,
    firstItem: r.first_item,
    onCredit: r.on_credit,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    canCancel: r.can_cancel,
  }));
}
