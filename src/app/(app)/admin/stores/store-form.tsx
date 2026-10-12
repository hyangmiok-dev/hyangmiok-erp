"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-fields";
import { WEEKDAY_KO } from "@/lib/period";
import { keepFormOnSubmit } from "@/lib/use-keep-form";
import type { BusinessHours } from "@/lib/validation/stores";
import type { ActionResult } from "@/lib/validation/users";
import { updateStoreAction } from "./actions";

export interface EditableStore {
  id: string;
  code: string;
  name: string;
  address: string | null;
  seatCount: number | null;
  areaPyeong: number | null;
  businessHours: BusinessHours | null;
  notes: string | null;
  isActive: boolean;
}

export function StoreForm({ store }: { store: EditableStore }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(updateStoreAction, { ok: false });
  const fe = state.fieldErrors ?? {};
  const h = store.businessHours ?? {};

  useEffect(() => {
    if (!state.message) return;
    if (state.ok) toast.success(state.message);
    else toast.error(state.message);
  }, [state]);

  const time = (name: keyof BusinessHours, label: string) => (
    <Input
      name={name}
      type="time"
      aria-label={label}
      defaultValue={(h[name] as string | null | undefined) ?? ""}
      className="h-10 text-base"
    />
  );

  return (
    <form onSubmit={keepFormOnSubmit(action)} className="space-y-4">
      <input type="hidden" name="storeId" value={store.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="지점 이름" htmlFor={`name-${store.id}`} error={fe.name}>
          <Input id={`name-${store.id}`} name="name" defaultValue={store.name} maxLength={50} className="h-10 text-base" />
        </Field>
        <Field label="지점 코드" hint="CSV 업로드에 사용 (변경 불가)">
          <Input value={store.code} disabled className="h-10 text-base" />
        </Field>
      </div>
      <Field label="주소" htmlFor={`addr-${store.id}`} error={fe.address} hint="확인된 주소만 입력하세요. 모르면 비워두세요.">
        <Input id={`addr-${store.id}`} name="address" defaultValue={store.address ?? ""} maxLength={200} className="h-10 text-base" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="좌석 수" htmlFor={`seat-${store.id}`} error={fe.seatCount} hint="좌석당 매출 계산에 사용">
          <Input
            id={`seat-${store.id}`}
            name="seatCount"
            inputMode="numeric"
            defaultValue={store.seatCount ?? ""}
            placeholder="미확인"
            className="h-10 text-base"
          />
        </Field>
        <Field label="면적 (평)" htmlFor={`area-${store.id}`} error={fe.areaPyeong}>
          <Input
            id={`area-${store.id}`}
            name="areaPyeong"
            inputMode="decimal"
            defaultValue={store.areaPyeong ?? ""}
            placeholder="미확인"
            className="h-10 text-base"
          />
        </Field>
      </div>

      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">운영시간</legend>
        <Field label="영업" error={fe.open}>
          <div className="flex items-center gap-2">
            {time("open", "영업 시작")}
            <span>~</span>
            {time("close", "영업 종료")}
          </div>
        </Field>
        <Field label="브레이크 타임 (없으면 비워두기)" error={fe.breakStart}>
          <div className="flex items-center gap-2">
            {time("breakStart", "브레이크 시작")}
            <span>~</span>
            {time("breakEnd", "브레이크 종료")}
          </div>
        </Field>
        <Field label="정기 휴무 요일">
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_KO.map((d, i) => (
              <label key={d} className="flex min-h-10 items-center gap-1.5 rounded-md border px-3 text-sm">
                <input
                  type="checkbox"
                  name="closedWeekdays"
                  value={i}
                  defaultChecked={h.closedWeekdays?.includes(i)}
                  className="size-4"
                />
                {d}
              </label>
            ))}
          </div>
        </Field>
      </fieldset>

      <Field label="메모" htmlFor={`notes-${store.id}`} error={fe.notes}>
        <Input id={`notes-${store.id}`} name="notes" defaultValue={store.notes ?? ""} maxLength={1000} className="h-10 text-base" />
      </Field>
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={store.isActive} className="size-5" />
        운영 중 (해제하면 매출 입력 목록에서 빠집니다. 기록은 남습니다)
      </label>
      <Button type="submit" className="h-11 w-full text-base sm:w-auto sm:px-8" disabled={pending}>
        {pending ? "저장 중…" : "저장"}
      </Button>
    </form>
  );
}
