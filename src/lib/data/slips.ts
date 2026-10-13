import "server-only";
import { createClient } from "@/lib/supabase/server";
import { TIME_ZONE } from "@/lib/format";
import type { DateKey } from "@/lib/period";
import type { SlipRow } from "@/lib/slips";

const whenFmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: TIME_ZONE,
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** 그 날 전표 칸: 지점 거래처 + 적힌 금액·적은 사람 (DB 함수 slip_sheet — 직원 포함 그 지점 사람 모두) */
export async function slipSheet(storeId: string, date: DateKey): Promise<SlipRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("slip_sheet", { p_store_id: storeId, p_date: date });
  if (error) throw new Error(`전표 조회 실패: ${error.message}`);
  return ((data ?? []) as {
    vendor_id: string;
    vendor_name: string;
    on_credit: boolean;
    amount: number | string | null;
    has_lines: boolean;
    entered_by: string | null;
    entered_at: string | null;
  }[]).map((r) => ({
    vendorId: r.vendor_id,
    vendorName: r.vendor_name,
    onCredit: r.on_credit,
    amount: r.amount === null ? null : Number(r.amount),
    hasLines: r.has_lines,
    enteredBy: r.entered_by,
    enteredAt: r.entered_at,
    enteredLabel: r.entered_at ? whenFmt.format(new Date(r.entered_at)) : null,
  }));
}

export interface SlipDay {
  date: DateKey;
  total: number;
  vendors: number;
}

/** 최근 2주 날짜별 전표 합계 (DB 함수 slip_days) */
export async function slipDays(storeId: string): Promise<SlipDay[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("slip_days", { p_store_id: storeId });
  if (error) throw new Error(`지난 전표 조회 실패: ${error.message}`);
  return ((data ?? []) as { slip_date: string; total: number | string; vendors: number }[]).map((r) => ({
    date: r.slip_date,
    total: Number(r.total),
    vendors: r.vendors,
  }));
}
