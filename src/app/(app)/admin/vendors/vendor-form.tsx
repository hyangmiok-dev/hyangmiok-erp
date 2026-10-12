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
import { SECTION_LABEL, type Section } from "@/lib/pnl";
import type { ActionResult } from "@/lib/validation/users";
import { deleteVendorAction, saveVendorAction } from "./actions";

export interface VendorFormValue {
  id: string;
  name: string;
  items: string | null;
  defaultCategoryId: string | null;
  contactName: string | null;
  phone: string | null;
  memo: string | null;
  isActive: boolean;
  storeIds: string[];
}

export interface CategoryOpt {
  id: string;
  name: string;
  section: Section;
}

const SECTIONS: Section[] = ["cogs", "labor", "opex", "excluded"];

export function VendorDialog({
  vendor,
  stores,
  categories,
  defaultCategoryId,
}: {
  vendor: VendorFormValue | null;
  stores: { id: string; name: string }[];
  categories: CategoryOpt[];
  defaultCategoryId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ActionResult>({ ok: false });
  const [pending, startTransition] = useTransition();
  const fe = state.fieldErrors ?? {};

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await saveVendorAction(state, fd);
      setState(r);
      if (r.ok) {
        toast.success(r.message);
        setOpen(false);
      } else if (r.message) toast.error(r.message, { duration: 8000 });
    });
  }

  function onDelete() {
    if (!vendor) return;
    if (!confirm(`'${vendor.name}' 거래처를 삭제할까요?\n지난 지출 기록은 그대로 남고, 거래처 연결만 끊어집니다.\n(잠시 안 쓰는 거래처라면 삭제 대신 '거래 중' 체크를 해제하세요)`)) return;
    startTransition(async () => {
      const r = await deleteVendorAction(vendor.id);
      if (r.ok) {
        toast.success(r.message);
        setOpen(false);
      } else toast.error(r.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={vendor ? <Button variant="outline" size="sm" /> : <Button />}>
        {vendor ? "수정" : "새 거래처"}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{vendor ? `${vendor.name} 수정` : "새 거래처"}</DialogTitle>
          <DialogDescription>
            모르는 칸은 비워 두세요. 거래 지점을 체크하면 지출 입력 화면에서 버튼으로 바로 고를 수 있어요.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          {vendor && <input type="hidden" name="id" value={vendor.id} />}
          <Field label="거래처 이름" htmlFor="v-name" error={fe.name}>
            <Input id="v-name" name="name" defaultValue={vendor?.name ?? ""} maxLength={60} className="h-10 text-base" />
          </Field>
          <Field label="주요 품목" htmlFor="v-items" error={fe.items} hint="예: 육류·소스, 야채, 쌀국수 생면, 주류">
            <Input id="v-items" name="items" defaultValue={vendor?.items ?? ""} maxLength={200} className="h-10 text-base" />
          </Field>
          <Field label="기본 지출 항목" htmlFor="v-cat" error={fe.defaultCategoryId} hint="이 거래처를 고르면 항목이 자동으로 선택돼요">
            <NativeSelect id="v-cat" name="defaultCategoryId" defaultValue={vendor ? (vendor.defaultCategoryId ?? "") : (defaultCategoryId ?? "")}>
              <option value="">(정하지 않음)</option>
              {SECTIONS.map((s) => (
                <optgroup key={s} label={SECTION_LABEL[s]}>
                  {categories
                    .filter((c) => c.section === s)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </NativeSelect>
          </Field>
          <Field label="거래 지점" error={fe.storeIds}>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {stores.map((s) => (
                <label key={s.id} className="flex min-h-10 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="storeIds"
                    value={s.id}
                    defaultChecked={vendor?.storeIds.includes(s.id)}
                    className="size-5"
                  />
                  {s.name}
                </label>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="담당자" htmlFor="v-contact" error={fe.contactName}>
              <Input id="v-contact" name="contactName" defaultValue={vendor?.contactName ?? ""} maxLength={30} className="h-10 text-base" />
            </Field>
            <Field label="전화번호" htmlFor="v-phone" error={fe.phone}>
              <Input
                id="v-phone"
                name="phone"
                type="tel"
                inputMode="tel"
                defaultValue={vendor?.phone ?? ""}
                maxLength={30}
                className="h-10 text-base"
              />
            </Field>
          </div>
          <Field label="메모" htmlFor="v-memo" error={fe.memo} hint="결제일, 주문 방법, 계좌 등">
            <textarea
              id="v-memo"
              name="memo"
              defaultValue={vendor?.memo ?? ""}
              maxLength={500}
              rows={3}
              className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </Field>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={vendor?.isActive ?? true} className="size-5" />
            거래 중 (해제하면 지출 입력 버튼 목록에서 빠져요. 기록은 남아요)
          </label>
          <div className="flex gap-2">
            <Button type="submit" className="h-11 flex-1 text-base" disabled={pending}>
              {pending ? "저장 중…" : "저장"}
            </Button>
            {vendor && (
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
