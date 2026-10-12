import type { ReactNode } from "react";
import { formatKRW, formatPercent } from "@/lib/format";
import type { DateKey } from "@/lib/period";
import type { StorePnl } from "@/lib/pnl";
import { cn } from "@/lib/utils";
import { StockReserveControl } from "./stock-reserve-control";

/**
 * 원가율 (매출 대비 원재료비) — 대표 요청 2026-10-13
 * 거래명세표(외상 포함)를 입력할 때마다 바로 바뀐다. 월말 재고가 없으면 냉장고 재고 비율(대표 설정)만큼 빼고 추정.
 * 대표·본사 관리자 화면에서만 쓴다 (지출은 RLS 로 지점 관리자에게 보이지 않음).
 */

/** 매출 입력 상태 한 줄 (모두 입력됐으면 null) */
export function salesNote(p: StorePnl, today: DateKey): string | null {
  const missing = p.sales.missing;
  if (p.sales.entered === 0) return "매출 미입력";
  if (!missing.length) return null;
  if (missing.length === 1 && missing[0].date === today) return "오늘 매출은 마감 후 입력돼요";
  return `${missing.length}일 미입력 — 입력된 날 매출로만 계산`;
}

function ReserveSetting({ pnl, storeName, canEdit }: { pnl: StorePnl; storeName: string; canEdit: boolean }) {
  if (pnl.cogsBasis === "actual") return <span className="text-xs text-muted-foreground">월말 재고 실사 반영</span>;
  if (canEdit) return <StockReserveControl storeId={pnl.storeId} storeName={storeName} value={pnl.stockReservePct} />;
  return <span className="text-xs text-muted-foreground">냉장고 재고 {pnl.stockReservePct}% 반영 (대표 설정)</span>;
}

function Line({ label, value, sub, strong, warn }: { label: string; value: string; sub?: ReactNode; strong?: boolean; warn?: boolean }) {
  return (
    <div className={cn("flex flex-wrap items-baseline justify-between gap-x-4", strong && "border-t pt-1.5 font-semibold")}>
      <dt className={cn(!strong && "text-muted-foreground")}>{label}</dt>
      <dd className="text-right tabular-nums">
        {value}
        {sub && <span className={cn("block text-[11px] font-normal", warn ? "text-amber-700" : "text-muted-foreground")}>{sub}</span>}
      </dd>
    </div>
  );
}

/** 큰 카드: 원가율 + 계산 과정 */
export function FoodCostPanel({
  pnl,
  storeName,
  today,
  title,
  canEdit,
}: {
  pnl: StorePnl;
  storeName: string;
  today: DateKey;
  title: string;
  canEdit: boolean;
}) {
  const p = pnl;
  const r = p.cogsRate;
  const note = salesNote(p, today);
  return (
    <section aria-label={title} className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{title} · 매출 대비 원재료비</p>
          <p className={cn("mt-1 text-4xl font-bold tracking-tight tabular-nums", r.status !== "ok" && "text-muted-foreground")}>
            {formatPercent(r)}
          </p>
          <p className="text-sm text-muted-foreground">
            {r.status === "ok"
              ? `매출 100원 중 원재료비 약 ${Math.round(r.value)}원${p.cogsBasis === "estimated" ? " (추정)" : ""}`
              : r.status === "missing"
                ? "매출이 입력되면 계산돼요"
                : "매출이 0원이라 계산할 수 없어요"}
          </p>
        </div>
        <ReserveSetting pnl={p} storeName={storeName} canEdit={canEdit} />
      </div>

      <dl className="mt-4 space-y-1.5 text-sm">
        {p.cogsBasis === "actual" ? (
          <>
            <Line label="전월 말 재고" value={formatKRW(p.beginInventory)} />
            <Line label="+ 식재료 매입" value={formatKRW(p.purchases)} />
            <Line label="− 이달 말 재고 (직접 센 금액)" value={formatKRW(p.endInventory)} />
          </>
        ) : (
          <>
            <Line
              label="식재료 매입 (외상 포함)"
              value={formatKRW(p.purchases)}
              sub={p.creditPurchases ? `그중 외상 ${formatKRW(p.creditPurchases)}` : undefined}
            />
            <Line
              label={`− 냉장고 재고 ${p.stockReservePct}%`}
              value={p.stockReserveAmount ? `−${formatKRW(p.stockReserveAmount)}` : "0원"}
            />
          </>
        )}
        <Line strong label={p.cogsBasis === "actual" ? "= 매출원가 (실제)" : "= 쓴 원재료 (추정)"} value={formatKRW(p.cogs)} />
        <Line label="÷ 실매출" value={formatKRW(p.sales.netSales)} sub={note} warn={!!note && p.sales.missing.length > 1} />
      </dl>
    </section>
  );
}

/** 한 줄 요약 (지출 입력 화면용) */
export function FoodCostLine({
  pnl,
  storeName,
  title,
  canEdit,
}: {
  pnl: StorePnl;
  storeName: string;
  title: string;
  canEdit: boolean;
}) {
  const p = pnl;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card px-4 py-3 text-sm">
      <span className="text-muted-foreground">{title}</span>
      <b className={cn("text-2xl tabular-nums", p.cogsRate.status !== "ok" && "text-muted-foreground")}>{formatPercent(p.cogsRate)}</b>
      <span className="min-w-0 flex-1 text-xs text-muted-foreground">
        {p.cogsBasis === "actual"
          ? `재고 반영 매출원가 ${formatKRW(p.cogs)}`
          : `식재료 매입 ${formatKRW(p.purchases)} − 냉장고 재고 ${p.stockReservePct}% = ${formatKRW(p.cogs)}`}{" "}
        ÷ 실매출 {formatKRW(p.sales.netSales)}
      </span>
      <ReserveSetting pnl={p} storeName={storeName} canEdit={canEdit} />
    </div>
  );
}
