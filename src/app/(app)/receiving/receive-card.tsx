"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/form-fields";
import { formatKRW } from "@/lib/format";
import { shortDateKo } from "@/lib/period";
import {
  fmtQty,
  lineChanges,
  qtyLabel,
  receiptTotal,
  receiveLineAmount,
  receiveProblems,
  toCompleteLines,
  type CheckStatus,
  type ReceiveLine,
} from "@/lib/orders";
import { cn } from "@/lib/utils";
import { completeReceiptAction } from "../orders/actions";

interface Group {
  orderId: string;
  orderDate: string;
  vendorId: string | null;
  vendorName: string;
  lines: { lineId: string; itemName: string; unit: string | null; qty: number; price: number | null }[];
}

const digits = (v: string, max = 9) => v.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "").slice(0, max);
const decimal = (v: string) => {
  const s = v.replace(/[^\d.]/g, "");
  const [a, ...rest] = s.split(".");
  return rest.length ? `${a}.${rest.join("").slice(0, 3)}` : a;
};
const comma = (v: string) => (v ? Number(v).toLocaleString("ko-KR") : "");

const STATUS_BTN: { status: CheckStatus; label: string; cls: string }[] = [
  { status: "ok", label: "같음", cls: "border-emerald-600 bg-emerald-600 text-white" },
  { status: "changed", label: "다름", cls: "border-amber-500 bg-amber-500 text-white" },
  { status: "missing", label: "안 옴", cls: "border-red-600 bg-red-600 text-white" },
];

