"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cancelDeliveryAction } from "./actions";

export function CancelDeliveryButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-destructive"
      disabled={pending}
      onClick={() => {
        if (!confirm(`${label} 입고를 취소할까요? (지출과 거래처 미수에서 빠져요)`)) return;
        startTransition(async () => {
          const r = await cancelDeliveryAction(id);
          if (r.ok) {
            toast.success(r.message);
            router.refresh();
          } else toast.error(r.message);
        });
      }}
    >
      취소
    </Button>
  );
}
