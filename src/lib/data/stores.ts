import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface StoreRow {
  id: string;
  code: string;
  name: string;
  address: string | null;
  seatCount: number | null;
  areaPyeong: number | null;
  notes: string | null;
  isActive: boolean;
  updatedAt: string;
}

/** 현재 사용자가 접근 가능한 지점 목록 (RLS 가 필터링). */
export async function listAccessibleStores(): Promise<StoreRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stores")
    .select("id, code, name, address, seat_count, area_pyeong, notes, is_active, updated_at")
    .order("sort_order")
    .order("code");
  if (error) throw new Error(`지점 조회 실패: ${error.message}`);
  return (data ?? []).map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    address: s.address,
    seatCount: s.seat_count,
    areaPyeong: s.area_pyeong === null ? null : Number(s.area_pyeong),
    notes: s.notes,
    isActive: s.is_active,
    updatedAt: s.updated_at,
  }));
}
