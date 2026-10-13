"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Minus, Plus, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTimeKo, formatKRW } from "@/lib/format";
import { shortDateKo } from "@/lib/period";
import { groupByCategory, orderEstimate, qtyLabel, stepDown, stepUp, type OrderItem } from "@/lib/orders";
import { cn } from "@/lib/utils";
import { saveOrderAction, sendOrdersNowAction } from "./actions";

interface Props {
  storeId: string;
  storeName: string;
  items: OrderItem[];
  order: {
    id: string | null;
    orderDate: string;
    status: "open" | "submitted" | "sent";
    submittedAt: string | null;
    submittedByName: string | null;
    sentAt: string | null;
    lines: { itemId: string; qty: number }[];
  };
  canSendNow: boolean;
}

export function OrderSheet({ storeId, storeName, items, order, canSendNow }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const saved = useMemo(() => new Map(order.lines.map((l) => [l.itemId, l.qty])), [order.lines]);
  const [qty, setQty] = useState<Map<string, number>>(() => new Map(saved));
  const [search, setSearch] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const locked = order.status === "sent";

  const selected = items.filter((i) => (qty.get(i.id) ?? 0) > 0);
  const est = orderEstimate(selected.map((i) => ({ qty: qty.get(i.id) ?? 0, unitPrice: i.unitPrice })));
  const dirty = selected.length !== saved.size || selected.some((i) => saved.get(i.id) !== qty.get(i.id));

  const q = search.trim();
  const visible = items.filter((i) => (!q || i.name.includes(q)) && (!onlySelected || (qty.get(i.id) ?? 0) > 0));
  const groups = groupByCategory(visible);

  function setItem(id: string, v: number) {
    setQty((m) => {
      const next = new Map(m);
      if (v > 0) next.set(id, v);
      else next.delete(id);
      return next;
    });
  }

  function submit() {
    startTransition(async () => {
      const r = await saveOrderAction({
        storeId,
        lines: selected.map((i) => ({ itemId: i.id, qty: qty.get(i.id) ?? 0 })),
        submit: true,
      });
      if (r.ok) {
        toast.success(r.message);
        router.refresh();
      } else toast.error(r.message ?? "저장하지 못했어요.", { duration: 8000 });
    });
  }

  function sendNow() {
    if (!confirm("오늘 완료된 모든 지점 발주를 지금 텔레그램으로 보낼까요? 보낸 뒤에는 오늘 발주를 고칠 수 없어요.")) return;
    startTransition(async () => {
      const r = await sendOrdersNowAction(storeId);
      if (r.ok) {
        toast.success(r.message);
        router.refresh();
      } else toast.error(r.message ?? "보내지 못했어요.", { duration: 8000 });
    });
  }

  return (
    <div className="space-y-4">
      {/* 상태 */}
      <div
        className={cn(
          "rounded-xl border p-3 text-sm",
          order.status === "submitted" && !dirty && "border-emerald-300 bg-emerald-50 text-emerald-950",
          locked && "bg-muted",
        )}
        role="status"
      >
        <p className="font-semibold">
          {storeName.replace("향미옥 ", "")} · {shortDateKo(order.orderDate)} 밤 9시에 텔레그램으로 보내는 발주
        </p>
        {locked ? (
          <p>보냄 ✓ {order.sentAt ? formatDateTimeKo(order.sentAt) : ""} — 이 발주는 고칠 수 없어요. 급한 건 거래처에 직접 연락해 주세요.</p>
        ) : order.status === "submitted" ? (
          <p className="flex items-center gap-1">
            <CircleCheck className="size-4" aria-hidden />
            완료됨 {order.submittedAt ? formatDateTimeKo(order.submittedAt) : ""}
            {order.submittedByName ? ` (${order.submittedByName})` : ""}
            {dirty ? " — 고친 내용이 있어요. 다시 [발주 완료]를 눌러 주세요." : " — 9시 전까지 고치고 다시 완료할 수 있어요."}
          </p>
        ) : (
          <p>필요한 품목을 담고 9시 전에 [발주 완료]를 눌러 주세요. 완료를 안 누르면 보내지 않아요.</p>
        )}
      </div>

      {/* 찾기 */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="품목 찾기"
            placeholder="품목 찾기 (예: 숙주)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11 pl-9 text-base"
          />
        </div>
        <Button
          type="button"
          variant={onlySelected ? "default" : "outline"}
          className="h-11"
          onClick={() => setOnlySelected((s) => !s)}
          aria-pressed={onlySelected}
        >
          담은 것만 ({selected.length})
        </Button>
      </div>

      {groups.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">맞는 품목이 없어요.</p>}

      {groups.map((g) => (
        <section key={g.category} aria-labelledby={`cat-${g.category}`}>
          <h2 id={`cat-${g.category}`} className="mb-1 px-1 text-sm font-semibold text-muted-foreground">
            [{g.category}]
            {g.items[0]?.vendorName && <span className="ml-1 font-normal">{g.items.every((i) => i.vendorName === g.items[0].vendorName) ? g.items[0].vendorName : "여러 거래처"}</span>}
          </h2>
          <ul className="divide-y rounded-xl border bg-card">
            {g.items.map((i) => {
              const n = qty.get(i.id) ?? 0;
              return (
                <li key={i.id} className={cn("flex items-center gap-2 px-3 py-2", n > 0 && "bg-emerald-50/70 dark:bg-emerald-950/30")}>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => setItem(i.id, n > 0 ? 0 : i.defaultQty)}
                    className="min-h-11 flex-1 text-left"
                    aria-pressed={n > 0}
                  >
                    <span className="text-base font-medium">{i.name}</span>
                    {i.unit && <span className="ml-1 text-sm text-muted-foreground">({i.unit})</span>}
                    <span className="block text-xs text-muted-foreground">
                      {i.unitPrice === null ? "단가 아직 모름" : `단가 ${i.unitPrice.toLocaleString("ko-KR")}원`}
                    </span>
                  </button>
                  {n > 0 ? (
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-lg"
                        className="size-11"
                        disabled={locked}
                        aria-label={`${i.name} 줄이기`}
                        onClick={() => setItem(i.id, stepDown(n, i))}
                      >
                        <Minus className="size-5" />
                      </Button>
                      <span className="min-w-16 text-center text-base font-semibold tabular-nums">{qtyLabel(n, i.unit) || "1"}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-lg"
                        className="size-11"
                        disabled={locked}
                        aria-label={`${i.name} 늘리기`}
                        onClick={() => setItem(i.id, stepUp(n, i))}
                      >
                        <Plus className="size-5" />
                      </Button>
                    </div>
                  ) : (
                    <Button type="button" variant="outline" className="h-11" disabled={locked} onClick={() => setItem(i.id, i.defaultQty)}>
                      담기
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {/* 아래 고정: 합계 + 완료 */}
      {!locked && (
        <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-xs text-muted-foreground">
                {selected.length}개 품목{est.unknown ? ` · 단가 모름 ${est.unknown}개` : ""}
              </p>
              <p className="text-xl font-bold tabular-nums">약 {formatKRW(est.total)}</p>
            </div>
            <Button type="button" className="h-12 min-w-32 text-base" disabled={pending || (selected.length === 0 && saved.size === 0)} onClick={submit}>
              {pending ? "저장 중…" : order.status === "submitted" && !dirty ? "완료됨 ✓" : "발주 완료"}
            </Button>
          </div>
          {canSendNow && (
            <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs underline underline-offset-2" disabled={pending} onClick={sendNow}>
              <Send className="size-3" aria-hidden /> 9시 전에 지금 바로 텔레그램 보내기 (관리자)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
