import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, Upload } from "lucide-react";
import { requireRole } from "@/lib/auth/dal";
import { canManageStore } from "@/lib/auth/roles";
import { listAccessibleStores } from "@/lib/data/stores";
import { listSales } from "@/lib/data/sales";
import { addDays, eachDay, isDateKey, shortDateKo } from "@/lib/period";
import { formatDateTimeKo, formatKRW, seoulDateKey } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { EmptyState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SaleForm } from "./sale-form";

export const metadata: Metadata = { title: "매출 입력" };

export default function SalesPage({ searchParams }: PageProps<"/sales">) {
  return (
    <Suspense fallback={<LoadingState rows={5} />}>
      <Sales searchParams={searchParams} />
    </Suspense>
  );
}

const SOURCE_LABEL = { manual: "직접 입력", csv: "CSV 업로드", pos: "POS 연동" } as const;

async function Sales({ searchParams }: { searchParams: PageProps<"/sales">["searchParams"] }) {
  const user = await requireRole(["owner", "hq_manager", "store_manager"]);
  const sp = await searchParams;
  const stores = (await listAccessibleStores()).filter((s) => s.isActive && canManageStore(user, s.id));
  if (stores.length === 0) {
    return (
      <>
        <PageHeader title="매출 입력" />
        <EmptyState title="매출을 입력할 수 있는 지점이 없습니다">대표에게 소속 지점 지정을 요청하세요.</EmptyState>
      </>
    );
  }

  const today = seoulDateKey();
  const minDate = user.role === "owner" ? null : addDays(today, -7);
  const store = stores.find((s) => s.id === sp.store) ?? stores[0];
  let date = typeof sp.date === "string" && isDateKey(sp.date) ? sp.date : today;
  if (date > today) date = today;
  if (minDate && date < minDate) date = minDate;

  // 최근 14일 + 선택 날짜 + 지난주 같은 요일
  const listStart = addDays(today, -13);
  const fetchStart = [listStart, addDays(date, -7)].sort()[0];
  const sales = await listSales({ start: fetchStart, end: today }, [store.id]);
  const byDate = new Map(sales.map((s) => [s.date, s]));
  const existing = byDate.get(date) ?? null;
  const lastWeek = byDate.get(addDays(date, -7));

  const href = (p: { store?: string; date?: string }) =>
    `/sales?store=${p.store ?? store.id}&date=${p.date ?? date}`;
  const canPrev = !minDate || addDays(date, -1) >= minDate;
  const canNext = date < today;
  const recentDays = eachDay({ start: listStart, end: today }).reverse();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="매출 입력"
        description="POS 마감 영수증을 보고 실매출과 건수를 입력하세요."
        actions={
          <>
            <Link href="/sales/import" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Upload className="size-4" /> CSV 올리기
            </Link>
            <a
              href={`/sales/export?from=${addDays(today, -30)}&to=${today}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Download className="size-4" /> 내려받기
            </a>
          </>
        }
      />

      {/* 지점 선택 */}
      {stores.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="지점 선택">
          {stores.map((s) => (
            <Link
              key={s.id}
              href={href({ store: s.id })}
              role="tab"
              aria-selected={s.id === store.id}
              className={cn(
                "flex h-11 items-center rounded-full border px-4 text-sm",
                s.id === store.id ? "border-foreground bg-foreground text-background" : "bg-background",
              )}
            >
              {s.name}
            </Link>
          ))}
        </div>
      )}

      <section className="rounded-xl border bg-card p-4 sm:p-6">
        {/* 날짜 이동 */}
        <div className="mb-4 flex items-center justify-between gap-2">
          <Link
            href={canPrev ? href({ date: addDays(date, -1) }) : "#"}
            aria-disabled={!canPrev}
            className={buttonVariants({ variant: "ghost", size: "icon-lg", className: cn(!canPrev && "pointer-events-none opacity-30") })}
            aria-label="전날"
          >
            <ChevronLeft className="size-5" />
          </Link>
          <div className="text-center">
            <p className="text-lg font-bold">
              {shortDateKo(date)} {date === today && <span className="text-sm font-normal text-muted-foreground">오늘</span>}
            </p>
            <p className="text-sm text-muted-foreground">{store.name}</p>
          </div>
          <Link
            href={canNext ? href({ date: addDays(date, 1) }) : "#"}
            aria-disabled={!canNext}
            className={buttonVariants({ variant: "ghost", size: "icon-lg", className: cn(!canNext && "pointer-events-none opacity-30") })}
            aria-label="다음날"
          >
            <ChevronRight className="size-5" />
          </Link>
        </div>

        <div className="mb-5 rounded-lg bg-muted/60 px-3 py-2 text-sm">
          {existing ? (
            <>
              <Badge variant="secondary">입력됨</Badge>{" "}
              {existing.updatedByName ?? "알 수 없음"} · {formatDateTimeKo(existing.updatedAt)} ·{" "}
              {SOURCE_LABEL[existing.source]}
              <span className="block text-xs text-muted-foreground">고칠 내용이 있으면 바꾼 뒤 [수정 저장]을 누르세요. 수정 이력이 남습니다.</span>
            </>
          ) : (
            <>
              <Badge variant="outline">미입력</Badge> 아직 입력되지 않았습니다.
            </>
          )}
        </div>

        <SaleForm
          key={`${store.id}|${date}|${existing?.updatedAt ?? "new"}`}
          storeId={store.id}
          businessDate={date}
          existing={
            existing
              ? {
                  netSales: existing.netSales,
                  orderCount: existing.orderCount,
                  isClosed: existing.isClosed,
                  memo: existing.memo,
                  updatedAt: existing.updatedAt,
                }
              : null
          }
          sameWeekdayLastWeek={lastWeek && !lastWeek.isClosed ? lastWeek.netSales : null}
        />
        {minDate && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            7일이 지난 매출({shortDateKo(addDays(minDate, -1))} 이전)은 대표만 고칠 수 있습니다.
          </p>
        )}
      </section>

      {/* 최근 14일 */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{store.name} 최근 14일</h2>
        <ul className="divide-y rounded-xl border bg-card">
          {recentDays.map((d) => {
            const s = byDate.get(d);
            const editable = !minDate || d >= minDate;
            const inner = (
              <>
                <span className={cn("w-24 shrink-0", d === date && "font-bold")}>{shortDateKo(d)}</span>
                <span className="flex-1 text-right tabular-nums">
                  {s ? (s.isClosed ? <Badge variant="secondary">휴무</Badge> : formatKRW(s.netSales)) : <span className="text-amber-700">미입력</span>}
                </span>
                <span className="w-16 text-right text-muted-foreground tabular-nums">{s && !s.isClosed ? `${s.orderCount}건` : ""}</span>
              </>
            );
            return (
              <li key={d}>
                {editable ? (
                  <Link href={href({ date: d })} className={cn("flex min-h-12 items-center gap-3 px-4 text-sm hover:bg-muted/50", d === date && "bg-muted/60")}>
                    {inner}
                  </Link>
                ) : (
                  <div className="flex min-h-12 items-center gap-3 px-4 text-sm text-muted-foreground">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
