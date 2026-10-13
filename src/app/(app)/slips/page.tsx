import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/dal";
import { canAccessStore, canViewStorePnl } from "@/lib/auth/roles";
import { listAccessibleStores, type StoreRow } from "@/lib/data/stores";
import { slipDays, slipSheet } from "@/lib/data/slips";
import { listLedgerPayments, listLedgerPurchases } from "@/lib/data/payables";
import { listSales } from "@/lib/data/sales";
import { listExpenses, listInventory } from "@/lib/data/expenses";
import { summarizePayables } from "@/lib/payables";
import { computeStorePnl, monthRange } from "@/lib/pnl";
import { seoulDateKey } from "@/lib/format";
import { addDays, type DateKey } from "@/lib/period";
import { earliestSlipDate, pickSlipDate } from "@/lib/slips";
import { PageHeader } from "@/components/page-header";
import { EmptyState, LoadingState } from "@/components/states";
import { FoodCostLine } from "@/components/food-cost/food-cost-panel";
import { cn } from "@/lib/utils";
import { SlipSheet } from "./slip-sheet";

export const metadata: Metadata = { title: "전표 입력" };

export default function SlipsPage({ searchParams }: PageProps<"/slips">) {
  return (
    <Suspense fallback={<LoadingState rows={10} />}>
      <Slips searchParams={searchParams} />
    </Suspense>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** 대표·본사 관리자만: 거래처별 미수 잔액 + 이번 달 원가율 */
async function loadMoney(store: StoreRow, today: DateKey) {
  const month = today.slice(0, 7);
  const range = monthRange(month);
  const [{ purchases }, payments, monthSales, monthExpenses, inventory] = await Promise.all([
    listLedgerPurchases(store.id),
    listLedgerPayments(store.id),
    listSales({ start: range.start, end: today }, [store.id]),
    listExpenses({ start: range.start, end: today }, [store.id]),
    listInventory([addDays(range.start, -1), range.end], [store.id]),
  ]);
  const vendorIds = [...new Set(purchases.map((p) => p.vendorId).concat(payments.map((p) => p.vendorId)))];
  const balances = Object.fromEntries(
    summarizePayables({ vendorIds, purchases, payments, month }).map((s) => [s.vendorId, s.balance]),
  );
  const foodCost = computeStorePnl({
    storeId: store.id,
    month,
    today,
    sales: monthSales,
    expenses: monthExpenses,
    inventory,
    stockReservePct: store.stockReservePct,
  });
  return { balances, foodCost };
}

async function Slips({ searchParams }: { searchParams: PageProps<"/slips">["searchParams"] }) {
  const user = await requireUser();
  const sp = await searchParams;
  const today = seoulDateKey();
  const isOwner = user.role === "owner";
  const stores = (await listAccessibleStores()).filter((s) => s.isActive && canAccessStore(user, s.id));
  if (!stores.length) return <EmptyState title="전표를 입력할 수 있는 지점이 없습니다">대표에게 소속 지점 지정을 요청하세요.</EmptyState>;
  const store = stores.find((s) => s.id === first(sp.store)) ?? stores[0];
  const date = pickSlipDate(first(sp.date), today, isOwner);
  const seeMoney = canViewStorePnl(user, store.id);

  const [rows, days, money] = await Promise.all([
    slipSheet(store.id, date),
    slipDays(store.id),
    seeMoney ? loadMoney(store, today) : Promise.resolve(null),
  ]);
  // 저장 후 새로 받은 값으로 칸을 다시 채우기 위한 열쇠 (금액·적은 시각이 바뀌면 새로 그림)
  const sheetKey = `${store.id}:${date}:${rows.map((r) => `${r.amount ?? ""}@${r.enteredAt ?? ""}`).join("|")}`;

  return (
    <div className="mx-auto max-w-2xl pb-10">
      <PageHeader
        title="전표 입력"
        description="아침에 전표(거래명세표)가 오면 그 거래처 칸에 맨 아래 총금액만 적고 [저장]. 외상 거래처는 미수에 쌓여요."
      />

      {stores.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="지점">
          {stores.map((s) => (
            <Link
              key={s.id}
              href={`/slips?store=${s.id}&date=${date}`}
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

      {money && (
        <div className="mb-4">
          <FoodCostLine pnl={money.foodCost} storeName={store.name} title="이번 달 원가율" canEdit={isOwner} />
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState title="이 지점과 거래하는 거래처가 없어요">대표에게 [거래처 관리]에서 거래 지점을 체크해 달라고 하세요.</EmptyState>
      ) : (
        <SlipSheet
          key={sheetKey}
          storeId={store.id}
          date={date}
          today={today}
          minDate={earliestSlipDate(today, isOwner)}
          rows={rows}
          balances={money?.balances ?? null}
          days={days}
        />
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        잘못 적었으면 금액을 고쳐서 다시 [저장], 지우려면 칸을 비우고 [저장]. 대표 외에는 오늘부터 7일 전까지 고칠 수 있어요.
        {seeMoney ? " 품목 상세는 [지출 입력]에서 그 전표를 열어 넣을 수 있어요." : ""}
      </p>
    </div>
  );
}
