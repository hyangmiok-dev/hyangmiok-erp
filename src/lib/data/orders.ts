import "server-only";
import { createClient } from "@/lib/supabase/server";
import { seoulDateKey } from "@/lib/format";
import { addDays } from "@/lib/period";
import { orderDay, type OrderItem } from "@/lib/orders";

type ItemRow = {
  id: string;
  category: string;
  name: string;
  unit: string | null;
  default_qty: number | string;
  step: number | string;
  unit_price: number | string | null;
  vendor_id: string | null;
  sort_order: number;
  is_active: boolean;
  vendors: { name: string } | null;
};

function toItem(r: ItemRow): OrderItem {
  return {
    id: r.id,
    category: r.category,
    name: r.name,
    unit: r.unit,
    defaultQty: Number(r.default_qty),
    step: Number(r.step),
    unitPrice: r.unit_price === null ? null : Number(r.unit_price),
    vendorId: r.vendor_id,
    vendorName: r.vendors?.name ?? null,
    sortOrder: r.sort_order,
    isActive: r.is_active,
  };
}

/** 지점 품목표 (RLS: 그 지점 소속 전원) */
export async function listOrderItems(storeId: string, opts: { includeInactive?: boolean } = {}): Promise<OrderItem[]> {
  const supabase = await createClient();
  let q = supabase
    .from("order_items")
    .select("id, category, name, unit, default_qty, step, unit_price, vendor_id, sort_order, is_active, vendors(name)")
    .eq("store_id", storeId)
    .order("sort_order")
    .order("name");
  if (!opts.includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw new Error(`품목 조회 실패: ${error.message}`);
  return ((data ?? []) as unknown as ItemRow[]).map(toItem);
}

export interface CurrentOrder {
  id: string | null;
  orderDate: string;
  status: "open" | "submitted" | "sent";
  submittedAt: string | null;
  submittedByName: string | null;
  sentAt: string | null;
  lines: { itemId: string; qty: number }[];
}

/** 지금 넣는 발주 (밤 9시 기준 날짜) */
export async function getCurrentOrder(storeId: string): Promise<CurrentOrder> {
  const day = orderDay();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select("id, order_date, status, submitted_at, sent_at, submitter:profiles!orders_submitted_by_fkey(full_name), order_lines(item_id, qty)")
    .eq("store_id", storeId)
    .eq("order_date", day)
    .maybeSingle();
  if (error) throw new Error(`발주 조회 실패: ${error.message}`);
  if (!data) return { id: null, orderDate: day, status: "open", submittedAt: null, submittedByName: null, sentAt: null, lines: [] };
  const d = data as unknown as {
    id: string;
    order_date: string;
    status: CurrentOrder["status"];
    submitted_at: string | null;
    sent_at: string | null;
    submitter: { full_name: string } | null;
    order_lines: { item_id: string; qty: number | string }[];
  };
  return {
    id: d.id,
    orderDate: d.order_date,
    status: d.status,
    submittedAt: d.submitted_at,
    submittedByName: d.submitter?.full_name ?? null,
    sentAt: d.sent_at,
    lines: d.order_lines.map((l) => ({ itemId: l.item_id, qty: Number(l.qty) })),
  };
}

export interface ReceiveGroup {
  orderId: string;
  orderDate: string;
  vendorId: string | null;
  vendorName: string;
  lines: {
    lineId: string;
    itemName: string;
    unit: string | null;
    qty: number;
    price: number | null;
  }[];
}

/** 입고 확인할 것: 최근 7일, 보냈거나(또는 지난 날 완료) 아직 확인 안 한 거래처별 묶음 */
export async function listReceivable(storeId: string): Promise<ReceiveGroup[]> {
  const today = seoulDateKey();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, order_date, status, order_lines(id, qty, unit_price, received_at, order_items(name, unit, unit_price, vendor_id, sort_order, vendors(name))), order_receipts(vendor_id)",
    )
    .eq("store_id", storeId)
    .gte("order_date", addDays(today, -7))
    .in("status", ["submitted", "sent"])
    .order("order_date");
  if (error) throw new Error(`입고 확인 목록 조회 실패: ${error.message}`);

  type Row = {
    id: string;
    order_date: string;
    status: string;
    order_lines: {
      id: string;
      qty: number | string;
      unit_price: number | string | null;
      received_at: string | null;
      order_items: {
        name: string;
        unit: string | null;
        unit_price: number | string | null;
        vendor_id: string | null;
        sort_order: number;
        vendors: { name: string } | null;
      };
    }[];
    order_receipts: { vendor_id: string }[];
  };

  const groups: ReceiveGroup[] = [];
  for (const o of (data ?? []) as unknown as Row[]) {
    if (!(o.status === "sent" || o.order_date < today)) continue; // 오늘 발주(아직 안 보냄)는 제외
    const done = new Set(o.order_receipts.map((r) => r.vendor_id));
    const byVendor = new Map<string, ReceiveGroup>();
    const lines = [...o.order_lines].sort((a, b) => a.order_items.sort_order - b.order_items.sort_order);
    for (const l of lines) {
      if (l.received_at) continue;
      const vid = l.order_items.vendor_id;
      if (vid && done.has(vid)) continue;
      const key = vid ?? "__none__";
      const g = byVendor.get(key) ?? {
        orderId: o.id,
        orderDate: o.order_date,
        vendorId: vid,
        vendorName: vid ? (l.order_items.vendors?.name ?? "거래처") : "거래처 미정",
        lines: [],
      };
      const price = l.unit_price ?? l.order_items.unit_price;
      g.lines.push({
        lineId: l.id,
        itemName: l.order_items.name,
        unit: l.order_items.unit,
        qty: Number(l.qty),
        price: price === null ? null : Number(price),
      });
      byVendor.set(key, g);
    }
    groups.push(...byVendor.values());
  }
  return groups;
}

export interface DoneReceipt {
  id: string;
  orderDate: string;
  vendorName: string;
  total: number;
  receiptTotal: number | null;
  memo: string | null;
  completedAt: string;
  completedByName: string | null;
}

/** 최근 3일 입고 완료 기록 */
export async function listDoneReceipts(storeId: string): Promise<DoneReceipt[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("order_receipts")
    .select("id, computed_total, receipt_total, memo, completed_at, vendors(name), orders(order_date), completer:profiles!order_receipts_completed_by_fkey(full_name)")
    .eq("store_id", storeId)
    .gte("completed_at", new Date(Date.now() - 3 * 86_400_000).toISOString())
    .order("completed_at", { ascending: false });
  if (error) throw new Error(`입고 기록 조회 실패: ${error.message}`);
  return ((data ?? []) as unknown as {
    id: string;
    computed_total: number | string;
    receipt_total: number | string | null;
    memo: string | null;
    completed_at: string;
    vendors: { name: string } | null;
    orders: { order_date: string } | null;
    completer: { full_name: string } | null;
  }[]).map((r) => ({
    id: r.id,
    orderDate: r.orders?.order_date ?? "",
    vendorName: r.vendors?.name ?? "거래처",
    total: Number(r.computed_total),
    receiptTotal: r.receipt_total === null ? null : Number(r.receipt_total),
    memo: r.memo,
    completedAt: r.completed_at,
    completedByName: r.completer?.full_name ?? null,
  }));
}

/** 거래 중인 거래처 (거래처 미정 품목 입고 때 고르기용) */
export async function activeVendors(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("vendors").select("id, name").eq("is_active", true).order("sort_order");
  return (data ?? []).map((v) => ({ id: v.id as string, name: v.name as string }));
}
