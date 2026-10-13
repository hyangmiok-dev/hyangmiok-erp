import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/dal";
import { canManageStore } from "@/lib/auth/roles";
import { listAccessibleStores } from "@/lib/data/stores";
import { deliveryItems, recentDeliveries, vendorOptionsForStore } from "@/lib/data/deliveries";
import { formatKRW, seoulDateKey } from "@/lib/format";
import { addDays, shortDateKo } from "@/lib/period";
import { PageHeader } from "@/components/page-header";
import { EmptyState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { QuickDelivery } from "./quick-delivery";
import { CancelDeliveryButton } from "./cancel-button";

export const metadata: Metadata = { title: "입고 입력" };

export default function DeliveriesPage({ searchParams }: PageProps<"/deliveries">) {
  return (
    <Suspense fallback={<LoadingState rows={6} />}>
      <Deliveries searchParams={searchParams} />
    </Suspense>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Deliveries({ searchParams }: { searchParams: PageProps<"/deliveries">["searchParams"] }) {
  const user = await requireRole(["owner", "hq_manager", "store_manager"]);
  const sp = await searchParams;
  const today = seoulDateKey();
  const stores = (await listAccessibleStores()).filter((s) => s.isActive && canManageStore(user, s.id));
  if (!stores.length) return <EmptyState title="입고를 입력할 수 있는 지점이 없습니다">대표에게 소속 지점 지정을 요청하세요.</EmptyState>;
  const store = stores.find((s) => s.id === first(sp.store)) ?? stores[0];

  const [vendors, items, recent] = await Promise.all([
    vendorOptionsForStore(store.id),
    deliveryItems(store.id),
    recentDeliveries(store.id),
  ]);

  return (
    <div className="mx-auto max-w-2xl pb-40">
      <PageHeader title="입고 입력" description="거래처를 누르면 전에 받은 품목이 나와요. 받은 수량만 누르고 [저장]하면 끝." />

      {stores.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="지점">
          {stores.map((s) => (
            <Link
              key={s.id}
              href={`/deliveries?store=${s.id}`}
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

      {vendors.length === 0 ? (
        <EmptyState title="고를 수 있는 거래처가 없어요">대표에게 거래처 관리에서 거래처를 확인해 달라고 하세요.</EmptyState>
      ) : (
        <QuickDelivery
          key={store.id}
          storeId={store.id}
          vendors={vendors}
          itemsByVendor={items}
          today={today}
          minDate={user.role === "owner" ? undefined : addDays(today, -7)}
        />
      )}

      <section aria-labelledby="recent-h" className="mt-10">
        <h2 id="recent-h" className="mb-2 text-sm font-semibold text-muted-foreground">
          최근 입고 (3일) · {store.name}
        </h2>
        {recent.length === 0 ? (
          <EmptyState title="최근 3일 동안 입력한 입고가 없어요" />
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {recent.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {d.vendorName} {d.onCredit && <Badge className="bg-amber-100 text-amber-900">외상</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {shortDateKo(d.date)}
                    {d.firstItem ? ` · ${d.firstItem}${d.itemCount > 1 ? ` 외 ${d.itemCount - 1}개` : ""}` : ""}
                    {d.createdByName ? ` · ${d.createdByName}` : ""}
                  </p>
                </div>
                <span className="font-semibold tabular-nums">{formatKRW(d.amount)}</span>
                {d.canCancel && <CancelDeliveryButton id={d.id} label={`${d.vendorName} ${formatKRW(d.amount)}`} />}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          잘못 넣었으면 그날 안에 본인이 [취소]하고 다시 넣으세요. 지난 것은 대표가 [지출 입력]에서 고쳐요.
        </p>
      </section>
    </div>
  );
}
