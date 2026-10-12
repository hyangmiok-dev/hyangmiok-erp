"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PERIOD_LABEL, PERIOD_PRESETS, type PeriodPreset } from "@/lib/period";

/** 기간·지점 필터 (한 줄). 선택은 URL 에 저장되어 새로고침·공유해도 유지된다. */
export function DashboardFilters({
  preset,
  from,
  to,
  today,
  storeId,
  stores,
}: {
  preset: PeriodPreset;
  from: string;
  to: string;
  today: string;
  storeId: string;
  stores: { id: string; name: string }[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);

  function go(next: Record<string, string | null>) {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    startTransition(() => router.push(`/?${q.toString()}`, { scroll: false }));
  }

  return (
    <div className={cn("mb-6 space-y-3", pending && "opacity-60")} aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label="기간">
          {PERIOD_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={p === preset}
              onClick={() => go(p === "custom" ? { period: p, from: customFrom, to: customTo } : { period: p, from: null, to: null })}
              className={cn(
                "h-10 shrink-0 rounded-full border px-4 text-sm whitespace-nowrap",
                p === preset ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-muted",
              )}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
        {stores.length > 1 && (
          <select
            aria-label="지점"
            value={storeId}
            onChange={(e) => go({ store: e.target.value === "all" ? null : e.target.value })}
            className="h-10 rounded-full border bg-background px-4 text-sm"
          >
            <option value="all">전체 지점</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {preset === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            aria-label="시작일"
            value={customFrom}
            max={today}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="h-10 rounded-lg border bg-background px-3 text-base"
          />
          <span>~</span>
          <input
            type="date"
            aria-label="종료일"
            value={customTo}
            max={today}
            onChange={(e) => setCustomTo(e.target.value)}
            className="h-10 rounded-lg border bg-background px-3 text-base"
          />
          <Button variant="outline" className="h-10" onClick={() => go({ period: "custom", from: customFrom, to: customTo })}>
            적용
          </Button>
        </div>
      )}
    </div>
  );
}
