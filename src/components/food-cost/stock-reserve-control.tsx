"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { STOCK_RESERVE_OPTIONS } from "@/lib/pnl";
import { setStockReserveAction } from "@/app/(app)/admin/stores/actions";

const EXAMPLE = 10_000_000; // 설명용: 한 달 식재료 1,000만 원

/** 냉장고 재고 비율 바꾸기 (대표만 보이는 버튼) */
export function StockReserveControl({ storeId, storeName, value }: { storeId: string; storeName: string; value: number }) {
  const [open, setOpen] = useState(false);
  const [pct, setPct] = useState(value);
  const [pending, startTransition] = useTransition();
  const reserve = Math.round((EXAMPLE * pct) / 100);

  function save() {
    startTransition(async () => {
      const r = await setStockReserveAction(storeId, pct);
      if (r.ok) {
        toast.success(r.message);
        setOpen(false);
      } else if (r.message) toast.error(r.message, { duration: 8000 });
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setPct(value);
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>냉장고 재고 {value}% · 바꾸기</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>냉장고 재고 비율</DialogTitle>
          <DialogDescription>
            {storeName} · 이번 달에 산 식재료 중 아직 냉장고에 남아 있다고 볼 비율이에요. 이만큼은 원가에서 빼고 원가율을
            계산해요. 대표만 바꿀 수 있어요.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="냉장고 재고 비율">
          {STOCK_RESERVE_OPTIONS.map((o) => (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={pct === o}
              onClick={() => setPct(o)}
              className={`h-12 rounded-xl border text-lg font-semibold tabular-nums ${
                pct === o ? "border-foreground bg-foreground text-background" : "bg-background"
              }`}
            >
              {o}%
            </button>
          ))}
        </div>

        <p className="rounded-lg bg-muted px-3 py-2 text-sm">
          예: 이번 달 식재료를 1,000만 원 샀다면 {pct}%인 {reserve.toLocaleString("ko-KR")}원은 냉장고에 남아 있다고 보고,{" "}
          <b>{(EXAMPLE - reserve).toLocaleString("ko-KR")}원</b>만 원가로 계산해요.
        </p>
        <p className="text-xs text-muted-foreground">
          월말에 남은 재고를 직접 세어 [손익] 화면에 넣은 달은 이 비율 대신 실제 재고로 계산해요.
        </p>

        <Button className="h-11 text-base" onClick={save} disabled={pending || pct === value}>
          {pending ? "저장 중…" : pct === value ? `지금 ${value}%` : `${pct}%로 저장`}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
