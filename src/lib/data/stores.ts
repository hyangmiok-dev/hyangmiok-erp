import "server-only";
import { createClient } from "@/lib/supabase/server";
import { businessHoursSchema, type BusinessHours } from "@/lib/validation/stores";

export interface StoreRow {
  id: string;
  code: string;
  name: string;
  address: string | null;
  seatCount: number | null;
  areaPyeong: number | null;
  businessHours: BusinessHours | null;
  notes: string | null;
  isActive: boolean;
  sortOrder: number;
  updatedAt: string;
}

/** 현재 사용자가 접근 가능한 지점 목록 (RLS 가 필터링). */
export async function listAccessibleStores(): Promise<StoreRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stores")
    .select("id, code, name, address, seat_count, area_pyeong, business_hours, notes, is_active, sort_order, updated_at")
    .order("sort_order")
    .order("code");
  if (error) throw new Error(`지점 조회 실패: ${error.message}`);
  return (data ?? []).map((s) => {
    const hours = businessHoursSchema.safeParse(s.business_hours);
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      address: s.address,
      seatCount: s.seat_count,
      areaPyeong: s.area_pyeong === null ? null : Number(s.area_pyeong),
      businessHours: s.business_hours && hours.success ? hours.data : null,
      notes: s.notes,
      isActive: s.is_active,
      sortOrder: s.sort_order,
      updatedAt: s.updated_at,
    };
  });
}
