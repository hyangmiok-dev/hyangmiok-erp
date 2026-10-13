"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/form-fields";
import { formatKoreanWon, formatKRW } from "@/lib/format";
import { shortDateKo } from "@/lib/period";
import { checkAll, qtyLabel, receiveProblems, toCompleteLines, type CheckStatus, type ReceiveLine } from "@/lib/orders";
import { cn } from "@/lib/utils";
import { completeReceiptAction } from "../orders/actions";

interface Group {
  orderId: string;
  orderDate: string;
  vendorId: string | null;
  vendorName: string;
  lines: { lineId: string; itemName: string; unit: string | null; qty: number }[];
}

const digits = (v: string) => v.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "").slice(0, 10);
const comma = (v: string) => (v ? Number(v).toLocaleString("ko-KR") : "");

/** 거래처 한 곳: 품목 체크(왔음/안 옴) → 거래명세표 총금액 → [입고 완료] */
export function ReceiveCard({ group, vendors }: { group: Group; vendors: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lines, setLines] = useState<ReceiveLine[]>(() =>
    group.lines.map((l) => ({ lineId: l.lineId, itemName: l.itemName, unit: l.unit, orderedQty: l.qty, status: null })),
  );
  const [vendorId, setVendorId] = useState(group.vendorId ?? "");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");

  const checked = lines.filter((l) => l.status !== null).length;
  const missing = lines.filter((l) => l.status === "missing").length;
  const problems = receiveProblems(lines, amount, !!vendorId);
  const allMissing = checked === lines.length && missing === lines.length;

  function setStatus(id: string, status: CheckStatus) {
    setLines((ls) => ls.map((l) => (l.lineId === id ? { ...l, status: l.status === status ? null : status } : l)));
  }

  function complete() {
    if (problems.length) {
      toast.error(problems[0]);
      return;
    }
    startTransition(async () => {
      const r = await completeReceiptAction({
        orderId: group.orderId,
        vendorId,
        lines: toCompleteLines(lines),
        amount: allMissing && amount === "" ? "0" : amount,
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
            {shortDateKo(group.orderDate)} 발주 · 체크 {checked}/{lines.length}
            {missing ? ` · 안 옴 ${missing}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!group.vendorId && (
            <NativeSelect value={vendorId} onChange={(e) => setVendorId(e.target.value)} aria-label="거래처 고르기">
              <option value="">거래처 고르기</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </NativeSelect>
          )}
          <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => setLines((ls) => checkAll(ls))}>
            <CheckCheck className="size-4" /> 모두 왔음
          </Button>
        </div>
      </header>

      <ul className="divide-y">
        {lines.map((l) => (
          <li key={l.lineId} className={cn("flex items-center gap-2 px-4 py-2", l.status === "missing" && "bg-red-50/60 dark:bg-red-950/20")}>
            <p className={cn("min-w-0 flex-1 text-base", l.status === "missing" && "text-muted-foreground line-through")}>
              <span className="font-semibold">{l.itemName}</span>{" "}
              <span className="text-muted-foreground">{qtyLabel(l.orderedQty, l.unit) || "1"}</span>
            </p>
            <div className="flex gap-1" role="radiogroup" aria-label={`${l.itemName} 확인`}>
              <button
                type="button"
                role="radio"
                aria-checked={l.status === "ok"}
                onClick={() => setStatus(l.lineId, "ok")}
                className={cn(
                  "h-11 w-16 rounded-lg border text-base font-semibold",
                  l.status === "ok" ? "border-emerald-600 bg-emerald-600 text-white" : "bg-background",
                )}
              >
                왔음
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={l.status === "missing"}
                onClick={() => setStatus(l.lineId, "missing")}
                className={cn(
                  "h-11 w-16 rounded-lg border text-base font-semibold",
                  l.status === "missing" ? "border-red-600 bg-red-600 text-white" : "bg-background",
                )}
              >
                안 옴
              </button>
            </div>
          </li>
        ))}
      </ul>

      <footer className="space-y-3 border-t px-4 py-3">
        {!allMissing && (
          <label className="block">
            <span className="text-sm font-semibold">거래명세표 총금액</span>
            <div className="relative mt-1">
              <Input
                inputMode="numeric"
                placeholder="종이 맨 아래 합계"
                value={comma(amount)}
                onChange={(e) => setAmount(digits(e.target.value))}
                className="h-12 pr-8 text-right text-xl font-bold tabular-nums"
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">원</span>
            </div>
            <span className="text-xs text-muted-foreground">{amount ? formatKoreanWon(Number(amount)) : "부가세 포함 최종 금액"}</span>
          </label>
        )}
        <Input
          aria-label="메모"
          placeholder="메모 (선택, 예: 숙주 1박스 덜 옴)"
          value={memo}
          maxLength={200}
          onChange={(e) => setMemo(e.target.value)}
          className="h-10 text-base"
        />
        {problems.length > 0 && <p className="text-xs text-amber-800">{problems[0]}</p>}
        <Button type="button" className="h-12 w-full text-base" disabled={pending || problems.length > 0} onClick={complete}>
          {pending ? "저장 중…" : allMissing ? "입고 완료 (모두 안 옴)" : `입고 완료${amount ? ` · ${formatKRW(Number(amount))}` : ""}`}
        </Button>
      </footer>
    </section>
  );
}
