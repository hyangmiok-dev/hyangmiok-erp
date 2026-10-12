"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-fields";
import { formatKoreanWon } from "@/lib/format";
import { entryWarnings } from "@/lib/sales/summary";
import { keepFormOnSubmit } from "@/lib/use-keep-form";
import type { ActionResult } from "@/lib/validation/users";
import { saveSaleAction } from "./actions";

export interface ExistingSale {
  netSales: number;
  orderCount: number;
  isClosed: boolean;
  memo: string | null;
  updatedAt: string;
}

function digitsOnly(v: string): string {
  return v.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
}

function withCommas(v: string): string {
  return v ? Number(v).toLocaleString("ko-KR") : "";
}

export function SaleForm({
  storeId,
  businessDate,
  existing,
  sameWeekdayLastWeek,
}: {
  storeId: string;
  businessDate: string;
  existing: ExistingSale | null;
  sameWeekdayLastWeek: number | null;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveSaleAction, { ok: false });
  const [net, setNet] = useState(existing && !existing.isClosed ? String(existing.netSales) : "");
  const [orders, setOrders] = useState(existing && !existing.isClosed ? String(existing.orderCount) : "");
  const [closed, setClosed] = useState(existing?.isClosed ?? false);
  const fe = state.fieldErrors ?? {};

  useEffect(() => {
    if (!state.message) return;
    if (state.ok) toast.success(state.message);
    else toast.error(state.message, { duration: 8000 });
  }, [state]);

  const warnings = useMemo(
    () =>
      net === "" || orders === ""
        ? []
        : entryWarnings({ netSales: Number(net), orderCount: Number(orders), isClosed: closed, sameWeekdayLastWeek }),
    [net, orders, closed, sameWeekdayLastWeek],
  );

  return (
    <form onSubmit={keepFormOnSubmit(action)} className="space-y-5">
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="businessDate" value={businessDate} />
      {existing && <input type="hidden" name="expectedUpdatedAt" value={existing.updatedAt} />}
      {fe.businessDate && <p className="text-sm text-destructive">{fe.businessDate}</p>}

      <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-4 text-base">
        <input
          type="checkbox"
          name="isClosed"
          checked={closed}
          onChange={(e) => setClosed(e.target.checked)}
          className="size-5"
        />
        오늘은 쉬는 날(휴무)이에요
      </label>

      {!closed && (
        <>
          <Field label="실매출 (할인·취소 뺀 금액)" htmlFor="netSales" error={fe.netSales}>
            <div className="relative">
              <Input
                id="netSales"
                name="netSales"
                inputMode="numeric"
                autoComplete="off"
                placeholder="예: 1,234,000"
                value={withCommas(net)}
                onChange={(e) => setNet(digitsOnly(e.target.value).slice(0, 11))}
                className="h-14 pr-10 text-right text-2xl font-bold tabular-nums"
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground">원</span>
            </div>
            <p className="text-right text-sm text-muted-foreground" aria-live="polite">
              {net ? formatKoreanWon(Number(net)) : "POS 마감 영수증의 실매출(순매출)"}
            </p>
          </Field>

          <Field label="건수 (영수증 건수)" htmlFor="orderCount" error={fe.orderCount}>
            <div className="relative">
              <Input
                id="orderCount"
                name="orderCount"
                inputMode="numeric"
                autoComplete="off"
                placeholder="예: 87"
                value={withCommas(orders)}
                onChange={(e) => setOrders(digitsOnly(e.target.value).slice(0, 5))}
                className="h-14 pr-10 text-right text-2xl font-bold tabular-nums"
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground">건</span>
            </div>
          </Field>
        </>
      )}

      <Field label="메모 (선택)" htmlFor="memo" error={fe.memo}>
        <Input
          id="memo"
          name="memo"
          defaultValue={existing?.memo ?? ""}
          maxLength={500}
          placeholder="예: 단체손님, 비 와서 한산"
          className="h-11 text-base"
        />
      </Field>

      {warnings.length > 0 && (
        <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
          {warnings.map((w) => (
            <p key={w} className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                <b>확인 필요</b> · {w}
              </span>
            </p>
          ))}
          <p className="pl-6 text-xs">숫자가 맞으면 그대로 저장해도 됩니다.</p>
        </div>
      )}

      <Button type="submit" className="h-14 w-full text-lg" disabled={pending}>
        {pending ? (
          "저장 중…"
        ) : (
          <>
            <CheckCircle2 className="size-5" />
            {existing ? "수정 저장" : "저장"}
          </>
        )}
      </Button>
    </form>
  );
}
