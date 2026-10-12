"use client";

import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/form-fields";
import { formatKoreanWon } from "@/lib/format";
import type { ActionResult } from "@/lib/validation/users";
import { deletePaymentAction, savePaymentAction } from "./actions";

export interface PaymentValue {
  id: string;
  vendorId: string;
  date: string;
  kind: "payment" | "opening";
  amount: number;
  method: string | null;
  memo: string | null;
  updatedAt: string;
}

/** 결제 입력 / 이월 미수 입력 / 수정 창 */
export function PaymentDialog({
  storeId,
  storeName,
  vendors,
  fixedVendorId,
  defaultKind = "payment",
  today,
  payment,
  suggestedAmount,
  triggerLabel,
  triggerVariant = "default",
  triggerSize = "default",
}: {
  storeId: string;
  storeName: string;
  vendors: { id: string; name: string }[];
  fixedVendorId?: string;
  defaultKind?: "payment" | "opening";
  today: string;
  payment?: PaymentValue;
  /** 결제 금액 제안 (현재 미수 잔액) */
  suggestedAmount?: number;
  triggerLabel: string;
  triggerVariant?: "default" | "outline" | "ghost" | "secondary";
  triggerSize?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ActionResult>({ ok: false });
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<"payment" | "opening">(payment?.kind ?? defaultKind);
  const [amount, setAmount] = useState(payment ? String(payment.amount) : "");
  const fe = state.fieldErrors ?? {};
  const vendorId = payment?.vendorId ?? fixedVendorId;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await savePaymentAction(state, fd);
      setState(r);
      if (r.ok) {
        toast.success(r.message);
        setOpen(false);
        if (!payment) setAmount("");
      } else if (r.message) toast.error(r.message, { duration: 8000 });
    });
  }

  function onDelete() {
    if (!payment || !confirm("이 기록을 삭제할까요? (변경 이력에는 남습니다)")) return;
    startTransition(async () => {
      const r = await deletePaymentAction(payment.id);
      if (r.ok) {
        toast.success(r.message);
        setOpen(false);
      } else toast.error(r.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={triggerVariant} size={triggerSize} />}>{triggerLabel}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{payment ? "기록 수정" : kind === "opening" ? "이월 미수 입력" : "결제 입력"}</DialogTitle>
          <DialogDescription>
            {storeName} ·{" "}
            {kind === "opening"
              ? "이 프로그램을 쓰기 전부터 남아 있던 미수를 한 번 넣어 주세요. 미수가 그만큼 늘어나요."
              : "거래처에 돈을 보낸 기록이에요. 미수가 그만큼 줄어요."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          {payment && (
            <>
              <input type="hidden" name="id" value={payment.id} />
              <input type="hidden" name="expectedUpdatedAt" value={payment.updatedAt} />
            </>
          )}
          <input type="hidden" name="storeId" value={storeId} />
          <input type="hidden" name="kind" value={kind} />

          {!payment && (
            <div className="flex gap-2" role="radiogroup" aria-label="종류">
              {(["payment", "opening"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => setKind(k)}
                  className={`h-10 flex-1 rounded-full border text-sm ${kind === k ? "border-foreground bg-foreground text-background" : "bg-background"}`}
                >
                  {k === "payment" ? "결제 (미수 줄이기)" : "이월 미수 (처음 한 번)"}
                </button>
              ))}
            </div>
          )}

          {vendorId ? (
            <input type="hidden" name="vendorId" value={vendorId} />
          ) : (
            <Field label="거래처" htmlFor="p-vendor" error={fe.vendorId}>
              <NativeSelect id="p-vendor" name="vendorId" defaultValue="">
                <option value="" disabled>
                  거래처 고르기
                </option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label={kind === "opening" ? "기준 날짜" : "결제 날짜"} htmlFor="p-date" error={fe.paidDate}>
              <Input id="p-date" name="paidDate" type="date" max={today} defaultValue={payment?.date ?? today} className="h-10 text-base" />
            </Field>
            {kind === "payment" && (
              <Field label="결제 방법" htmlFor="p-method" error={fe.method}>
                <NativeSelect id="p-method" name="method" defaultValue={payment?.method ?? "transfer"}>
                  <option value="transfer">계좌이체</option>
                  <option value="card">카드</option>
                  <option value="cash">현금</option>
                  <option value="other">기타</option>
                </NativeSelect>
              </Field>
            )}
          </div>

          <Field label="금액" htmlFor="p-amount" error={fe.amount}>
            <div className="relative">
              <Input
                id="p-amount"
                name="amount"
                inputMode="numeric"
                autoComplete="off"
                value={amount ? Number(amount).toLocaleString("ko-KR") : ""}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "").slice(0, 10))}
                className="h-11 pr-8 text-right text-lg font-semibold tabular-nums"
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">원</span>
            </div>
            <p className="flex justify-between text-xs text-muted-foreground">
              <span>
                {kind === "payment" && !payment && suggestedAmount && suggestedAmount > 0 ? (
                  <button type="button" className="underline underline-offset-2" onClick={() => setAmount(String(suggestedAmount))}>
                    미수 전액 {suggestedAmount.toLocaleString("ko-KR")}원 넣기
                  </button>
                ) : null}
              </span>
              <span>{amount ? formatKoreanWon(Number(amount)) : " "}</span>
            </p>
          </Field>

          <Field label="메모 (선택)" htmlFor="p-memo" error={fe.memo}>
            <Input
              id="p-memo"
              name="memo"
              defaultValue={payment?.memo ?? ""}
              maxLength={200}
              placeholder={kind === "opening" ? "예: 9월말 거래처 미수 확인" : "예: 9월분 정산"}
              className="h-10 text-base"
            />
          </Field>

          <div className="flex gap-2">
            <Button type="submit" className="h-11 flex-1 text-base" disabled={pending}>
              {pending ? "저장 중…" : "저장"}
            </Button>
            {payment && (
              <Button type="button" variant="ghost" className="h-11 text-destructive" disabled={pending} onClick={onDelete}>
                삭제
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
