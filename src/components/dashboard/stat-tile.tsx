import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 큰 숫자 카드. 값이 없으면 회색 '미입력' */
export function StatTile({
  label,
  value,
  sub,
  muted,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  muted?: boolean;
  tone?: "up" | "down";
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-bold tracking-tight lg:text-3xl",
          muted && "text-muted-foreground",
          tone === "up" && "text-emerald-700",
          tone === "down" && "text-red-700",
        )}
      >
        {value}
      </p>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
