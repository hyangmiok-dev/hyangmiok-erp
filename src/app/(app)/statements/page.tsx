import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Camera, ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth/dal";
import { canManageStore } from "@/lib/auth/roles";
import { listAccessibleStores } from "@/lib/data/stores";
import { listStatements, photoBytesTotal, type StatementRow } from "@/lib/data/statements";
import { formatDateTimeKo, formatKRW } from "@/lib/format";
import { shortDateKo } from "@/lib/period";
import { parseAiResult, STATUS_LABEL, STORAGE_LIMIT_BYTES } from "@/lib/statements";
import { PageHeader } from "@/components/page-header";
import { EmptyState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "거래명세표" };

export default function StatementsPage({ searchParams }: PageProps<"/statements">) {
  return (
    <Suspense fallback={<LoadingState rows={6} />}>
      <Statements searchParams={searchParams} />
    </Suspense>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const STATUS_STYLE: Record<StatementRow["status"], string> = {
  uploaded: "bg-sky-100 text-sky-900",
  read: "bg-amber-100 text-amber-900",
  failed: "bg-amber-100 text-amber-900",
  confirmed: "bg-emerald-100 text-emerald-900",
  discarded: "bg-muted text-muted-foreground",
};

function amountOf(s: StatementRow): number | null {
  if (s.confirmedTotal !== null) return s.confirmedTotal;
  if (s.statementTotal !== null) return s.statementTotal;
  return parseAiResult(s.aiResult)?.total ?? null;
}

function Row({ s }: { s: StatementRow }) {
  const amount = amountOf(s);
  return (
    <li>
      <Link href={`/statements/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {s.vendorName}
            <Badge className={STATUS_STYLE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
          </p>
          <p className="text-xs text-muted-foreground">
            {s.statementDate ? `${shortDateKo(s.statementDate)} 거래 · ` : ""}
            올림 {formatDateTimeKo(s.createdAt)}
            {s.createdByName ? ` (${s.createdByName})` : ""}
          </p>
        </div>
        <span className="text-right font-semibold tabular-nums">{amount === null ? "" : formatKRW(amount)}</span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}

async function Statements({ searchParams }: { searchParams: PageProps<"/statements">["searchParams"] }) {
  const user = await requireRole(["owner", "hq_manager", "store_manager"]);
  const sp = await searchParams;
  const stores = (await listAccessibleStores()).filter((s) => s.isActive && canManageStore(user, s.id));
  if (!stores.length) return <EmptyState title="거래명세표를 올릴 수 있는 지점이 없습니다">대표에게 소속 지점 지정을 요청하세요.</EmptyState>;
  const store = stores.find((s) => s.id === first(sp.store)) ?? stores[0];

  const [rows, usedBytes] = await Promise.all([
    listStatements(store.id),
    user.role === "owner" ? photoBytesTotal() : Promise.resolve(null),
  ]);
  const pending = rows.filter((r) => r.status === "uploaded" || r.status === "read" || r.status === "failed");
  const done = rows.filter((r) => r.status === "confirmed" || r.status === "discarded");

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="거래명세표"
        description="거래처를 고르고 거래명세표를 찍어 올리면 AI가 품목·수량·단가·금액을 읽어요. 올린 사람이 사진과 비교해 확인한 뒤 [확정]하면 지출(외상이면 거래처 미수)에 들어가요."
      />

      {stores.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="지점">
          {stores.map((s) => (
            <Link
              key={s.id}
              href={`/statements?store=${s.id}`}
              className={cn(
                "flex h-10 items-center rounded-full border px-4 text-sm",
                s.id === store.id ? "border-foreground bg-foreground text-background" : "bg-background",
              )}
            >
              {s.name.replace("향미옥 ", "")}
            </Link>
          ))}
        </div>
      )}

      <Link
        href={`/statements/new?store=${store.id}`}
        className={buttonVariants({ size: "lg", className: "mb-6 h-14 w-full text-lg" })}
      >
        <Camera className="size-6" /> {store.name.replace("향미옥 ", "")} 거래명세표 사진 올리기
      </Link>

      <section aria-labelledby="pending-h" className="mb-8">
        <h2 id="pending-h" className="mb-2 text-sm font-semibold text-muted-foreground">
          확인 기다리는 것 ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <EmptyState title="확인할 거래명세표가 없어요" />
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {pending.map((s) => (
              <Row key={s.id} s={s} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="done-h" className="mb-6">
        <h2 id="done-h" className="mb-2 text-sm font-semibold text-muted-foreground">
          최근 처리한 것
        </h2>
        {done.length === 0 ? (
          <EmptyState title="아직 확정한 거래명세표가 없어요" />
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {done.map((s) => (
              <Row key={s.id} s={s} />
            ))}
          </ul>
        )}
      </section>

      {usedBytes !== null && (
        <p className={cn("text-xs text-muted-foreground", usedBytes > STORAGE_LIMIT_BYTES * 0.8 && "font-semibold text-amber-700")}>
          사진 보관 용량: {(usedBytes / 1024 / 1024).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}MB / 무료 1GB
          {usedBytes > STORAGE_LIMIT_BYTES * 0.8 && " — 거의 찼어요. 오래된 사진 정리가 필요해요."}
        </p>
      )}
    </div>
  );
}
