"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatKRW } from "@/lib/format";
import { addDays, shortDateKo, type DateKey } from "@/lib/period";
import {
  amountOf,
  changedEntries,
  clearedNames,
  digitsOnly,
  initialValues,
  sheetTotal,
  withCommas,
  type SlipRow,
} from "@/lib/slips";
import { cn } from "@/lib/utils";
import { saveSlipsAction } from "./actions";

export interface SlipDayView {
  date: DateKey;
  total: number;
  vendors: number;
}

export function SlipSheet({
  storeId,
  date,
  today,
  minDate,
  rows,
  balances,
  days,
}: {
  storeId: string;
  date: DateKey;
  today: DateKey;
  /** 대표 외에는 7일 전까지 (null = 제한 없음) */
  minDate: DateKey | null;
  rows: SlipRow[];
  /** 거래처별 미수 잔액 — 대표·본사 관리자에게만 (그 외 null) */
  balances: Record<string, number> | null;
  days: SlipDayView[];
}) {
  const router = useRouter();
  const [values, setValues] = useState(() => initialValues(rows));
  const [pending, startTransition] = useTransition();
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const entries = useMemo(() => changedEntries(rows, values), [rows, values]);
  const total = useMemo(() => sheetTotal(rows, values), [rows, values]);
  const dirty = entries.length > 0;

  // 저장하지 않고 창을 닫거나 새로 고치면 브라우저가 한 번 묻는다
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const go = (d: DateKey) => {
    if (dirty && !confirm("저장하지 않은 금액이 있어요. 저장하지 않고 다른 날짜로 갈까요?")) return;
    router.push(`/slips?store=${storeId}&date=${d}`);
  };

  const save = () => {
    if (!dirty || pending) return;
    const cleared = clearedNames(rows, entries);
    if (cleared.length && !confirm(`${cleared.join(", ")} 전표를 지울까요? (칸을 비우면 지워져요)`)) return;
    startTransition(async () => {
      const r = await saveSlipsAction({ storeId, date, entries });
      if (r.ok) {
        toast.success(r.message);
        router.refresh();
      } else toast.error(r.message, { duration: 8000 });
    });
  };

  const prev = addDays(date, -1);
  const canPrev = !minDate || prev >= minDate;

  return (
    <div className="space-y-4">
      <nav aria-label="날짜" className="flex items-center gap-2">
        <Button type="button" variant="outline" size="lg" className="h-11" disabled={!canPrev} onClick={() => go(prev)}>
          <ChevronLeft className="size-4" /> 전날
        </Button>
        <input
          type="date"
          aria-label="날짜 고르기"
          value={date}
          min={minDate ?? undefined}
          max={today}
          onChange={(e) => {
            const v = e.target.value; // 달력에서 고른 날만 (범위 밖·입력 중인 값은 무시)
            if (v && v !== date && v <= today && v >= (minDate ?? "2020-01-01")) go(v);
          }}
          className="h-11 min-w-0 flex-1 rounded-md border bg-background px-3 text-center text-base"
        />
        {date < today ? (
          <Button type="button" variant="outline" size="lg" className="h-11" onClick={() => go(addDays(date, 1))}>
            다음날 <ChevronRight className="size-4" />
          </Button>
        ) : (
          <span className="flex h-11 items-center rounded-md bg-muted px-3 text-sm font-semibold">오늘</span>
        )}
      </nav>

      <section aria-labelledby="sheet-h" className="rounded-xl border bg-card">
        <header className="flex items-end justify-between gap-3 border-b px-4 py-3">
          <h2 id="sheet-h" className="text-lg font-bold">
            {date === today ? "오늘 전표" : `${shortDateKo(date)} 전표`}
          </h2>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            합계 <b className="text-2xl text-foreground tabular-nums">{total.toLocaleString("ko-KR")}</b>원
          </p>
        </header>
        <ul className="divide-y">
          {rows.map((r, i) => {
            const v = values[r.vendorId] ?? "";
            const changed = !r.hasLines && amountOf(v) !== (r.amount ?? 0);
            const bal = balances ? (balances[r.vendorId] ?? 0) : undefined;
            const nextBal = bal !== undefined && r.onCredit ? bal - (r.amount ?? 0) + amountOf(v) : bal;
            return (
              <li key={r.vendorId} className={cn("flex items-center gap-3 px-4 py-3", changed && "bg-amber-50/60")}>
                <div className="min-w-0 flex-1">
                  <label htmlFor={`slip-${r.vendorId}`} className="block truncate text-base font-semibold">
                    {r.vendorName}
                  </label>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {bal !== undefined && r.onCredit && (
                      <span className={cn("mr-2", (nextBal ?? 0) > 0 && "text-amber-700")}>
                        미수 {formatKRW(bal)}
                        {changed && nextBal !== bal && <b> → {formatKRW(nextBal)}</b>}
                      </span>
                    )}
                    {!r.onCredit && <span className="mr-2">바로 결제</span>}
                    {r.hasLines ? (
                      <span className="mr-2">상세 입력됨 · [지출 입력]에서 수정</span>
                    ) : (
                      r.enteredBy && r.enteredLabel && <span>{r.enteredBy} · {r.enteredLabel}</span>
                    )}
                  </p>
                </div>
                <div className="relative w-40 shrink-0 sm:w-48">
                  <Input
                    id={`slip-${r.vendorId}`}
                    ref={(el) => {
                      inputs.current[i] = el;
                    }}
                    inputMode="numeric"
                    enterKeyHint={i === rows.length - 1 ? "done" : "next"}
                    autoComplete="off"
                    placeholder="0"
                    value={withCommas(v)}
                    disabled={r.hasLines || pending}
                    onChange={(e) => setValues((s) => ({ ...s, [r.vendorId]: digitsOnly(e.target.value) }))}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      const next = inputs.current.slice(i + 1).find((el) => el && !el.disabled);
                      if (next) next.focus();
                      else e.currentTarget.blur();
                    }}
                    className={cn(
                      "h-12 pr-8 text-right text-lg font-semibold tabular-nums md:text-lg",
                      changed && "border-amber-500 ring-2 ring-amber-200",
                    )}
                  />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">원</span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        <p className="min-w-0 flex-1 text-sm" aria-live="polite">
          {dirty ? (
            <>
              <b className="text-amber-700">{entries.length}곳</b> 바뀜 · 아직 저장 안 됨
            </>
          ) : (
            <span className="text-muted-foreground">저장된 상태예요</span>
          )}
        </p>
        <Button type="button" size="lg" className="h-12 min-w-28 text-base" disabled={!dirty || pending} onClick={save}>
          {pending ? "저장 중…" : "저장"}
        </Button>
      </div>

      <section aria-labelledby="days-h">
        <h2 id="days-h" className="mb-2 text-sm font-semibold text-muted-foreground">
          지난 기록 (2주)
        </h2>
        {days.length === 0 ? (
          <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">아직 적은 전표가 없어요.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {days.map((d) => {
              const reachable = !minDate || d.date >= minDate;
              return (
                <li key={d.date}>
                  <button
                    type="button"
                    disabled={!reachable || d.date === date}
                    onClick={() => go(d.date)}
                    className={cn(
                      "flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left text-sm",
                      d.date === date ? "bg-muted font-semibold" : reachable && "hover:bg-muted/50",
                    )}
                  >
                    <span className="flex-1">
                      {d.date === today ? "오늘" : shortDateKo(d.date)} · {d.vendors}곳
                    </span>
                    <span className="font-semibold tabular-nums">{formatKRW(d.total)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
