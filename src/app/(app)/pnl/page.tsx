import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CircleCheck, TriangleAlert } from "lucide-react";
import { requireRole } from "@/lib/auth/dal";
import { canViewStorePnl } from "@/lib/auth/roles";
import { listAccessibleStores } from "@/lib/data/stores";
import { listSales } from "@/lib/data/sales";
import { listCategories, listExpenses, listInventory } from "@/lib/data/expenses";
import { formatKRW, formatPercent, seoulDateKey, type Ratio } from "@/lib/format";
import { addDays } from "@/lib/period";
import {
  computeStorePnl,
  isMonthKey,
  monthRange,
  prevMonth,
  type CategoryLine,
  type Section,
  type StorePnl,
} from "@/lib/pnl";
import { PageHeader } from "@/components/page-header";
import { EmptyState, LoadingState } from "@/components/states";
import { StatTile } from "@/components/dashboard/stat-tile";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { InventoryForm } from "./inventory-form";

export const metadata: Metadata = { title: "손익" };

export default function PnlPage({ searchParams }: PageProps<"/pnl">) {
  return (
    <Suspense fallback={<LoadingState rows={8} />}>
      <Pnl searchParams={searchParams} />
    </Suspense>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

type Col = {
  key: string;
  title: string;
  netSales: number | null;
  salesNote: string | null;
  begin: number | null;
  purchases: number;
  end: number | null;
  cogs: number;
  cogsBasis: "actual" | "estimated";
  labor: number;
  opex: number;
  excluded: number;
  lines: CategoryLine[];
  operatingProfit: number | null;
  cogsRate: Ratio;
  laborRate: Ratio;
  operatingMargin: Ratio;
  status: "confirmed" | "estimated";
};

function storeCol(p: StorePnl, title: string): Col {
  return {
    key: p.storeId,
    title,
    netSales: p.sales.netSales,
    salesNote: p.sales.complete ? null : p.sales.entered === 0 ? "미입력" : `${p.sales.missing.length}일 미입력`,
    begin: p.beginInventory,
    purchases: p.purchases,
    end: p.endInventory,
    cogs: p.cogs,
    cogsBasis: p.cogsBasis,
    labor: p.labor,
    opex: p.opex,
    excluded: p.excluded,
    lines: p.lines,
    operatingProfit: p.operatingProfit,
    cogsRate: p.cogsRate,
    laborRate: p.laborRate,
    operatingMargin: p.operatingMargin,
    status: p.status,
  };
}

function PnlRow({
  cols,
  label,
  value,
  strong,
  indent,
  note,
}: {
  cols: Col[];
  label: ReactNode;
  value: (c: Col) => ReactNode;
  strong?: boolean;
  indent?: boolean;
  note?: (c: Col) => ReactNode;
}) {
  return (
    <tr className={cn("border-b last:border-0", strong && "bg-muted/40 font-semibold")}>
      <th scope="row" className={cn("px-3 py-2 text-left font-normal whitespace-nowrap", strong && "font-semibold", indent && "pl-8 text-muted-foreground")}>
        {label}
      </th>
      {cols.map((c) => (
        <td key={c.key} className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
          {value(c)}
          {note && <span className="block text-[11px] font-normal text-muted-foreground">{note(c)}</span>}
        </td>
      ))}
    </tr>
  );
}

async function Pnl({ searchParams }: { searchParams: PageProps<"/pnl">["searchParams"] }) {
  const user = await requireRole(["owner", "hq_manager"]);
  const sp = await searchParams;
  const today = seoulDateKey();
  const thisMonth = today.slice(0, 7);
  let month = first(sp.month);
  if (!isMonthKey(month) || month > thisMonth) month = thisMonth;

  const stores = (await listAccessibleStores()).filter((s) => s.isActive && canViewStorePnl(user, s.id));
  if (!stores.length) return <EmptyState title="손익을 볼 수 있는 지점이 없습니다" />;
  // 지점별로 따로 관리 (대표 결정 2026-10-13): 합계 없이 한 지점씩 본다
  const storeParam = first(sp.store);
  const selected = stores.find((s) => s.id === storeParam) ?? stores[0];
  const shown = [selected];
  const ids = shown.map((s) => s.id);

  const range = monthRange(month);
  const last = monthRange(prevMonth(month));
  const beginDate = addDays(range.start, -1);
  const [categories, sales, expenses, inventory] = await Promise.all([
    listCategories(),
    listSales(range, ids),
    listExpenses({ start: last.start, end: range.end }, ids),
    listInventory([beginDate, range.end], ids),
  ]);

  const perStore = shown.map((s) =>
    computeStorePnl({ storeId: s.id, month: month!, today, sales, expenses, inventory }),
  );
  const cols: Col[] = perStore.map((p, i) => storeCol(p, shown[i].name.replace("향미옥 ", "")));
  const head = cols[cols.length - 1];
  const catOrder = new Map(categories.map((c, i) => [c.id, i]));
  const linesOf = (section: Section) =>
    [...new Map(cols.flatMap((c) => c.lines).filter((l) => l.section === section).map((l) => [l.categoryId, l])).values()].sort(
      (a, b) => (catOrder.get(a.categoryId) ?? 0) - (catOrder.get(b.categoryId) ?? 0),
    );
  const amountIn = (c: Col, categoryId: string) => c.lines.find((l) => l.categoryId === categoryId)?.amount ?? 0;
  const estIn = (c: Col, categoryId: string) => c.lines.find((l) => l.categoryId === categoryId)?.hasEstimated ?? false;

  const qs = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ month, store: selected?.id, ...p })) if (v) u.set(k, v);
    return `/pnl?${u.toString()}`;
  };
  const monthEnded = range.end < today;
  const isOwner = user.role === "owner";
  const single = cols.length === 1;
  const pctOf = (v: number, c: Col) =>
    c.netSales && c.netSales > 0 ? `${((v / c.netSales) * 100).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%` : "";

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="손익"
        description="실매출 − 매출원가 − 인건비 − 기타 영업비용 = 영업이익. 모든 금액 부가세 포함 기준."
        actions={
          isOwner ? (
            <Link href={`/expenses?month=${month}${selected ? `&store=${selected.id}` : ""}`} className={buttonVariants({ size: "sm" })}>
              지출 입력
            </Link>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Link href={qs({ month: prevMonth(month) })} className={buttonVariants({ variant: "ghost", size: "icon-lg" })} aria-label="이전 달">
            <ChevronLeft className="size-5" />
          </Link>
          <span className="min-w-24 text-center font-semibold">
            {Number(month.slice(0, 4))}년 {Number(month.slice(5))}월
          </span>
          <Link
            href={month < thisMonth ? qs({ month: addDays(range.end, 1).slice(0, 7) }) : "#"}
            aria-disabled={month >= thisMonth}
            className={buttonVariants({ variant: "ghost", size: "icon-lg", className: cn(month >= thisMonth && "pointer-events-none opacity-30") })}
            aria-label="다음 달"
          >
            <ChevronRight className="size-5" />
          </Link>
        </div>
        {stores.length > 1 && (
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="지점">
            {stores.map((s) => (
              <Link
                key={s.id ?? "all"}
                href={qs({ store: s.id })}
                className={cn(
                  "flex h-10 items-center rounded-full border px-4 text-sm",
                  selected.id === s.id ? "border-foreground bg-foreground text-background" : "bg-background",
                )}
              >
                {s.name.replace("향미옥 ", "")}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* 상태 */}
      <div
        className={cn(
          "mb-6 flex gap-3 rounded-xl border p-4 text-sm",
          head.status === "confirmed" ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-amber-300 bg-amber-50 text-amber-950",
        )}
        role="status"
      >
        {head.status === "confirmed" ? (
          <CircleCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
        ) : (
          <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
        )}
        <div>
          <p className="font-semibold">{head.status === "confirmed" ? "확정 손익" : "추정 손익 — 아래 이유로 실제와 다를 수 있습니다"}</p>
          {head.status !== "confirmed" && (
            <ul className="mt-1 list-disc pl-5">
              {perStore[0].reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="실매출" value={formatKRW(head.netSales)} muted={head.netSales === null} sub={head.salesNote ?? "빠짐없이 입력됨"} />
        <StatTile
          label="식재료 원가율"
          value={formatPercent(head.cogsRate)}
          muted={head.cogsRate.status !== "ok"}
          sub={head.cogsBasis === "actual" ? "재고 반영 매출원가 기준" : "추정 (매입액 기준)"}
        />
        <StatTile label="인건비율" value={formatPercent(head.laborRate)} muted={head.laborRate.status !== "ok"} sub={`인건비 ${formatKRW(head.labor)}`} />
        <StatTile
          label={head.status === "confirmed" ? "영업이익" : "추정 영업이익"}
          value={formatKRW(head.operatingProfit)}
          muted={head.operatingProfit === null}
          tone={head.operatingProfit !== null ? (head.operatingProfit >= 0 ? "up" : "down") : undefined}
          sub={`영업이익률 ${formatPercent(head.operatingMargin)}`}
        />
        <StatTile label="노동시간당 매출" value="계산불가" muted sub="4단계(근태 기록) 후 계산됩니다" />
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/60">
              <th className="px-3 py-2 text-left font-medium">항목</th>
              {cols.map((c) => (
                <th key={c.key} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                  {c.title} {c.status === "estimated" && <Badge variant="outline">추정</Badge>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <PnlRow cols={cols} label="실매출" strong value={(c) => formatKRW(c.netSales)} note={(c) => c.salesNote} />
            <PnlRow cols={cols}
              label="(−) 매출원가"
              strong
              value={(c) => formatKRW(c.cogs)}
              note={(c) => [c.cogsBasis === "estimated" ? "매입액 기준(추정)" : "재고 반영", single ? pctOf(c.cogs, c) : ""].filter(Boolean).join(" · ")}
            />
            <PnlRow cols={cols} label="기초재고 (전월 말)" indent value={(c) => (c.begin === null ? "미입력" : formatKRW(c.begin))} />
            <PnlRow cols={cols} label="+ 식재료 매입" indent value={(c) => formatKRW(c.purchases)} />
            <PnlRow cols={cols} label="− 기말재고 (이달 말)" indent value={(c) => (c.end === null ? "미입력" : formatKRW(c.end))} />
            <PnlRow cols={cols} label="(−) 인건비" strong value={(c) => formatKRW(c.labor)} note={(c) => (single ? pctOf(c.labor, c) : "")} />
            {linesOf("labor").map((l) => (
              <PnlRow cols={cols} key={l.categoryId} label={l.name} indent value={(c) => <>{formatKRW(amountIn(c, l.categoryId))}{estIn(c, l.categoryId) && " *"}</>} />
            ))}
            <PnlRow cols={cols} label="(−) 기타 영업비용" strong value={(c) => formatKRW(c.opex)} note={(c) => (single ? pctOf(c.opex, c) : "")} />
            {linesOf("opex").map((l) => (
              <PnlRow cols={cols} key={l.categoryId} label={l.name} indent value={(c) => <>{formatKRW(amountIn(c, l.categoryId))}{estIn(c, l.categoryId) && " *"}</>} />
            ))}
            <PnlRow cols={cols}
              label="= 영업이익"
              strong
              value={(c) => <span className={cn(c.operatingProfit !== null && c.operatingProfit < 0 && "text-red-700")}>{formatKRW(c.operatingProfit)}</span>}
              note={(c) => `이익률 ${formatPercent(c.operatingMargin)}`}
            />
            {linesOf("excluded").length > 0 && (
              <>
                <tr>
                  <th colSpan={cols.length + 1} className="px-3 pt-4 pb-1 text-left text-xs font-medium text-muted-foreground">
                    참고: 영업이익 계산 제외 (세금·금융비용·보증금)
                  </th>
                </tr>
                {linesOf("excluded").map((l) => (
                  <PnlRow cols={cols} key={l.categoryId} label={l.name} indent value={(c) => formatKRW(amountIn(c, l.categoryId))} />
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">* 추정 금액 포함 · 입력되지 않은 비용은 0원으로 보이지만 확정이 아닙니다 (위 &apos;추정 손익&apos; 이유 참고).</p>

      {isOwner && (
        <section className="mt-8 rounded-xl border bg-card p-4 sm:p-6">
          <h2 className="font-semibold">월말 재고 금액</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            월말에 남은 재료를 세어 금액으로 넣으면, 원가율이 &apos;추정&apos;에서 실제 매출원가 기준으로 바뀝니다. (전월 말 + 이달 말 둘 다 필요)
          </p>
          <div className="space-y-4">
            {shown.map((s) => {
              const p = perStore.find((x) => x.storeId === s.id)!;
              return (
                <div key={s.id} className="space-y-2">
                  <p className="text-sm font-medium">{s.name}</p>
                  <InventoryForm storeId={s.id} countDate={beginDate} label={`전월 말 (${beginDate.slice(5).replace("-", "/")})`} current={p.beginInventory} />
                  <InventoryForm
                    storeId={s.id}
                    countDate={range.end}
                    label={`이달 말 (${range.end.slice(5).replace("-", "/")})`}
                    current={p.endInventory}
                    disabled={!monthEnded && range.end !== today}
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
