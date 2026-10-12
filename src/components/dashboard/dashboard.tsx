import Link from "next/link";
import { AlertTriangle, OctagonAlert } from "lucide-react";
import { listAccessibleStores } from "@/lib/data/stores";
import { listSales } from "@/lib/data/sales";
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
import { formatDateTimeKo, formatKRW, formatNumber, formatRatio, MISSING_LABEL, safeDivide, seoulDateKey } from "@/lib/format";
import { EmptyState } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardFilters } from "./filters";
import { StatTile } from "./stat-tile";
import { StoreBarChart, TrendLineChart } from "./charts";
import { seriesColor } from "./series-color";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function changeTone(c: Change): "up" | "down" | undefined {
  return c.status === "ok" ? (c.value > 0 ? "up" : c.value < 0 ? "down" : undefined) : undefined;
}

export async function Dashboard({ searchParams }: { searchParams: SP }) {
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

  const sum = (r: DateRange, ids = storeIds) => summarize(sales, ids, r);
  const day = (d: string): DateRange => ({ start: d, end: d });

  const sToday = sum(day(today));
  const vsYesterday = compare(sToday, sum(day(yesterday)));
  const vsLastWeek = compare(sToday, sum(day(addDays(today, -7))));
  const sMtd = sum(mtd);
  const vsLastMtd = compare(sMtd, sum(lastMtd));
  const sPeriod = sum(period);

  const latest = sales.reduce<(typeof sales)[number] | null>((a, b) => (!a || b.updatedAt > a.updatedAt ? b : a), null);

  // 지점별
  const perStore = stores.map((s) => {
    const p = sum(period, [s.id]);
    const t = sum(day(today), [s.id]);
    const days = rangeLength(period);
    return {
      store: s,
      slot: slotOf.get(s.id) ?? 0,
      period: p,
      seatDaily:
        s.seatCount && p.netSales !== null && p.complete
          ? safeDivide(p.netSales, s.seatCount * days)
          : ({ status: "missing" } as const),
      alerts: storeAlerts({
        todayEntered: t.entered > 0,
        missingLast7: sum(last7, [s.id]).missing.length,
        weekChange: compare(sum(last7, [s.id]), sum(prev7, [s.id])),
      }),
    };
  });

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

  const enteredLabel = (e: number, total: number) => `${total}칸 중 ${e}칸 입력${e < total ? ` · ${total - e}칸 미입력` : ""}`;
  const alertCount = perStore.reduce((n, p) => n + p.alerts.length, 0);

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

      {/* 오늘 */}
      <section aria-labelledby="today-h" className="mb-8">
        <h2 id="today-h" className="mb-3 text-sm font-semibold text-muted-foreground">
          오늘 {shortDateKo(today)} · {stores.length === activeStores.length ? "전체 지점" : stores.map((s) => s.name).join(", ")}
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatTile
            label="오늘 매출"
            value={sToday.netSales === null ? MISSING_LABEL : formatKRW(sToday.netSales)}
            muted={sToday.netSales === null}
            sub={
              sToday.complete
                ? `${stores.length}개 지점 모두 입력`
                : `${stores.length}개 지점 중 ${sToday.entered}곳 입력${sToday.entered ? " (부분 합계)" : ""}`
            }
          />
          <StatTile label="어제 대비" value={formatChange(vsYesterday)} muted={vsYesterday.status !== "ok"} tone={changeTone(vsYesterday)} />
          <StatTile
            label="지난주 같은 요일 대비"
            value={formatChange(vsLastWeek)}
            muted={vsLastWeek.status !== "ok"}
            tone={changeTone(vsLastWeek)}
            sub={shortDateKo(addDays(today, -7))}
          />
          <StatTile
            label="이번 달 누적"
            value={sMtd.netSales === null ? MISSING_LABEL : formatKRW(sMtd.netSales)}
            muted={sMtd.netSales === null}
            sub={sMtd.complete ? "빠짐없이 입력됨" : sMtd.entered === 0 ? "이번 달 입력 없음" : `미입력 ${sMtd.missing.length}칸 (입력된 날만 합계)`}
          />
          <StatTile
            label="지난달 같은 기간 대비"
            value={formatChange(vsLastMtd)}
            muted={vsLastMtd.status !== "ok"}
            tone={changeTone(vsLastMtd)}
            sub={rangeLabel(lastMtd)}
          />
        </div>
      </section>

      {/* 경고 */}
      {alertCount > 0 && (
        <section aria-labelledby="alert-h" className="mb-8">
          <h2 id="alert-h" className="mb-3 text-sm font-semibold text-muted-foreground">
            확인이 필요한 지점
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {perStore
              .filter((p) => p.alerts.length)
              .map((p) => (
                <li key={p.store.id} className="rounded-xl border bg-card p-4">
                  <p className="mb-2 flex items-center gap-2 font-semibold">
                    <span className="size-2.5 rounded-full" style={{ background: seriesColor(p.slot) }} aria-hidden />
                    {p.store.name}
                  </p>
                  <ul className="space-y-1 text-sm">
                    {p.alerts.map((a) => (
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
                  <Link
                    href={`/sales?store=${p.store.id}`}
                    className={buttonVariants({ variant: "outline", size: "sm", className: "mt-3" })}
                  >
                    매출 입력하러 가기
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      )}

      {/* 선택 기간 */}
      <section aria-labelledby="period-h" className="mb-8">
        <h2 id="period-h" className="mb-3 text-sm font-semibold text-muted-foreground">
          {preset === "today" ? "오늘" : rangeLabel(period)} 요약 ({rangeLength(period)}일)
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="실매출 합계"
            value={sPeriod.netSales === null ? MISSING_LABEL : formatKRW(sPeriod.netSales)}
            muted={sPeriod.netSales === null}
            sub={enteredLabel(sPeriod.entered, sPeriod.expected)}
          />
          <StatTile
            label="건수"
            value={sPeriod.orderCount === null ? MISSING_LABEL : `${formatNumber(sPeriod.orderCount)}건`}
            muted={sPeriod.orderCount === null}
          />
          <StatTile
            label="건단가 (매출÷건수)"
            value={formatRatio(sPeriod.avgTicket, { suffix: "원", digits: 0 })}
            muted={sPeriod.avgTicket.status !== "ok"}
            sub="고객 수 대신 영수증 건수 기준"
          />
          <StatTile
            label="영업일 평균 매출"
            value={formatRatio(sPeriod.dailyAverage, { suffix: "원", digits: 0 })}
            muted={sPeriod.dailyAverage.status !== "ok"}
            sub={sPeriod.closedDays ? `휴무 ${sPeriod.closedDays}일 제외` : "지점·일 평균"}
          />
        </div>
      </section>

      {/* 지점 비교 */}
      <section aria-labelledby="cmp-h" className="mb-8">
        <h2 id="cmp-h" className="mb-3 text-sm font-semibold text-muted-foreground">
          지점별 비교 · {rangeLabel(period)}
        </h2>
        <div className="grid gap-4 xl:grid-cols-5">
          <div className="rounded-xl border bg-card p-4 xl:col-span-2">
            {perStore.some((p) => p.period.netSales !== null) ? (
              <>
                <StoreBarChart
                  data={perStore
                    .filter((p) => p.period.netSales !== null)
                    .map((p) => ({ name: p.store.name.replace("향미옥 ", ""), slot: p.slot, value: p.period.netSales! }))}
                />
                {perStore.some((p) => !p.period.complete) && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    미입력이 있는 지점은 입력된 날만 합산됩니다. 표의 &apos;입력&apos; 열을 확인하세요.
                  </p>
                )}
              </>
            ) : (
              <EmptyState title="이 기간에 입력된 매출이 없습니다" />
            )}
          </div>
          <div className="overflow-x-auto rounded-xl border bg-card xl:col-span-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>지점</TableHead>
                  <TableHead className="text-right">실매출</TableHead>
                  <TableHead className="text-right">건수</TableHead>
                  <TableHead className="text-right">건단가</TableHead>
                  <TableHead className="text-right whitespace-nowrap">좌석당 일매출</TableHead>
                  <TableHead className="text-right">입력</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perStore.map((p) => (
                  <TableRow key={p.store.id}>
                    <TableCell className="font-medium whitespace-nowrap">
                      <span className="mr-2 inline-block size-2.5 rounded-full" style={{ background: seriesColor(p.slot) }} aria-hidden />
                      {p.store.name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatKRW(p.period.netSales)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.period.orderCount === null ? MISSING_LABEL : formatNumber(p.period.orderCount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRatio(p.period.avgTicket, { suffix: "원", digits: 0 })}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {p.store.seatCount === null
                        ? "좌석 미확인"
                        : !p.period.complete
                          ? "비교 불가"
                          : formatRatio(p.seatDaily, { suffix: "원", digits: 0 })}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${p.period.complete ? "" : "text-amber-700"}`}>
                      {p.period.entered}/{p.period.expected}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              {perStore.length > 1 && (
                <TableFooter>
                  <TableRow>
                    <TableCell>합계</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKRW(sPeriod.netSales)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {sPeriod.orderCount === null ? MISSING_LABEL : formatNumber(sPeriod.orderCount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRatio(sPeriod.avgTicket, { suffix: "원", digits: 0 })}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular-nums">
                      {sPeriod.entered}/{sPeriod.expected}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        </div>
      </section>

      {rangeLength(period) > 1 && (
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

      {/* 3단계 지표 */}
      <section className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {["식재료 원가율", "인건비율", "추정 영업이익"].map((k) => (
          <StatTile key={k} label={k} value="준비 중" muted sub="3단계(지출·인건비 입력) 후 계산됩니다" />
        ))}
      </section>

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        데이터 출처: 지점 관리자가 POS 마감 영수증을 보고 입력한 실매출·건수 (CSV 업로드 포함) ·{" "}
        {latest
          ? `최종 갱신 ${formatDateTimeKo(latest.updatedAt)} (${latest.updatedByName ?? "알 수 없음"})`
          : "아직 입력된 데이터 없음"}{" "}
        ·{" "}
        <a className="underline underline-offset-2" href={`/sales/export?from=${period.start}&to=${period.end}${storeParam ? `&store=${storeParam}` : ""}`}>
          이 기간 CSV 내려받기
        </a>
      </footer>
    </>
  );
}
