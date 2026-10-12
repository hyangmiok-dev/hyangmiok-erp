import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth/dal";
import { canViewStorePnl } from "@/lib/auth/roles";
import { listAccessibleStores } from "@/lib/data/stores";
import { listExpenses } from "@/lib/data/expenses";
import { listSales } from "@/lib/data/sales";
import { listVendors } from "@/lib/data/vendors";
import { buildPurchaseMatrix } from "@/lib/purchases";
import { formatKRW, formatPercent, seoulDateKey } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { EmptyState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "거래처별 매입" };

export default function PurchasesPage({ searchParams }: PageProps<"/purchases">) {
  return (
    <Suspense fallback={<LoadingState rows={10} />}>
      <Purchases searchParams={searchParams} />
    </Suspense>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const won = (n: number) => (n ? n.toLocaleString("ko-KR") : "");

async function Purchases({ searchParams }: { searchParams: PageProps<"/purchases">["searchParams"] }) {
  const user = await requireRole(["owner", "hq_manager"]);
  const sp = await searchParams;
  const today = seoulDateKey();
  const thisYear = Number(today.slice(0, 4));
  const yearParam = Number(first(sp.year));
  const year = Number.isInteger(yearParam) && yearParam >= 2020 && yearParam <= thisYear ? yearParam : thisYear;

  const stores = (await listAccessibleStores()).filter((s) => s.isActive && canViewStorePnl(user, s.id));
  if (!stores.length) return <EmptyState title="볼 수 있는 지점이 없습니다" />;
  const store = stores.find((s) => s.id === first(sp.store)) ?? stores[0];

  const range = { start: `${year}-01-01`, end: year === thisYear ? today : `${year}-12-31` };
  const [vendors, expenses, sales] = await Promise.all([
    listVendors(),
    listExpenses(range, [store.id]),
    listSales(range, [store.id]),
  ]);

  const m = buildPurchaseMatrix({
    year,
    storeId: store.id,
    today,
    sales,
    vendors: vendors.map((v) => ({ id: v.id, name: v.name, sortOrder: v.sortOrder })),
    storeVendorIds: vendors.filter((v) => v.isActive && v.storeIds.includes(store.id)).map((v) => v.id),
    expenses: expenses
      .filter((e) => e.section === "cogs")
      .map((e) => ({ date: e.date, amount: e.amount, vendorId: e.vendorId, vendor: e.vendor })),
  });

  const months = Array.from({ length: 12 }, (_, i) => i);
  const qs = (p: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ year, store: store.id, ...p })) if (v !== undefined) u.set(k, String(v));
    return `/purchases?${u.toString()}`;
  };
  const cellPct = (amount: number, mi: number) => {
    const s = m.sales[mi].summary?.netSales;
    return amount && s ? `${((amount / s) * 100).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%` : "";
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="거래처별 매입"
        description="식재료비 지출을 거래처·월별로 모아 본 표예요 (엑셀 '원재료' 표와 같은 모양). 작은 %는 그 달 실매출 대비 비율이에요."
        actions={
          user.role === "owner" ? (
            <>
              <Link href="/admin/vendors" className={buttonVariants({ variant: "outline", size: "sm" })}>
                거래처 관리
              </Link>
              <Link href={`/expenses?store=${store.id}`} className={buttonVariants({ size: "sm" })}>
                지출 입력
              </Link>
            </>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Link href={qs({ year: year - 1 })} className={buttonVariants({ variant: "ghost", size: "icon-lg" })} aria-label="이전 해">
            <ChevronLeft className="size-5" />
          </Link>
          <span className="min-w-16 text-center font-semibold">{year}년</span>
          <Link
            href={year < thisYear ? qs({ year: year + 1 }) : "#"}
            aria-disabled={year >= thisYear}
            className={buttonVariants({ variant: "ghost", size: "icon-lg", className: cn(year >= thisYear && "pointer-events-none opacity-30") })}
            aria-label="다음 해"
          >
            <ChevronRight className="size-5" />
          </Link>
        </div>
        {stores.length > 1 && (
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="지점">
            {stores.map((s) => (
              <Link
                key={s.id}
                href={qs({ store: s.id })}
                className={cn(
                  "flex h-10 items-center rounded-full border px-4 text-sm",
                  s.id === store.id ? "border-foreground bg-foreground text-background" : "bg-background",
                )}
              >
                {s.name.replace("향미옥 ", "")}
              </Link>
            ))}
          </div>
        )}
      </div>

      {m.rows.length === 0 ? (
        <EmptyState title={`${store.name}의 거래처·식재료 매입이 아직 없습니다`}>
          {user.role === "owner" ? "거래처 관리에서 거래 지점을 체크하거나, 지출 입력에서 식재료비를 입력하세요." : ""}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b bg-muted/60 text-xs text-muted-foreground">
                <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium">거래처</th>
                {months.map((i) => (
                  <th key={i} className={cn("px-2 py-2 text-right font-medium", !m.sales[i].started && "opacity-40")}>
                    {i + 1}월
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">합계</th>
                <th className="px-3 py-2 text-right font-medium">비중</th>
              </tr>
            </thead>
            <tbody>
              {m.rows.map((r) => (
                <tr key={r.key} className="border-b last:border-0 hover:bg-muted/30">
                  <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium whitespace-nowrap">
                    {r.name} {!r.listed && r.vendorId === null && r.key !== "__none__" && <Badge variant="outline">목록에 없음</Badge>}
                  </th>
                  {months.map((i) => (
                    <td key={i} className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                      {won(r.months[i])}
                      {r.months[i] > 0 && <span className="block text-[11px] text-muted-foreground">{cellPct(r.months[i], i)}</span>}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap">{won(r.total)}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{r.total ? formatPercent(r.share) : ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 text-sm">
              <tr className="bg-muted/40 font-semibold">
                <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left">식재료 매입 합계</th>
                {months.map((i) => (
                  <td key={i} className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                    {won(m.monthTotals[i])}
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{won(m.total)}</td>
                <td />
              </tr>
              <tr>
                <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium">실매출</th>
                {months.map((i) => {
                  const s = m.sales[i];
                  return (
                    <td key={i} className="px-2 py-2 text-right tabular-nums whitespace-nowrap text-muted-foreground">
                      {!s.started ? "" : s.summary?.netSales === null || !s.summary ? "미입력" : won(s.summary.netSales)}
                      {s.started && s.summary && !s.summary.complete && s.summary.netSales !== null && (
                        <span className="block text-[11px] text-amber-700">{s.summary.missing.length}일 미입력</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-muted-foreground">
                  {(() => {
                    const known = m.sales.filter((s) => s.summary?.netSales != null);
                    return known.length ? formatKRW(known.reduce((n, s) => n + (s.summary!.netSales ?? 0), 0)) : "미입력";
                  })()}
                </td>
                <td />
              </tr>
              <tr className="font-semibold">
                <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left">원가율 (매입 기준)</th>
                {months.map((i) => {
                  const r = m.rates[i];
                  return (
                    <td key={i} className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                      {m.sales[i].started ? formatPercent(r) : ""}
                      {r.status === "ok" && r.incomplete && <span className="block text-[11px] font-normal text-amber-700">매출 일부 미입력</span>}
                    </td>
                  );
                })}
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        원가율(매입 기준) = 그 달 식재료비 매입 ÷ 실매출. 냉장고 재고({store.stockReservePct}%)를 뺀 실시간 원가율은 [홈]·[거래처 미수]·[지출 입력] 화면에,
        월말 재고를 직접 센 원가율은 [손익] 화면에 나와요. 금액은 부가세 포함.
      </p>
    </div>
  );
}
