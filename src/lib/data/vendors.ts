import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface VendorRow {
  id: string;
  name: string;
  defaultCategoryId: string | null;
  items: string | null;
  contactName: string | null;
  phone: string | null;
  memo: string | null;
  sortOrder: number;
  isActive: boolean;
  /** 외상(나중에 결제) 거래처 → 지출 입력 시 미수로 잡기 기본값 */
  onCredit: boolean;
  /** 거래 지점 (RLS: 본사 관리자는 소속 지점 연결만 보인다) */
  storeIds: string[];
  updatedAt: string;
}

/** 거래처 목록 (RLS: 대표·본사 관리자만 조회 가능, 그 외에는 빈 목록) */
export async function listVendors(): Promise<VendorRow[]> {
  const supabase = await createClient();
  const [{ data: vendors, error }, { data: links, error: lErr }] = await Promise.all([
    supabase
      .from("vendors")
      .select("id, name, default_category_id, items, contact_name, phone, memo, sort_order, is_active, on_credit, updated_at")
      .order("sort_order")
      .order("name"),
    supabase.from("vendor_stores").select("vendor_id, store_id"),
  ]);
  if (error || lErr) throw new Error(`거래처 조회 실패: ${(error ?? lErr)!.message}`);

  const byVendor = new Map<string, string[]>();
  for (const l of links ?? []) byVendor.set(l.vendor_id, [...(byVendor.get(l.vendor_id) ?? []), l.store_id]);

  return (vendors ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    defaultCategoryId: v.default_category_id,
    items: v.items,
    contactName: v.contact_name,
    phone: v.phone,
    memo: v.memo,
    sortOrder: v.sort_order,
    isActive: v.is_active,
    onCredit: v.on_credit,
    storeIds: byVendor.get(v.id) ?? [],
    updatedAt: v.updated_at,
  }));
}
