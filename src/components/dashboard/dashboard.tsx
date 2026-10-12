import Link from "next/link";
import { AlertTriangle, OctagonAlert } from "lucide-react";
import { canViewStorePnl, type SessionUser } from "@/lib/auth/roles";
import { listAccessibleStores } from "@/lib/data/stores";
import { listSales } from "@/lib/data/sales";
import { listExpenses, listInventory } from "@/lib/data/expenses";
import {
  addDays,
  eachDay,
  parsePreset,
  rangeLabel,
  rangeLength,
  resolvePeriod,
  sameDaysLastMonth,
  shortDateKo,
  startOfMonth,
  type DateRange,
} from "@/lib/period";
import { compare, formatChange, storeAlerts, summarize, type Change } from "@/lib/sales/summary";
import { computeStorePnl, monthRange, prevMonth, type StorePnl } from "@/lib/pnl";
import {
  formatDateTimeKo,
  formatKRW,
  formatNumber,
  formatPercent,
  formatRatio,
  MISSING_LABEL,
  safeDivide,
  seoulDateKey,
} from "@/lib/format";
import { EmptyState } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { DashboardFilters } from "./filters";
import { StoreBarChart, TrendLineChart } from "./charts";
import { seriesColor } from "./series-color";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function changeClass(c: Change) {
  if (c.status !== "ok") return "text-muted-foreground";
  return c.value > 0 ? "text-emerald-700" : c.value < 0 ? "text-red-700" : "";
}

/**
 * 통합 대시보드 — 지점별로 따로 관리 (대표 결정 2026-10-13: 3개 지점 합계는 표시하지 않음).
 * 각 지점 카드: 오늘 매출 · 어제/지난주 대비 · 이번 달 누적 · 지난달 대비 · (권한 시) 이번 달 손익.
 */
