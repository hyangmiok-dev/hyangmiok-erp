import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/dal";
import { canViewStorePnl } from "@/lib/auth/roles";
import { listAccessibleStores } from "@/lib/data/stores";
import { listVendors } from "@/lib/data/vendors";
import { listLedgerPayments, listLedgerPurchases } from "@/lib/data/payables";
import { listSales } from "@/lib/data/sales";
import { listExpenses, listInventory } from "@/lib/data/expenses";
import { summarizePayables } from "@/lib/payables";
import { computeStorePnl, monthRange } from "@/lib/pnl";
import { formatKRW, seoulDateKey } from "@/lib/format";
import { addDays, shortDateKo } from "@/lib/period";
import { PageHeader } from "@/components/page-header";
import { EmptyState, LoadingState } from "@/components/states";
import { FoodCostPanel } from "@/components/food-cost/food-cost-panel";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PaymentDialog } from "./payment-dialog";

export const metadata: Metadata = { title: "거래처 미수" };

export default function PayablesPage({ searchParams }: PageProps<"/payables">) {
  return (
    <Suspense fallback={<LoadingState rows={8} />}>
      <Payables searchParams={searchParams} />
    </Suspense>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Payables({ searchParams }: { searchParams: PageProps<"/payables">["searchParams"] }) {
  const user = await requireRole(["owner", "hq_manager"]);
  const sp = await searchParams;
  const today = seoulDateKey();
  const month = today.slice(0, 7);

  const stores = (await listAccessibleStores()).filter((s) => s.isActive && canViewStorePnl(user, s.id));
  if (!stores.length) return <EmptyState title="볼 수 있는 지점이 없습니다" />;
  const store = stores.find((s) => s.id === first(sp.store)) ?? stores[0];

  const range = monthRange(month);
  const [vendors, { purchases }, payments, monthSales, monthExpenses, inventory] = await Promise.all([
    listVendors(),
    listLedgerPurchases(store.id),
    listLedgerPayments(store.id),
    listSales({ start: range.start, end: today }, [store.id]),
    listExpenses({ start: range.start, end: today }, [store.id]),
    listInventory([addDays(range.start, -1), range.end], [store.id]),
  ]);
  // 실시간 원가율: 이번 달 식재료 매입(외상 포함) − 냉장고 재고(대표 설정 %) ÷ 이번 달 실매출
  const foodCost = computeStorePnl({
    storeId: store.id,
    month,
    today,
    sales: monthSales,
    expenses: monthExpenses,
    inventory,
    stockReservePct: store.stockReservePct,
  });
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const storeVendorIds = vendors.filter((v) => v.isActive && v.storeIds.includes(store.id)).map((v) => v.id);

  const rows = summarizePayables({ vendorIds: storeVendorIds, purchases, payments, month })
    .filter((r) => vendorById.has(r.vendorId))
    .sort(
      (a, b) =>
        b.balance - a.balance || (vendorById.get(a.vendorId)!.sortOrder ?? 0) - (vendorById.get(b.vendorId)!.sortOrder ?? 0),
    );
  const totalBalance = rows.reduce((n, r) => n + r.balance, 0);
  const totalMonthCredit = rows.reduce((n, r) => n + r.monthCredit, 0);
  const totalMonthPaid = rows.reduce((n, r) => n + r.monthPayments, 0);
  const isOwner = user.role === "owner";
  const vendorOpts = rows.map((r) => ({ id: r.vendorId, name: vendorById.get(r.vendorId)!.name }));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="거래처 미수"
        description="외상으로 산 금액에서 결제한 금액을 뺀 '아직 갚을 돈'이에요. 미수 = 이월 미수 + 외상 매입 − 결제."
        actions={
          isOwner ? (
            <>
              <PaymentDialog
                storeId={store.id}
                storeName={store.name}
                vendors={vendorOpts}
                defaultKind="opening"
                today={today}
                triggerLabel="이월 미수 입력"
                triggerVariant="outline"
              />
              <PaymentDialog
                storeId={store.id}
                storeName={store.name}
                vendors={vendorOpts}
                today={today}
                triggerLabel="결제 입력"
              />
            </>
          ) : undefined
        }
      />

      {stores.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="지점">
          {stores.map((s) => (
            <Link
              key={s.id}
              href={`/payables?store=${s.id}`}
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

      <div className="mb-3">
        <FoodCostPanel pnl={foodCost} storeName={store.name} today={today} title="이번 달 원가율 (실시간)" canEdit={isOwner} />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">{store.name} 미수 합계</p>
          <p className={cn("mt-1 text-3xl font-bold tabular-nums", totalBalance > 0 && "text-amber-700")}>{formatKRW(totalBalance)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">이번 달 외상 매입</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{formatKRW(totalMonthCredit)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">이번 달 결제</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{formatKRW(totalMonthPaid)}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="이 지점과 연결된 거래처가 없습니다">거래처 관리에서 거래 지점을 체크하세요.</EmptyState>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {rows.map((r) => {
            const v = vendorById.get(r.vendorId)!;
            return (
              <li key={r.vendorId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {v.name}{" "}
                    {!v.onCredit && <span className="text-xs font-normal text-muted-foreground">(바로 결제 거래처)</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    이번 달 외상 {formatKRW(r.monthCredit)} · 결제 {formatKRW(r.monthPayments)}
                    {r.lastPaymentDate ? ` · 마지막 결제 ${shortDateKo(r.lastPaymentDate)}` : " · 결제 기록 없음"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">미수 잔액</p>
                  <p className={cn("text-lg font-bold tabular-nums", r.balance > 0 ? "text-amber-700" : r.balance < 0 && "text-emerald-700")}>
                    {formatKRW(r.balance)}
                  </p>
                  {r.balance < 0 && <p className="text-[11px] text-emerald-700">미리 낸 돈(선결제)</p>}
                </div>
                <Link
                  href={`/payables/${r.vendorId}?store=${store.id}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  원장 보기
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        외상 매입은 [지출 입력]에서 거래처를 고르고 &apos;외상&apos;에 체크하면 자동으로 더해져요. 처음 한 번은 지금 남아 있는 미수를 [이월 미수 입력]으로 넣어 주세요.
      </p>
    </div>
  );
}
