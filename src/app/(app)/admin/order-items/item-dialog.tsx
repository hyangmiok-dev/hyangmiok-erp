"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/form-fields";
import { fmtQty, type OrderItem } from "@/lib/orders";
import { saveOrderItemAction } from "./actions";

export function ItemDialog({
  storeId,
  item,
  categories,
  vendors,
  triggerLabel,
}: {
  storeId: string;
  item?: OrderItem;
  categories: string[];
  vendors: { id: string; name: string }[];
  triggerLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const s = (k: string) => String(fd.get(k) ?? "");
    startTransition(async () => {
      const r = await saveOrderItemAction({
        id: item?.id,
        storeId,
        category: s("category"),
        name: s("name"),
        unit: s("unit"),
        vendorId: s("vendorId"),
        unitPrice: s("unitPrice"),
        defaultQty: s("defaultQty"),
        step: s("step"),
        sortOrder: s("sortOrder"),
        isActive: fd.get("isActive") === "on",
      });
      if (r.ok) {
        toast.success(r.message);
        setOpen(false);
        router.refresh();
      } else toast.error(r.message ?? "저장하지 못했어요.", { duration: 8000 });
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={item ? "ghost" : "default"} size="sm" />}>{triggerLabel}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? `${item.name} 고치기` : "품목 추가"}</DialogTitle>
          <DialogDescription>단가를 바꾸면 변동 기록이 남고, 밤 9시 텔레그램에 같이 알려 드려요.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <datalist id="item-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <div className="grid grid-cols-2 gap-3">
            <Field label="분류" htmlFor="oi-cat">
              <Input id="oi-cat" name="category" list="item-categories" defaultValue={item?.category ?? ""} required className="h-10 text-base" />
            </Field>
            <Field label="거래처" htmlFor="oi-vendor">
              <NativeSelect id="oi-vendor" name="vendorId" defaultValue={item?.vendorId ?? ""}>
                <option value="">미정</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <Field label="품목 이름" htmlFor="oi-name">
              <Input id="oi-name" name="name" defaultValue={item?.name ?? ""} maxLength={40} required className="h-10 text-base" />
            </Field>
            <Field label="단위" htmlFor="oi-unit">
              <Input id="oi-unit" name="unit" defaultValue={item?.unit ?? ""} maxLength={10} placeholder="박스" className="h-10 text-base" />
            </Field>
          </div>
          <Field label="현재 단가 (원)" htmlFor="oi-price" hint="모르면 비워 두세요. 처음 입고 확인 때 채워져요.">
            <Input
              id="oi-price"
              name="unitPrice"
              inputMode="numeric"
              defaultValue={item?.unitPrice ?? ""}
              className="h-10 text-right text-base tabular-nums"
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="평소 수량" htmlFor="oi-dq">
              <Input id="oi-dq" name="defaultQty" inputMode="decimal" defaultValue={fmtQty(item?.defaultQty ?? 1)} className="h-10 text-right text-base" />
            </Field>
            <Field label="+/− 한 번에" htmlFor="oi-step">
              <Input id="oi-step" name="step" inputMode="decimal" defaultValue={fmtQty(item?.step ?? 1)} className="h-10 text-right text-base" />
            </Field>
            <Field label="순서" htmlFor="oi-sort">
              <Input id="oi-sort" name="sortOrder" inputMode="numeric" defaultValue={item?.sortOrder ?? ""} className="h-10 text-right text-base" />
            </Field>
          </div>
          <label className="flex min-h-10 items-center gap-2 text-base">
            <input type="checkbox" name="isActive" defaultChecked={item?.isActive ?? true} className="size-5" />
            발주표에 보이기 (끄면 숨김)
          </label>
          <Button type="submit" className="h-11 w-full text-base" disabled={pending}>
            {pending ? "저장 중…" : "저장"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
