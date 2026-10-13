import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/dal";
import { canManageStore } from "@/lib/auth/roles";
import { listAccessibleStores } from "@/lib/data/stores";
import { activeVendors, listOrderItems } from "@/lib/data/orders";
import { groupByCategory, qtyLabel } from "@/lib/orders";
import { PageHeader } from "@/components/page-header";
import { EmptyState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ItemDialog } from "./item-dialog";
import { TelegramTestButton } from "./telegram-test-button";

export const metadata: Metadata = { title: "발주 품목 관리" };

export default function OrderItemsPage({ searchParams }: PageProps<"/admin/order-items">) {
  return (
    <Suspense fallback={<LoadingState rows={8} />}>
      <OrderItems searchParams={searchParams} />
    </Suspense>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function OrderItems({ searchParams }: { searchParams: PageProps<"/admin/order-items">["searchParams"] }) {
  const user = await requireRole(["owner", "hq_manager", "store_manager"]);
  const sp = await searchParams;
  const stores = (await listAccessibleStores()).filter((s) => s.isActive && canManageStore(user, s.id));
  if (!stores.length) return <EmptyState title="관리할 수 있는 지점이 없습니다" />;
  const store = stores.find((s) => s.id === first(sp.store)) ?? stores[0];

  const [items, vendors] = await Promise.all([listOrderItems(store.id, { includeInactive: true }), activeVendors()]);
  const groups = groupByCategory(items);
  const categories = groups.map((g) => g.category);
  const noPrice = items.filter((i) => i.isActive && i.unitPrice === null).length;
  const noVendor = items.filter((i) => i.isActive && !i.vendorId).length;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="발주 품목 관리"
        description="발주표에 나오는 품목·거래처·단가를 지점별로 관리해요. 단가는 입고 확인 때 바뀌면 자동으로 고쳐져요."
        actions={
          <>
            {user.role === "owner" && <TelegramTestButton />}
            <ItemDialog storeId={store.id} categories={categories} vendors={vendors} triggerLabel="품목 추가" />
          </>
        }
      />

      {stores.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="지점">
          {stores.map((s) => (
            <Link
              key={s.id}
              href={`/admin/order-items?store=${s.id}`}
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

      <p className="mb-4 text-sm text-muted-foreground">
        {items.length}개 품목 · 단가 모름 {noPrice}개{noVendor ? ` · 거래처 미정 ${noVendor}개` : ""} — 단가는 비워 둬도 첫 입고 확인 때 채워져요.
      </p>

      {groups.length === 0 ? (
        <EmptyState title="품목이 없어요">[품목 추가]로 넣어 주세요.</EmptyState>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.category} aria-labelledby={`oi-${g.category}`}>
              <h2 id={`oi-${g.category}`} className="mb-1 px-1 text-sm font-semibold text-muted-foreground">
                [{g.category}]
              </h2>
              <ul className="divide-y rounded-xl border bg-card">
                {g.items.map((i) => (
                  <li key={i.id} className={cn("flex items-center gap-3 px-3 py-2 text-sm", !i.isActive && "opacity-50")}>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {i.name} {i.unit && <span className="text-muted-foreground">({i.unit})</span>}
                        {!i.isActive && <Badge variant="outline" className="ml-1">숨김</Badge>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {i.vendorName ?? <span className="text-amber-700">거래처 미정</span>} · 평소 {qtyLabel(i.defaultQty, i.unit) || "1"}
                      </p>
                    </div>
                    <span className={cn("tabular-nums", i.unitPrice === null && "text-muted-foreground")}>
                      {i.unitPrice === null ? "단가 모름" : `${i.unitPrice.toLocaleString("ko-KR")}원`}
                    </span>
                    <ItemDialog storeId={store.id} item={i} categories={categories} vendors={vendors} triggerLabel="고치기" />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