export async function Dashboard({ searchParams, user }: { searchParams: SP; user: SessionUser }) {
  const today = seoulDateKey();
  const allStores = await listAccessibleStores();
  // 색은 전체 지점 순서로 고정 (필터해도 같은 지점은 같은 색)
  const slotOf = new Map(allStores.map((s, i) => [s.id, i + 1]));
  const activeStores = allStores.filter((s) => s.isActive);

  if (activeStores.length === 0) {
    return <EmptyState title="볼 수 있는 지점이 없습니다">대표에게 소속 지점 지정을 요청하세요.</EmptyState>;
  }

  const storeParam = first(searchParams.store);
  const selected = activeStores.filter((s) => !storeParam || storeParam === "all" || s.id === storeParam);
  const stores = selected.length ? selected : activeStores;
  const storeIds = stores.map((s) => s.id);

  const preset = parsePreset(first(searchParams.period));
  const period = resolvePeriod(preset, today, { from: first(searchParams.from), to: first(searchParams.to) });

  const mtd: DateRange = { start: startOfMonth(today), end: today };
  const lastMtd = sameDaysLastMonth(mtd);
  const yesterday = addDays(today, -1);
  const last7: DateRange = { start: addDays(yesterday, -6), end: yesterday };
  const prev7: DateRange = { start: addDays(last7.start, -7), end: addDays(last7.start, -1) };

  const fetchStart = [period.start, lastMtd.start, prev7.start, addDays(today, -7)].sort()[0];
  const sales = await listSales({ start: fetchStart, end: today }, storeIds);

  // 이번 달 손익 (대표·본사 관리자, 권한 있는 지점만)
  const month = today.slice(0, 7);
  const pnlIds = storeIds.filter((id) => canViewStorePnl(user, id));
  const pnlByStore = new Map<string, StorePnl>();
  if (pnlIds.length) {
    const [exps, inv] = await Promise.all([
      listExpenses({ start: monthRange(prevMonth(month)).start, end: today }, pnlIds),
      listInventory([addDays(mtd.start, -1), monthRange(month).end], pnlIds),
    ]);
    for (const id of pnlIds) {
      pnlByStore.set(id, computeStorePnl({ storeId: id, month, today, sales, expenses: exps, inventory: inv }));
    }
  }

  const day = (d: string): DateRange => ({ start: d, end: d });
  const cards = stores.map((s) => {
    const one = (r: DateRange) => summarize(sales, [s.id], r);
    const t = one(day(today));
    const m = one(mtd);
    return {
      store: s,
      slot: slotOf.get(s.id) ?? 0,
      today: t,
      vsYesterday: compare(t, one(day(yesterday))),
      vsLastWeek: compare(t, one(day(addDays(today, -7)))),
      mtd: m,
      vsLastMtd: compare(m, one(lastMtd)),
      pnl: pnlByStore.get(s.id) ?? null,
      alerts: storeAlerts({
        todayEntered: t.entered > 0,
        missingLast7: one(last7).missing.length,
        weekChange: compare(one(last7), one(prev7)),
      }),
      period: one(period),
    };
  });

  const days = rangeLength(period);
  const latest = sales.reduce<(typeof sales)[number] | null>((a, b) => (!a || b.updatedAt > a.updatedAt ? b : a), null);
  const trend = eachDay(period).map((d) => {
    const point: { date: string; label: string } & Record<string, number | null | string> = {
      date: d,
      label: `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`,
    };
    for (const s of stores) {
      const r = sales.find((x) => x.storeId === s.id && x.date === d);
      point[s.id] = r ? r.netSales : null;
    }
    return point;
  });

  return (
    <>
      <DashboardFilters
        preset={preset}
        from={period.start}
        to={period.end}
        today={today}
        storeId={storeParam && storeParam !== "all" ? storeParam : "all"}
        stores={activeStores.map((s) => ({ id: s.id, name: s.name }))}
      />

      {/* 지점별 카드: 오늘 · 이번 달 */}
      <section aria-labelledby="today-h" className="mb-8">
        <h2 id="today-h" className="mb-3 text-sm font-semibold text-muted-foreground">
          오늘 {shortDateKo(today)} · 이번 달 {rangeLabel(mtd)}
        </h2>
        <div className={cn("grid gap-4", cards.length > 1 && "lg:grid-cols-2 2xl:grid-cols-3")}>
          {cards.map((c) => (
            <article key={c.store.id} className="flex flex-col rounded-xl border bg-card p-4 sm:p-5" aria-label={c.store.name}>
              <header className="mb-3 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-base font-bold">
                  <span className="size-3 rounded-full" style={{ background: seriesColor(c.slot) }} aria-hidden />
                  {c.store.name}
                </h3>
                <Link href={`/sales?store=${c.store.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  매출 입력
                </Link>
              </header>

              <div className="mb-4">
                <p className="text-sm text-muted-foreground">오늘 매출</p>
                <p className={cn("text-3xl font-bold tracking-tight tabular-nums", c.today.netSales === null && "text-muted-foreground")}>
                  {c.today.netSales === null ? MISSING_LABEL : formatKRW(c.today.netSales)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {c.today.netSales === null
                    ? "아직 입력되지 않았습니다"
                    : c.today.closedDays
                      ? "휴무"
                      : `${formatNumber(c.today.orderCount)}건 · 건단가 ${formatRatio(c.today.avgTicket, { suffix: "원", digits: 0 })}`}
                </p>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">어제 대비</dt>
                  <dd className={cn("font-semibold", changeClass(c.vsYesterday))}>{formatChange(c.vsYesterday)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">지난주 같은 요일 대비</dt>
                  <dd className={cn("font-semibold", changeClass(c.vsLastWeek))}>{formatChange(c.vsLastWeek)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">이번 달 누적</dt>
                  <dd className={cn("font-semibold tabular-nums", c.mtd.netSales === null && "text-muted-foreground")}>
                    {formatKRW(c.mtd.netSales)}
                  </dd>
                  {!c.mtd.complete && c.mtd.entered > 0 && (
                    <dd className="text-[11px] text-amber-700">{c.mtd.missing.length}일 미입력 (입력된 날만 합계)</dd>
                  )}
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">지난달 같은 기간 대비</dt>
                  <dd className={cn("font-semibold", changeClass(c.vsLastMtd))}>{formatChange(c.vsLastMtd)}</dd>
                </div>
              </dl>

              {c.pnl && (
                <div className="mt-4 border-t pt-3">
                  <p className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>이번 달 손익 {c.pnl.status === "confirmed" ? "" : "(추정)"}</span>
                    <Link href={`/pnl?store=${c.store.id}`} className="underline underline-offset-2">
                      자세히
                    </Link>
                  </p>
                  <dl className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">원가율</dt>
                      <dd className="font-semibold">{formatPercent(c.pnl.cogsRate)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">인건비율</dt>
                      <dd className="font-semibold">{formatPercent(c.pnl.laborRate)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">영업이익</dt>
                      <dd
                        className={cn(
                          "font-semibold tabular-nums",
                          c.pnl.operatingProfit !== null && c.pnl.operatingProfit < 0 && "text-red-700",
                        )}
                      >
                        {formatKRW(c.pnl.operatingProfit)}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}

              {c.alerts.length > 0 && (
                <ul className="mt-4 space-y-1 border-t pt-3 text-sm">
                  {c.alerts.map((a) => (
                    <li key={a.message} className="flex items-start gap-2">
                      {a.level === "critical" ? (
                        <OctagonAlert className="mt-0.5 size-4 shrink-0 text-red-700" aria-label="심각" />
                      ) : (
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-label="주의" />
                      )}
                      {a.message}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </section>

      {/* 선택 기간: 지점별 표 (합계 없음) */}
      <section aria-labelledby="period-h" className="mb-8">
        <h2 id="period-h" className="mb-3 text-sm font-semibold text-muted-foreground">
          {preset === "today" ? "오늘" : rangeLabel(period)} 지점별 ({days}일)
        </h2>
        <div className={cn("grid gap-4", cards.length > 1 && "xl:grid-cols-5")}>
          <div className={cn("overflow-x-auto rounded-xl border bg-card", cards.length > 1 && "xl:col-span-3")}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>지점</TableHead>
                  <TableHead className="text-right">실매출</TableHead>
                  <TableHead className="text-right">건수</TableHead>
                  <TableHead className="text-right">건단가</TableHead>
                  <TableHead className="text-right whitespace-nowrap">영업일 평균</TableHead>
                  <TableHead className="text-right whitespace-nowrap">좌석당 일매출</TableHead>
                  <TableHead className="text-right">입력</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cards.map((c) => {
                  const p = c.period;
                  const seatDaily =
                    c.store.seatCount === null
                      ? "좌석 미확인"
                      : !p.complete || p.netSales === null
                        ? "비교 불가"
                        : formatRatio(safeDivide(p.netSales, c.store.seatCount * days), { suffix: "원", digits: 0 });
                  return (
                    <TableRow key={c.store.id}>
                      <TableCell className="font-medium whitespace-nowrap">
                        <span className="mr-2 inline-block size-2.5 rounded-full" style={{ background: seriesColor(c.slot) }} aria-hidden />
                        {c.store.name}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatKRW(p.netSales)}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.orderCount === null ? MISSING_LABEL : formatNumber(p.orderCount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatRatio(p.avgTicket, { suffix: "원", digits: 0 })}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatRatio(p.dailyAverage, { suffix: "원", digits: 0 })}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{seatDaily}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", !p.complete && "text-amber-700")}>
                        {p.entered}/{p.expected}일
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {cards.length > 1 && (
            <div className="rounded-xl border bg-card p-4 xl:col-span-2">
              {cards.some((c) => c.period.netSales !== null) ? (
                <>
                  <p className="mb-2 text-xs text-muted-foreground">지점 나란히 보기 (실매출)</p>
                  <StoreBarChart
                    data={cards
                      .filter((c) => c.period.netSales !== null)
                      .map((c) => ({ name: c.store.name.replace("향미옥 ", ""), slot: c.slot, value: c.period.netSales! }))}
                  />
                  {cards.some((c) => !c.period.complete) && (
                    <p className="mt-2 text-xs text-muted-foreground">미입력이 있는 지점은 입력된 날만 반영됩니다. 표의 &apos;입력&apos; 열을 확인하세요.</p>
                  )}
                </>
              ) : (
                <EmptyState title="이 기간에 입력된 매출이 없습니다" />
              )}
            </div>
          )}
        </div>
      </section>

      {days > 1 && (
        <section aria-labelledby="trend-h" className="mb-8">
          <h2 id="trend-h" className="mb-3 text-sm font-semibold text-muted-foreground">
            일별 매출 추이
          </h2>
          <div className="rounded-xl border bg-card p-4">
            <TrendLineChart data={trend} stores={stores.map((s) => ({ id: s.id, name: s.name, slot: slotOf.get(s.id) ?? 0 }))} />
            <p className="mt-2 text-xs text-muted-foreground">선이 끊긴 날은 미입력입니다 (0원으로 그리지 않음).</p>
          </div>
        </section>
      )}

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        데이터 출처: 지점 관리자가 POS 마감 영수증을 보고 입력한 실매출·건수 (CSV 업로드 포함)
        {pnlByStore.size > 0 && " · 손익은 대표가 입력한 지출 기준"} ·{" "}
        {latest ? `최종 매출 입력 ${formatDateTimeKo(latest.updatedAt)} (${latest.updatedByName ?? "알 수 없음"})` : "아직 입력된 매출 없음"} ·{" "}
        <a
          className="underline underline-offset-2"
          href={`/sales/export?from=${period.start}&to=${period.end}${storeParam ? `&store=${storeParam}` : ""}`}
        >
          이 기간 CSV 내려받기
        </a>
      </footer>
    </>
  );
}
