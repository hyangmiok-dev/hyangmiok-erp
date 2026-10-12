"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { copyRecurringAction, deleteExpenseAction } from "./actions";

export function DeleteExpenseButton({ id, label }: { id: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      className="text-destructive"
      onClick={() => {
        if (!confirm(`${label}\n이 지출을 삭제할까요? (변경 이력에는 남습니다)`)) return;
        start(async () => {
          const r = await deleteExpenseAction(id);
          if (r.ok) toast.success(r.message);
          else toast.error(r.message);
        });
      }}
    >
      삭제
    </Button>
  );
}

export function CopyRecurringButton({ storeId, month, storeName }: { storeId: string; month: string; storeName: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!confirm(`${storeName}: 지난달의 인건비·임대료·관리비 등 고정비를 이번 달에 '추정'으로 복사할까요?\n(이미 이번 달에 입력된 항목은 건너뜁니다)`)) return;
        start(async () => {
          const r = await copyRecurringAction(storeId, month);
          if (r.ok) toast.success(r.message, { duration: 8000 });
          else toast.error(r.message);
        });
      }}
    >
      {pending ? "복사 중…" : "지난달 고정비 불러오기"}
    </Button>
  );
}
