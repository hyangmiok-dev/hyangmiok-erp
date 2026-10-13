"use client";

import { useTransition } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendTelegramTestAction } from "../../orders/actions";

export function TelegramTestButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await sendTelegramTestAction();
          if (r.ok) toast.success(r.message);
          else toast.error(r.message ?? "보내지 못했어요.", { duration: 8000 });
        })
      }
    >
      <Send className="size-4" /> 텔레그램 시험 전송
    </Button>
  );
}
