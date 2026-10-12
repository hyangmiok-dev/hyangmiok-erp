"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatKoreanWon } from "@/lib/format";
import { keepFormOnSubmit } from "@/lib/use-keep-form";
import type { ActionResult } from "@/lib/validation/users";
import { saveInventoryAction } from "../expenses/actions";

/** 월말 재고 금액 입력 (한 줄) */
export function InventoryForm({
  storeId,
  countDate,
  label,
  current,
  disabled,
}: {
  storeId: string;
  countDate: string;
  label: string;
  current: number | null;
  disabled?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveInventoryAction, { ok: false });
  const [amount, setAmount] = useState(current === null ? "" : String(current));

  useEffect(() => {
    if (!state.message && !state.fieldErrors) return;
    if (state.ok) toast.success(state.message);
    else toast.error(state.message ?? Object.values(state.fieldErrors ?? {})[0]);
  }, [state]);

  return (
    <form onSubmit={keepFormOnSubmit(action)} className="flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="countDate" value={countDate} />
      <span className="w-36 shrink-0">{label}</span>
      <div className="relative">
        <Input
          name="amount"
          inputMode="numeric"
          aria-label={label}
          disabled={disabled}
          placeholder={disabled ? "월말 이후 입력" : "재고 금액"}
          value={amount ? Number(amount).toLocaleString("ko-KR") : ""}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "").slice(0, 10))}
          className="h-10 w-40 pr-7 text-right text-base tabular-nums"
        />
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">원</span>
      </div>
      <Button type="submit" variant="outline" size="sm" className="h-10" disabled={pending || disabled || amount === ""}>
        {pending ? "저장 중…" : "저장"}
      </Button>
      <span className="text-xs text-muted-foreground">{amount ? formatKoreanWon(Number(amount)) : current === null ? "미입력" : ""}</span>
    </form>
  );
}
