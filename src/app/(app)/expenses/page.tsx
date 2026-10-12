import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth/dal";
import { listAccessibleStores } from "@/lib/data/stores";
import {
  getExpense,
  listCategories,
  listExpenseLines,
  listExpenses,
  listInventory,
  recentItemsByVendor,
  recentVendors,
} from "@/lib/data/expenses";
import { listSales } from "@/lib/data/sales";
import { statementIdsByExpense } from "@/lib/data/statements";
import { summarizeItems } from "@/lib/payables";
import { listVendors } from "@/lib/data/vendors";
import { formatKRW, seoulDateKey } from "@/lib/format";
import { computeStorePnl, isMonthKey, monthRange, prevMonth, SECTION_LABEL, type Section } from "@/lib/pnl";
import { addDays, shortDateKo } from "@/lib/period";
import { PageHeader } from "@/components/page-header";
import { EmptyState, LoadingState } from "@/components/states";
import { FoodCostLine } from "@/components/food-cost/food-cost-panel";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ExpenseForm } from "./expense-form";
import { CopyRecurringButton, DeleteExpenseButton } from "./row-actions";

export const metadata: Metadata = { title: "지출 입력" };

export default function ExpensesPage({ searchParams }: PageProps<"/expenses">) {
  return (
    <Suspense fallback={<LoadingState rows={6} />}>
      <Expenses searchParams={searchParams} />
    </Suspense>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const SECTIONS: Section[] = ["cogs", "labor", "opex", "excluded"];

async function Expenses({ searchParams }: { searchParams: PageProps<"/expenses">["searchParams"] }) {
  await requireRole(["owner"]);
  const sp = await searchParams;
  const today = seoulDateKey();
  const thisMonth = today.slice(0, 7);
  let month = first(sp.month);
  if (!isMonthKey(month) || month > thisMonth) month = thisMonth;

  const stores = (await listAccessibleStores()).filter((s) => s.isActive);
  if (!stores.length) return <EmptyState title="지점이 없습니다" />;
  const storeParam = first(sp.store);
  const store = stores.find((s) => s.id === storeParam) ?? stores[0]; // 지점별로 따로 관리
  const q = (first(sp.q) ?? "").trim();
  const editId = first(sp.edit);

  const range = monthRange(month);
  const [categories, expenses, vendors, editing, vendorRows, itemSuggestions, monthSales, inventory] = await Promise.all([
    listCategories(),
    listExpenses(range, [store.id]),
    recentVendors(),
    editId ? getExpense(editId) : Promise.resolve(null),
    listVendors(),
    recentItemsByVendor(addDays(today, -365)),
    listSales(range, [store.id]),
    listInventory([addDays(range.start, -1), range.end], [store.id]),
  ]);
  // 거래명세표를 넣을 때마다 바로 바뀌는 원가율 (냉장고 재고 비율 반영)
  const foodCost = computeStorePnl({
    storeId: store.id,
    month,
    today,
    sales: monthSales,
    expenses,
    inventory,
    stockReservePct: store.stockReservePct,
  });
  const vendorList = vendorRows
    .filter((v) => v.isActive)
    .map((v) => ({
      id: v.id,
      name: v.name,
      items: v.items,
      defaultCategoryId: v.defaultCategoryId,
      onCredit: v.onCredit,
      storeIds: v.storeIds,
    }));
  const [lines, photoOf] = await Promise.all([
    listExpenseLines([...expenses.map((e) => e.id), ...(editing ? [editing.id] : [])]),
    statementIdsByExpense(expenses.map((e) => e.id)),
  ]);
  const linesOf = (id: string) => lines.filter((l) => l.expenseId === id);

  const filtered = q
    ? expenses.filter((e) => `${e.vendor ?? ""} ${e.description ?? ""} ${e.categoryName}`.includes(q))
    : expenses;
  const sectionTotal = (s: Section) => filtered.filter((e) => e.section === s).reduce((n, e) => n + e.amount, 0);
  const estimatedCount = filtered.filter((e) => e.basis === "estimated").length;

  const qs = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const merged = { month, store: store?.id, q: q || undefined, ...p };
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, v);
    return `/expenses?${u.toString()}`;
  };
  const nextMonth = addDays(range.end, 1).slice(0, 7);
  const defaultDate = month === thisMonth ? today : range.end;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="지출 입력"
        description="재료 매입은 거래명세표가 들어올 때마다, 월세·공과금은 낼 때 입력하세요. 모든 금액은 부가세 포함."
        actions={
          <Link href={`/pnl?month=${month}&store=${store.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            손익 보기
          </Link>
        }
      />

      <section className="mb-6 rounded-xl border bg-card p-4 sm:p-6">
        <h2 className="mb-4 font-semibold">{editing ? "지출 수정" : "새 지출"}</h2>
        <ExpenseForm
          key={editing?.id ?? "new"}
          stores={stores.map((s) => ({ id: s.id, name: s.name }))}
          categories={categories}
          vendors={vendors}
          vendorList={vendorList}
          itemSuggestions={itemSuggestions}
          defaultStoreId={store.id}
          defaultDate={defaultDate}
          today={today}
          editing={
            editing
              ? {
                  id: editing.id,
                  storeId: editing.storeId,
                  vendorId: editing.vendorId,
                  date: editing.date,
                  categoryId: editing.categoryId,
                  vendor: editing.vendor,
                  description: editing.description,
                  amount: editing.amount,
                  basis: editing.basis,
                  onCredit: editing.onCredit,
                  lines: linesOf(editing.id).map((l) => ({
                    itemName: l.itemName,
                    quantity: l.quantity,
                    unit: l.unit,
                    unitPrice: l.unitPrice,
                    amount: l.amount,
                  })),
                  updatedAt: editing.updatedAt,
                }
              : null
          }
          cancelHref={qs({ edit: undefined })}
        />
      </section>

      {/* 월·지점 선택 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Link href={qs({ month: prevMonth(month) })} className={buttonVariants({ variant: "ghost", size: "icon-lg" })} aria-label="이전 달">
            <ChevronLeft className="size-5" />
          </Link>
          <span className="min-w-24 text-center font-semibold">
            {Number(month.slice(0, 4))}년 {Number(month.slice(5))}월
          </span>
          <Link
            href={month < thisMonth ? qs({ month: nextMonth }) : "#"}
            aria-disabled={month >= thisMonth}
            className={buttonVariants({ variant: "ghost", size: "icon-lg", className: cn(month >= thisMonth && "pointer-events-none opacity-30") })}
            aria-label="다음 달"
          >
            <ChevronRight className="size-5" />
          </Link>
        </div>
        <div className="flex flex-wrap gap-1">
          {stores.map((s) => (
            <Link
              key={s.id ?? "all"}
              href={qs({ store: s.id })}
              className={cn(
                "flex h-10 items-center rounded-full border px-4 text-sm",
                store.id === s.id ? "border-foreground bg-foreground text-background" : "bg-background",
              )}
            >
              {s.name.replace("향미옥 ", "")}
            </Link>
          ))}
        </div>
        <form action="/expenses" className="ml-auto flex gap-2">
          <input type="hidden" name="month" value={month} />
          {store && <input type="hidden" name="store" value={store.id} />}
          <input
            name="q"
            defaultValue={q}
            placeholder="거래처·내용 검색"
            aria-label="검색"
            className="h-10 w-40 rounded-lg border bg-background px-3 text-base sm:w-56"
          />
        </form>
      </div>

      {/* 합계 */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SECTIONS.map((s) => (
          <div key={s} className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">{SECTION_LABEL[s]}</p>
            <p className="text-lg font-bold tabular-nums">{formatKRW(sectionTotal(s))}</p>
          </div>
        ))}
      </div>
      <div className="mb-4">
        <FoodCostLine
          pnl={foodCost}
          storeName={store.name}
          title={month === thisMonth ? "이번 달 원가율 (실시간)" : `${Number(month.slice(5))}월 원가율`}
          canEdit
        />
      </div>
      {month <= thisMonth && (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <CopyRecurringButton storeId={store.id} month={month} storeName={store.name} />
          매달 같은 월세·관리비·급여는 지난달 것을 불러와서 금액만 고치면 됩니다.
        </div>
      )}
      {estimatedCount > 0 && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          &apos;추정&apos; 금액 {estimatedCount}건이 있습니다. 청구서를 확인하면 [수정]에서 &apos;실제 금액&apos;으로 바꿔 주세요.
        </p>
      )}

      {/* 목록 */}
      {filtered.length === 0 ? (
        <EmptyState title={q ? "검색 결과가 없습니다" : "이 달에 입력된 지출이 없습니다"}>
          {q ? "검색어를 바꿔 보세요." : "위에서 지출을 입력하세요. 입력하지 않은 비용은 0원이 아니라 '미입력'으로 취급됩니다."}
        </EmptyState>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {filtered.map((e) => (
            <li key={e.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm", e.id === editing?.id && "bg-muted/60")}>
              <span className="w-24 shrink-0 text-muted-foreground">{shortDateKo(e.date)}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{e.vendor ?? e.categoryName}</span>{" "}
                <span className="text-muted-foreground">
                  · {e.categoryName}
                  {(() => {
                    const s = summarizeItems(linesOf(e.id));
                    return s ? ` · ${s}` : "";
                  })()}
                  {e.description && ` · ${e.description}`}
                </span>
              </span>
              {e.onCredit && <Badge className="bg-amber-100 text-amber-900">외상</Badge>}
              {e.basis === "estimated" && <Badge variant="outline">추정</Badge>}
              {e.section === "excluded" && <Badge variant="secondary">제외</Badge>}
              <span className="w-28 text-right font-semibold tabular-nums">{formatKRW(e.amount)}</span>
              <span className="flex gap-1">
                {photoOf.has(e.id) && (
                  <Link href={`/statements/${photoOf.get(e.id)}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                    사진
                  </Link>
                )}
                <Link href={qs({ edit: e.id })} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                  수정
                </Link>
                <DeleteExpenseButton id={e.id} label={`${shortDateKo(e.date)} ${e.vendor ?? e.categoryName} ${formatKRW(e.amount)}`} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
