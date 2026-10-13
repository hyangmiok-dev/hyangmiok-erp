import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/dal";
import { canAccessStore } from "@/lib/auth/roles";
import { listAccessibleStores } from "@/lib/data/stores";
import { activeVendors, listDoneReceipts, listReceivable } from "@/lib/data/orders";
import { formatDateTimeKo, formatKRW } from "@/lib/format";
import { shortDateKo } from "@/lib/period";
import { PageHeader } from "@/components/page-header";
import { EmptyState, LoadingState } from "@/components/states";
import { cn } from "@/lib/utils";
import { ReceiveCard } from "./receive-card";

export const metadata: Metadata = { title: "입고 확인" };

export default function ReceivingPage({ searchParams }: PageProps<"/receiving">) {
  return (
    <Suspense fallback={<LoadingState rows={8} />}>
      <Receiving searchParams={searchParams} />
    </Suspense>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Receiving({ searchParams }: { searchParams: PageProps<"/receiving">["searchParams"] }) {
  const user = await requireUser();
  const sp = await searchParams;
  const stores = (await listAccessibleStores()).filter((s) => s.isActive && canAccessStore(user, s.id));
  if (!stores.length) return <EmptyState title="입고를 확인할 수 있는 지점이 없습니다" />;
  const store = stores.find((s) => s.id === first(sp.store)) ?? stores[0];

  const [groups, done, vendors] = await Promise.all([listReceivable(store.id), listDoneReceipts(store.id), activeVendors()]);

  return (
    <div className="mx-auto max-w-2xl pb-10">
      <PageHeader
        title="입고 확인"
        description="종이 거래명세표를 보면서 줄마다 '금액'만 비교하세요. 같으면 [같음], 다르면 [다름]을 눌러 종이에 적힌 수량·단가를 적어요."
      />

      {stores.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="지점">
          {stores.map((s) => (
            <Link
              key={s.id}
              href={`/receiving?store=${s.id}`}
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

      {groups.length === 0 ? (
        <EmptyState title="확인할 입고가 없어요">어제 밤 9시에 보낸 발주가 여기에 나와요.</EmptyState>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <ReceiveCard key={`${g.orderId}-${g.vendorId ?? "none"}`} group={g} vendors={vendors} />
          ))}
        </div>
      )}

      <section aria-labelledby="done-h" className="mt-10">
        <h2 id="done-h" className="mb-2 text-sm font-semibold text-muted-foreground">
          최근 입고 완료 (3일)
        </h2>
        {done.length === 0 ? (
          <EmptyState title="최근 완료한 입고가 없어요" />
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {done.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{d.vendorName}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.orderDate ? `${shortDateKo(d.orderDate)} 발주 · ` : ""}
                    {formatDateTimeKo(d.completedAt)}
                    {d.completedByName ? ` · ${d.completedByName}` : ""}
                    {d.memo ? ` · ${d.memo}` : ""}
                  </p>
                </div>
                <span className="text-right font-semibold tabular-nums">
                  {formatKRW(d.total)}
                  {d.receiptTotal !== null && d.receiptTotal !== d.total && (
                    <span className="block text-[11px] font-normal text-amber-700">영수증 {formatKRW(d.receiptTotal)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
