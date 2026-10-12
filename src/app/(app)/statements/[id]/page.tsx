import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CircleCheck } from "lucide-react";
import { requireRole } from "@/lib/auth/dal";
import { canManageStore } from "@/lib/auth/roles";
import { listAccessibleStores } from "@/lib/data/stores";
import { confirmedSameDay, getStatement, statementPhotoUrl, vendorOptionsForStore } from "@/lib/data/statements";
import { formatDateTimeKo, formatKRW, seoulDateKey } from "@/lib/format";
import { addDays, shortDateKo } from "@/lib/period";
import { draftFromAi, parseAiResult, STATUS_LABEL } from "@/lib/statements";
import { EmptyState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { PhotoViewer } from "./photo-viewer";
import { ReviewForm } from "./review-form";

export const metadata: Metadata = { title: "거래명세표 확인" };

export default function StatementPage(props: PageProps<"/statements/[id]">) {
  return (
    <Suspense fallback={<LoadingState rows={8} />}>
      <Statement {...props} />
    </Suspense>
  );
}

async function Statement({ params }: PageProps<"/statements/[id]">) {
  const user = await requireRole(["owner", "hq_manager", "store_manager"]);
  const { id } = await params;
  const s = await getStatement(id);
  if (!s || !canManageStore(user, s.storeId)) {
    return <EmptyState title="거래명세표를 찾을 수 없어요">이미 지워졌거나 볼 권한이 없어요.</EmptyState>;
  }
  const today = seoulDateKey();
  const ai = parseAiResult(s.aiResult);
  const draft = draftFromAi(ai, today);
  const [photoUrl, vendors, stores, duplicates] = await Promise.all([
    statementPhotoUrl(s.photoPath),
    vendorOptionsForStore(s.storeId),
    listAccessibleStores(),
    confirmedSameDay({ storeId: s.storeId, vendorId: s.vendorId, date: s.statementDate ?? draft.date, excludeId: s.id }),
  ]);
  const storeName = stores.find((x) => x.id === s.storeId)?.name ?? "";
  const vendor = vendors.find((v) => v.id === s.vendorId);
  const open = s.status === "uploaded" || s.status === "read" || s.status === "failed";

  return (
    <div className="mx-auto max-w-6xl">
      <Link href={`/statements?store=${s.storeId}`} className={buttonVariants({ variant: "ghost", size: "sm", className: "mb-2" })}>
        <ArrowLeft className="size-4" /> 거래명세표 목록
      </Link>
      <div className="mb-4">
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold lg:text-2xl">
          {s.vendorName} 거래명세표 <Badge variant="outline">{STATUS_LABEL[s.status]}</Badge>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {storeName} · 올림 {formatDateTimeKo(s.createdAt)}
          {s.createdByName ? ` (${s.createdByName})` : ""}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="lg:sticky lg:top-4">
          <PhotoViewer url={photoUrl} />
        </div>

        {open ? (
          <ReviewForm
            key={`${s.status}-${s.aiAttempts}`}
            statementId={s.id}
            storeId={s.storeId}
            vendorName={s.vendorName}
            vendorOnCredit={vendor?.onCredit ?? true}
            draft={draft}
            status={s.status as "uploaded" | "read" | "failed"}
            aiError={s.aiError}
            aiAttempts={s.aiAttempts}
            today={today}
            minDate={user.role === "owner" ? undefined : addDays(today, -31)}
            duplicates={duplicates}
          />
        ) : (
          <div className="space-y-3 rounded-xl border bg-card p-4">
            {s.status === "confirmed" ? (
              <>
                <p className="flex items-center gap-2 text-lg font-semibold text-emerald-800">
                  <CircleCheck className="size-5" aria-hidden /> 확정됨
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">거래 날짜</dt>
                  <dd>{s.statementDate ? shortDateKo(s.statementDate) : "-"}</dd>
                  <dt className="text-muted-foreground">확정 금액</dt>
                  <dd className="font-semibold tabular-nums">{formatKRW(s.confirmedTotal)}</dd>
                  {s.statementBalance !== null && (
                    <>
                      <dt className="text-muted-foreground">명세표 잔액</dt>
                      <dd className="tabular-nums">{formatKRW(s.statementBalance)}</dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">확정한 사람</dt>
                  <dd>
                    {s.confirmedByName ?? "-"} {s.confirmedAt ? `· ${formatDateTimeKo(s.confirmedAt)}` : ""}
                  </dd>
                  {s.memo && (
                    <>
                      <dt className="text-muted-foreground">메모</dt>
                      <dd>{s.memo}</dd>
                    </>
                  )}
                </dl>
                {user.role === "owner" && s.expenseId && s.statementDate && (
                  <Link
                    href={`/expenses?store=${s.storeId}&month=${s.statementDate.slice(0, 7)}&edit=${s.expenseId}`}
                    className={buttonVariants({ variant: "outline" })}
                  >
                    지출에서 보기·고치기
                  </Link>
                )}
                {user.role === "owner" && !s.expenseId && (
                  <p className="text-sm text-amber-700">이 명세표로 만든 지출이 지워졌어요.</p>
                )}
              </>
            ) : (
              <>
                <p className="text-lg font-semibold text-muted-foreground">버린 거래명세표</p>
                {s.memo && <p className="text-sm">이유: {s.memo}</p>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
