"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/form-fields";
import { formatKoreanWon } from "@/lib/format";
import { SECTION_LABEL, type Section } from "@/lib/pnl";
import type { ActionResult } from "@/lib/validation/users";
import { guessCategoryCode } from "@/lib/expense-hints";
import { cn } from "@/lib/utils";
import { saveExpenseAction } from "./actions";

export interface CategoryOption {
  id: string;
  code: string;
  name: string;
  section: Section;
  description: string | null;
}

export interface EditingExpense {
  id: string;
  storeId: string;
  date: string;
  categoryId: string;
  vendor: string | null;
  description: string | null;
  amount: number;
  basis: "actual" | "estimated";
  updatedAt: string;
}

const SECTIONS: Section[] = ["cogs", "labor", "opex", "excluded"];

export function ExpenseForm({
  stores,
  categories,
  vendors,
  defaultStoreId,
  defaultDate,
  today,
  editing,
  cancelHref,
}: {
  stores: { id: string; name: string }[];
  categories: CategoryOption[];
  vendors: string[];
  defaultStoreId: string;
  defaultDate: string;
  today: string;
  editing: EditingExpense | null;
  cancelHref: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<ActionResult>({ ok: false });
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState(editing ? String(editing.amount) : "");
  // 항목은 기본값 없이 직접 고르게 한다 (기본값 때문에 엉뚱한 항목으로 저장되는 실수 방지)
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? "");
  const [vendor, setVendor] = useState(editing?.vendor ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const fe = state.fieldErrors ?? {};
  const cat = categories.find((c) => c.id === categoryId);
  const guess = guessCategoryCode(`${vendor} ${description}`);
  const guessed = guess ? categories.find((c) => c.code === guess.code) : undefined;
  const mismatch = guessed && cat && guessed.id !== cat.id ? guessed : undefined;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (!categoryId) {
      setState({ ok: false, fieldErrors: { categoryId: "항목을 골라 주세요." } });
      return;
    }
    startTransition(async () => {
      const r = await saveExpenseAction(state, fd);
      setState(r);
      if (!r.ok) {
        if (r.message) toast.error(r.message, { duration: 8000 });
        return;
      }
      toast.success(r.message);
      // 수정이면 목록으로, 새 입력이면 금액만 비우고 다음 입력 준비 (같은 거래처 연속 입력이 많음)
      if (editing) router.push(cancelHref);
      else {
        setAmount("");
        setDescription("");
        (document.getElementById("vendor") as HTMLInputElement | null)?.focus();
      }
    });
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {editing && (
        <>
          <input type="hidden" name="id" value={editing.id} />
          <input type="hidden" name="expectedUpdatedAt" value={editing.updatedAt} />
        </>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="지점" htmlFor="storeId" error={fe.storeId}>
          {editing ? (
            <>
              <input type="hidden" name="storeId" value={editing.storeId} />
              <Input value={stores.find((s) => s.id === editing.storeId)?.name ?? ""} disabled className="h-10 text-base" />
            </>
          ) : (
            <NativeSelect id="storeId" name="storeId" defaultValue={defaultStoreId}>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label="날짜 (거래일)" htmlFor="expenseDate" error={fe.expenseDate}>
          <Input
            id="expenseDate"
            name="expenseDate"
            type="date"
            max={today}
            defaultValue={editing?.date ?? defaultDate}
            className="h-10 text-base"
          />
        </Field>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">항목 (하나 고르기)</legend>
        <input type="hidden" name="categoryId" value={categoryId} />
        <div className="space-y-2">
          {SECTIONS.map((s) => (
            <div key={s} className="flex flex-wrap items-center gap-1.5">
              <span className="w-24 shrink-0 text-xs text-muted-foreground">{SECTION_LABEL[s]}</span>
              {categories
                .filter((c) => c.section === s)
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={c.id === categoryId}
                    onClick={() => setCategoryId(c.id)}
                    className={cn(
                      "h-10 rounded-full border px-3.5 text-sm",
                      c.id === categoryId ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-muted",
                    )}
                  >
                    {c.name}
                  </button>
                ))}
            </div>
          ))}
        </div>
        {fe.categoryId && <p className="mt-1 text-xs text-destructive" role="alert">{fe.categoryId}</p>}
        {cat?.description && <p className="mt-1 text-xs text-muted-foreground">{cat.description}</p>}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="거래처 / 받는 사람" htmlFor="vendor" error={fe.vendor} hint="예: 청수상사, 한전, 건물주">
          <Input id="vendor" name="vendor" list="vendor-list" value={vendor} onChange={(e) => setVendor(e.target.value)} maxLength={60} autoComplete="off" className="h-10 text-base" />
          <datalist id="vendor-list">
            {vendors.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </Field>
        <Field label="금액 (부가세 포함)" htmlFor="amount" error={fe.amount}>
          <div className="relative">
            <Input
              id="amount"
              name="amount"
              inputMode="numeric"
              autoComplete="off"
              value={amount ? Number(amount).toLocaleString("ko-KR") : ""}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "").slice(0, 10))}
              className="h-10 pr-8 text-right text-base font-semibold tabular-nums"
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">원</span>
          </div>
          <p className="text-right text-xs text-muted-foreground">{amount ? formatKoreanWon(Number(amount)) : " "}</p>
        </Field>
      </div>

      <Field label="내용 (선택)" htmlFor="description" error={fe.description}>
        <Input
          id="description"
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={200}
          placeholder="예: 10/12 거래명세표, 9월분 전기요금"
          className="h-10 text-base"
        />
      </Field>

      <fieldset className="flex flex-wrap items-center gap-4 text-sm">
        <legend className="sr-only">금액 기준</legend>
        <label className="flex min-h-10 items-center gap-2">
          <input type="radio" name="basis" value="actual" defaultChecked={(editing?.basis ?? "actual") === "actual"} className="size-4" />
          실제 금액 (영수증·명세서 확인)
        </label>
        <label className="flex min-h-10 items-center gap-2">
          <input type="radio" name="basis" value="estimated" defaultChecked={editing?.basis === "estimated"} className="size-4" />
          추정 (아직 청구서 없음)
        </label>
      </fieldset>

      {mismatch && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
          <span>
            &apos;{guess!.word}&apos;이(가) 적혀 있는데 항목이 <b>{cat!.name}</b>입니다. <b>{mismatch.name}</b> 아닌가요?
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => setCategoryId(mismatch.id)}>
            {mismatch.name}(으)로 바꾸기
          </Button>
        </div>
      )}

      {cat?.section === "excluded" && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          이 항목은 기록만 되고 <b>영업이익 계산에는 들어가지 않습니다</b>.
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" className="h-11 flex-1 text-base sm:flex-none sm:px-10" disabled={pending}>
          {pending ? "저장 중…" : editing ? "수정 저장" : "저장하고 다음 입력"}
        </Button>
        {editing && (
          <Button type="button" variant="outline" className="h-11" onClick={() => router.push(cancelHref)}>
            취소
          </Button>
        )}
      </div>
    </form>
  );
}