export function ReceiveCard({ group, vendors }: { group: Group; vendors: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lines, setLines] = useState<ReceiveLine[]>(() =>
    group.lines.map((l) => ({
      lineId: l.lineId,
      itemName: l.itemName,
      unit: l.unit,
      orderedQty: l.qty,
      price: l.price,
      status: null,
      qty: fmtQty(l.qty),
      newPrice: l.price === null ? "" : String(l.price),
    })),
  );
  const [vendorId, setVendorId] = useState(group.vendorId ?? "");
  const [vat, setVat] = useState("");
  const [receipt, setReceipt] = useState("");
  const [memo, setMemo] = useState("");

  const total = receiptTotal(lines, Number(vat || 0));
  const problems = receiveProblems(lines);
  const checked = lines.filter((l) => l.status !== null).length;
  const mismatch = receipt !== "" && Number(receipt) !== total;
  const canComplete = problems.length === 0 && !!vendorId && (!mismatch || memo.trim().length > 0);

  function setLine(id: string, patch: Partial<ReceiveLine>) {
    setLines((ls) => ls.map((l) => (l.lineId === id ? { ...l, ...patch } : l)));
  }

  function complete() {
    if (!canComplete) {
      toast.error(problems[0] ?? (!vendorId ? "거래처를 골라 주세요." : "영수증 합계가 달라요. 다시 확인하거나 이유를 적어 주세요."));
      return;
    }
    startTransition(async () => {
      const r = await completeReceiptAction({
        orderId: group.orderId,
        vendorId,
        lines: toCompleteLines(lines),
        vat,
        receiptTotal: receipt,
        memo,
      });
      if (r.ok) {
        toast.success(`${vendors.find((v) => v.id === vendorId)?.name ?? group.vendorName} ${r.message}`);
        router.refresh();
      } else toast.error(r.message ?? "완료하지 못했어요.", { duration: 8000 });
    });
  }

  return (
    <section className="rounded-xl border bg-card" aria-label={`${group.vendorName} 입고 확인`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="text-lg font-bold">{group.vendorName}</h2>
          <p className="text-xs text-muted-foreground">
            {shortDateKo(group.orderDate)} 발주 · {lines.length}개 품목 · 확인 {checked}/{lines.length}
          </p>
        </div>
        {!group.vendorId && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-amber-700">거래처 고르기</span>
            <NativeSelect value={vendorId} onChange={(e) => setVendorId(e.target.value)} aria-label="거래처">
              <option value="">선택</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
      </header>

      <ul className="divide-y">
        {lines.map((l) => {
          const { priceChanged, qtyChanged } = lineChanges(l);
          const amount = l.price === null ? null : Math.round(l.orderedQty * l.price);
          return (
            <li key={l.lineId} className={cn("px-4 py-3", l.status === null && "bg-background", l.status !== null && "bg-muted/30")}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-base font-semibold">
                  {l.itemName} <span className="font-normal text-muted-foreground">{qtyLabel(l.orderedQty, l.unit) || "1"}</span>
                </p>
                <p className="text-right tabular-nums">
                  {l.price === null ? (
                    <span className="text-sm text-amber-700">단가 모름</span>
                  ) : (
                    <>
                      <span className="text-xs text-muted-foreground">{l.price.toLocaleString("ko-KR")}원 × {fmtQty(l.orderedQty)} = </span>
                      <span className="text-base font-bold">{amount?.toLocaleString("ko-KR")}원</span>
                    </>
                  )}
                </p>
              </div>

              <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label={`${l.itemName} 확인`}>
                {STATUS_BTN.map((b) => {
                  const disabled = b.status === "ok" && l.price === null;
                  return (
                    <button
                      key={b.status}
                      type="button"
                      role="radio"
                      aria-checked={l.status === b.status}
                      disabled={disabled}
                      onClick={() => setLine(l.lineId, { status: b.status })}
                      className={cn(
                        "h-11 rounded-lg border text-base font-semibold disabled:opacity-40",
                        l.status === b.status ? b.cls : "bg-background",
                      )}
                    >
                      {b.label}
                    </button>
                  );
                })}
              </div>

              {l.status === "changed" && (
                <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 dark:bg-amber-950/30">
                  <p className="mb-2 text-xs text-amber-900 dark:text-amber-200">종이에 적힌 대로 고쳐 주세요.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs">
                      받은 수량{l.unit ? ` (${l.unit})` : ""}
                      <Input
                        inputMode="decimal"
                        value={l.qty}
                        onChange={(e) => setLine(l.lineId, { qty: decimal(e.target.value) })}
                        className={cn("mt-1 h-11 text-right text-base tabular-nums", qtyChanged && "border-amber-500")}
                      />
                    </label>
                    <label className="text-xs">
                      단가 (원)
                      <Input
                        inputMode="numeric"
                        value={comma(l.newPrice)}
                        onChange={(e) => setLine(l.lineId, { newPrice: digits(e.target.value) })}
                        className={cn("mt-1 h-11 text-right text-base tabular-nums", priceChanged && "border-amber-500")}
                      />
                    </label>
                  </div>
                  <p className="mt-2 text-sm font-semibold tabular-nums">
                    = {receiveLineAmount(l).toLocaleString("ko-KR")}원
                    {priceChanged && l.price !== null && (
                      <span className="ml-2 text-amber-800">
                        단가 {Number(l.newPrice) > l.price ? "▲" : "▼"} {l.price.toLocaleString("ko-KR")} → {Number(l.newPrice).toLocaleString("ko-KR")}
                      </span>
                    )}
                    {qtyChanged && <span className="ml-2 text-amber-800">수량 {fmtQty(l.orderedQty)} → {l.qty || 0}</span>}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <footer className="space-y-3 border-t px-4 py-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            부가세 (따로 적혀 있으면)
            <Input
              inputMode="numeric"
              placeholder="없으면 비움"
              value={comma(vat)}
              onChange={(e) => setVat(digits(e.target.value))}
              className="mt-1 h-11 text-right text-base tabular-nums"
            />
          </label>
          <label className="text-sm">
            종이 맨 아래 합계
            <Input
              inputMode="numeric"
              placeholder="영수증 합계"
              value={comma(receipt)}
              onChange={(e) => setReceipt(digits(e.target.value, 10))}
              className="mt-1 h-11 text-right text-base tabular-nums"
            />
          </label>
        </div>

        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm",
            receipt === "" ? "bg-muted" : mismatch ? "bg-red-50 text-red-950" : "bg-emerald-50 text-emerald-950",
          )}
        >
          <p className="flex items-center gap-1 font-semibold tabular-nums">
            {receipt !== "" && (mismatch ? <TriangleAlert className="size-4" aria-hidden /> : <CircleCheck className="size-4" aria-hidden />)}
            앱 합계 {formatKRW(total)}
            {receipt !== "" && (mismatch ? ` · 영수증과 ${formatKRW(Math.abs(Number(receipt) - total))} 차이` : " · 영수증과 같아요")}
          </p>
          {mismatch && <p className="text-xs">[다름]을 안 누른 줄이 없는지 다시 보세요. 그래도 다르면 아래에 이유를 적고 완료할 수 있어요.</p>}
        </div>

        {mismatch && (
          <Input
            aria-label="차이 나는 이유"
            placeholder="이유 (예: 거래처가 다음에 정산한다고 함)"
            value={memo}
            maxLength={200}
            onChange={(e) => setMemo(e.target.value)}
            className="h-11 text-base"
          />
        )}

        {problems.length > 0 && <p className="text-xs text-amber-800">{problems[0]}</p>}

        <Button type="button" className="h-12 w-full text-base" disabled={pending || !canComplete} onClick={complete}>
          {pending ? "저장 중…" : `입고 완료 (${formatKRW(total)})`}
        </Button>
      </footer>
    </section>
  );
}
