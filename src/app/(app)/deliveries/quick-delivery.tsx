"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatKRW } from "@/lib/format";
import { shortDateKo } from "@/lib/period";
import {
  cleanQty,
  cleanWon,
  deliveryTotal,
  fillLastTime,
  formatQty,
  newRow,
  receivedRows,
  rowAmount,
  rowProblems,
  rowsFromItems,
  stepQty,
  toDeliveryLines,
  type DeliveryItem,
  type DeliveryRow,
} from "@/lib/deliveries";
import { cn } from "@/lib/utils";
import { recordDeliveryAction } from "./actions";

interface VendorOption {
  id: string;
  name: string;
  items: string | null;
  onCredit: boolean;
  linked: boolean;
}

const comma = (v: string) => (v ? Number(v).toLocaleString("ko-KR") : "");

export function QuickDelivery({
  storeId,
  vendors,
  itemsByVendor,
  today,
  minDate,
}: {
  storeId: string;
  vendors: VendorOption[];
  itemsByVendor: Record<string, DeliveryItem[]>;
  today: string;
  /** 지점·본사 관리자는 7일 전까지 */
  minDate: string | undefined;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [vat, setVat] = useState("");
  const [onCredit, setOnCredit] = useState(true);
  const [date, setDate] = useState(today);
  const [memo, setMemo] = useState("");

  const linked = vendors.filter((v) => v.linked);
  const others = vendors.filter((v) => !v.linked);
  const shown = showAll || linked.length === 0 ? vendors : linked;
  const vendor = vendors.find((v) => v.id === vendorId) ?? null;

  const vatNum = Number(vat || 0);
  const total = deliveryTotal(rows, vatNum);
  const count = receivedRows(rows).length;
  const hasLast = rows.some((r) => r.inLast && r.lastQty);

  function pick(v: VendorOption) {
    setVendorId(v.id);
    const items = itemsByVendor[v.id] ?? [];
    setRows(items.length ? rowsFromItems(items) : [newRow()]);
    setOnCredit(v.onCredit);
    setVat("");
    setMemo("");
  }

  function update(key: string, patch: Partial<DeliveryRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function save() {
    if (!vendor) return;
    if (count === 0) {
      toast.error("받은 품목의 수량을 넣어 주세요.");
      return;
    }
    const problems = rowProblems(rows);
    if (problems.length) {
      toast.error(problems[0]);
      return;
    }
    startTransition(async () => {
      const r = await recordDeliveryAction({
        storeId,
        vendorId: vendor.id,
        date,
        lines: toDeliveryLines(rows),
        vat,
        onCredit,
        memo,
      });
      if (r.ok) {
        toast.success(`${vendor.name} ${r.message}`);
        setVendorId(null);
        setRows([]);
        setDate(today);
        window.scrollTo({ top: 0, behavior: "smooth" });
        router.refresh();
      } else toast.error(r.message ?? "저장하지 못했어요.", { duration: 8000 });
    });
  }

  return (
    <div className="space-y-5">
      {/* ① 거래처 */}
      <section aria-labelledby="dv-vendor">
        <h2 id="dv-vendor" className="mb-2 font-semibold">
          ① 거래처
        </h2>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="거래처">
          {shown.map((v) => (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={vendorId === v.id}
              onClick={() => pick(v)}
              className={cn(
                "min-h-12 rounded-xl border px-2 py-2 text-center text-base font-semibold",
                vendorId === v.id ? "border-foreground bg-foreground text-background" : "bg-background",
              )}
            >
              {v.name}
            </button>
          ))}
        </div>
        {others.length > 0 && linked.length > 0 && (
          <button type="button" className="mt-2 text-sm underline underline-offset-2" onClick={() => setShowAll((s) => !s)}>
            {showAll ? "이 지점 거래처만 보기" : `다른 거래처도 보기 (${others.length})`}
          </button>
        )}
      </section>

      {vendor && (
        <>
          {/* ② 품목·수량 */}
          <section aria-labelledby="dv-items">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 id="dv-items" className="font-semibold">
                ② 받은 수량
              </h2>
              {hasLast && (
                <Button type="button" variant="outline" size="sm" onClick={() => setRows((rs) => fillLastTime(rs))}>
                  <RotateCcw className="size-4" /> 지난번과 똑같이
                </Button>
              )}
            </div>

            <ul className="space-y-2">
              {rows.map((r, i) => {
                const amount = rowAmount(r);
                const priceChanged = r.lastPrice !== null && r.price !== "" && Number(r.price) !== r.lastPrice;
                return (
                  <li key={r.key} className={cn("rounded-xl border p-3", Number(r.qty) > 0 && "border-foreground bg-muted/40")}>
                    <div className="flex items-start gap-2">
                      {r.isNew ? (
                        <div className="grid flex-1 grid-cols-[1fr_5rem] gap-2">
                          <Input
                            aria-label={`${i + 1}번째 새 품목 이름`}
                            placeholder="품목 이름"
                            value={r.itemName}
                            maxLength={60}
                            onChange={(e) => update(r.key, { itemName: e.target.value })}
                            className="h-10 text-base"
                          />
                          <Input
                            aria-label="단위"
                            placeholder="단위"
                            value={r.unit}
                            maxLength={10}
                            onChange={(e) => update(r.key, { unit: e.target.value })}
                            className="h-10 text-base"
                          />
                        </div>
                      ) : (
                        <p className="flex-1 pt-1 text-base font-semibold">
                          {r.itemName}
                          {r.unit && <span className="ml-1 text-sm font-normal text-muted-foreground">({r.unit})</span>}
                        </p>
                      )}
                      <span className="pt-1 text-right font-semibold tabular-nums">{amount > 0 ? formatKRW(amount) : ""}</span>
                      {r.isNew && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-lg"
                          aria-label="이 줄 지우기"
                          onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                        >
                          <X className="size-4" />
                        </Button>
                      )}
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-lg"
                        className="size-11"
                        aria-label={`${r.itemName || "품목"} 수량 1 줄이기`}
                        onClick={() => update(r.key, { qty: stepQty(r.qty, -1) })}
                      >
                        <Minus className="size-5" />
                      </Button>
                      <Input
                        aria-label={`${r.itemName || "품목"} 수량`}
                        inputMode="decimal"
                        placeholder="0"
                        value={r.qty}
                        onChange={(e) => update(r.key, { qty: cleanQty(e.target.value) })}
                        className="h-11 w-16 text-center text-lg font-semibold tabular-nums"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-lg"
                        className="size-11"
                        aria-label={`${r.itemName || "품목"} 수량 1 늘리기`}
                        onClick={() => update(r.key, { qty: stepQty(r.qty, 1) })}
                      >
                        <Plus className="size-5" />
                      </Button>
                      <span className="ml-auto text-xs text-muted-foreground">단가</span>
                      <Input
                        aria-label={`${r.itemName || "품목"} 단가`}
                        inputMode="numeric"
                        placeholder="단가"
                        value={comma(r.price)}
                        onChange={(e) => update(r.key, { price: cleanWon(e.target.value) })}
                        className={cn("h-11 w-28 text-right text-base tabular-nums", priceChanged && "border-amber-500")}
                      />
                    </div>

                    {!r.isNew && (
                      <p className={cn("mt-1 text-[11px] text-muted-foreground", priceChanged && "text-amber-700")}>
                        {r.lastDate && `지난번 ${shortDateKo(r.lastDate)}`}
                        {r.lastQty ? ` · ${formatQty(r.lastQty)}${r.unit}` : ""}
                        {r.lastPrice !== null && ` · ${r.lastPrice.toLocaleString("ko-KR")}원`}
                        {priceChanged && " → 단가가 바뀌었어요"}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

            <Button type="button" variant="outline" className="mt-2 h-11 w-full" onClick={() => setRows((rs) => [...rs, newRow()])}>
              <Plus className="size-4" /> 새 품목 추가
            </Button>
            {rows.every((r) => r.isNew) && (
              <p className="mt-2 text-xs text-muted-foreground">
                이 거래처는 처음이라 품목을 직접 적어 주세요. 한 번 적으면 다음부터는 목록으로 나와요.
              </p>
            )}
          </section>

          {/* ③ 저장 (화면 아래에 붙어 있음) */}
          <section aria-label="저장" className="sticky bottom-0 z-10 -mx-4 space-y-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground">날짜</span>
                <Input
                  type="date"
                  value={date}
                  max={today}
                  min={minDate}
                  onChange={(e) => setDate(e.target.value || today)}
                  className="h-10 w-40 text-base"
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground">부가세</span>
                <Input
                  inputMode="numeric"
                  placeholder="없으면 비움"
                  value={comma(vat)}
                  onChange={(e) => setVat(cleanWon(e.target.value))}
                  className="h-10 w-28 text-right text-base tabular-nums"
                />
              </label>
              <label className="flex min-h-10 items-center gap-2">
                <input type="checkbox" className="size-5" checked={onCredit} onChange={(e) => setOnCredit(e.target.checked)} />
                외상
              </label>
              <Input
                aria-label="메모"
                placeholder="메모 (선택, 예: 숙주 1박스 반품)"
                value={memo}
                maxLength={200}
                onChange={(e) => setMemo(e.target.value)}
                className="h-10 min-w-48 flex-1 text-base"
              />
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">
                  {vendor.name} · {count}개 품목{vatNum > 0 ? " + 부가세" : ""}
                </p>
                <p className="text-2xl font-bold tabular-nums">{formatKRW(total)}</p>
              </div>
              <Button type="button" className="h-12 min-w-28 text-base" disabled={pending || count === 0} onClick={save}>
                {pending ? "저장 중…" : "저장"}
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
