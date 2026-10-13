import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/dal";
import { canAccessStore, isManager } from "@/lib/auth/roles";
import { listAccessibleStores } from "@/lib/data/stores";
import { getCurrentOrder, listOrderItems } from "@/lib/data/orders";
import { PageHeader } from "@/components/page-header";
import { EmptyState, LoadingState } from "@/components/states";
import { cn } from "@/lib/utils";
import { OrderSheet } from "./order-sheet";

export const metadata: Metadata = { title: "발주" };

export default function OrdersPage({ searchParams }: PageProps<"/orders">) {
  return (
    <Suspense fallback={<LoadingState rows={8} />}>
      <Orders searchParams={searchParams} />
    </Suspense>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Orders({ searchParams }: { searchParams: PageProps<"/orders">["searchParams"] }) {
  const user = await requireUser();
  const sp = await searchParams;
  const stores = (await listAccessibleStores()).filter((s) => s.isActive && canAccessStore(user, s.id));
  if (!stores.length) return <EmptyState title="발주할 수 있는 지점이 없습니다">대표에게 소속 지점 지정을 요청하세요.</EmptyState>;
  const store = stores.find((s) => s.id === first(sp.store)) ?? stores[0];

  const [items, order] = await Promise.all([listOrderItems(store.id), getCurrentOrder(store.id)]);

  return (
    <div className="mx-auto max-w-2xl pb-32">
      <PageHeader title="발주" description="필요한 품목을 눌러 담고 [발주 완료]를 누르면 밤 9시에 텔레그램으로 가요." />

      {stores.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="지점">
          {stores.map((s) => (
            <Link
              key={s.id}
              href={`/orders?store=${s.id}`}
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

      {items.length === 0 ? (
        <EmptyState title="이 지점 품목표가 비어 있어요">대표·점장이 [품목 관리]에서 품목을 넣어 주세요.</EmptyState>
      ) : (
        <OrderSheet
          key={`${store.id}-${order.orderDate}-${order.status}-${order.submittedAt ?? ""}`}
          storeId={store.id}
          storeName={store.name}
          items={items}
          order={order}
          canSendNow={isManager(user.role)}
        />
      )}
    </div>
  );
}
