import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireRole } from "@/lib/auth/dal";
import { canViewStorePnl } from "@/lib/auth/roles";
import { listAccessibleStores } from "@/lib/data/stores";
import { listVendors } from "@/lib/data/vendors";
import { listLedgerPayments, listLedgerPurchases } from "@/lib/data/payables";
import { buildLedger, itemPriceHistory, summarizePayables } from "@/lib/payables";
import { formatKRW, formatPercent, seoulDateKey } from "@/lib/format";
import { shortDateKo } from "@/lib/period";
import { PageHeader } from "@/components/page-header";
import { EmptyState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PaymentDialog } from "../payment-dialog";

export const metadata: Metadata = { title: "거래처 원장" };

export default function VendorLedgerPage(props: PageProps<"/payables/[vendorId]">) {
  return (
    <Suspense fallback={<LoadingState rows={10} />}>
      <VendorLedger {...props} />
    </Suspense>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const won = (n: number) => (n ? n.toLocaleString("ko-KR") : "");

async function VendorLedger({ params, searchParams }: PageProps<"/payables/[vendorId]">) {
  const user = await requireRole(["owner", "hq_manager"]);
  const { vendorId } = await params;
  const sp = await searchParams;
  const today = seoulDateKey();

  const [vendors, allStores] = await Promise.all([listVendors(), listAccessibleStores()]);
  const vendor = vendors.find((v) => v.id === vendorId);
  if (!vendor) return <EmptyState title="거래처를 찾을 수 없습니다" />;
  const stores = allStores.filter((s) => s.isActive && canViewStorePnl(user, s.id));
  if (!stores.length) return <EmptyState title="볼 수 있는 지점이 없습니다" />;
  const store = stores.find((s) => s.id === first(sp.store)) ?? stores.find((s) => vendor.storeIds.includes(s.id)) ?? stores[0];

  const [{ purchases, priceLines }, payments] = await Promise.all([
    listLedgerPurchases(store.id, vendor.id),
    listLedgerPayments(store.id, vendor.id),
  ]);
  const ledger = buildLedger(purchases, payments);
  const [summary] = summarizePayables({ vendorIds: [vendor.id], purchases, payments, month: today.slice(0, 7) });
  const prices = itemPriceHistory(priceLines);
  const isOwner = user.role === "owner";
  const paymentById = new Map(payments.map((p) => [p.id, p]));
  const purchaseById = new Map(purchases.map((p) => [p.id, p]));

  return (
    <div className="mx-auto max-w-5xl">
      <Link href={`/payables?store=${store.id}`} className={buttonVariants({ variant: "ghost", size: "sm", className: "mb-2" })}>
        <ArrowLeft className="size-4" /> 거래처 미수 목록
      </Link>
      <PageHeader
        title={`${vendor.name} 원장`}
        description={[vendor.items && `품목: ${vendor.items}`, vendor.contactName && `담당 ${vendor.contactName}`, vendor.phone]
          .filter(Boolean)
          .join(" · ") || "날짜별 매입(거래명세표)·결제와 미수 잔액"}
        actions={
          isOwner ? (
            <>
              <PaymentDialog
                storeId={store.id}
                storeName={store.name}
                vendors={[]}
                fixedVendorId={vendor.id}
                defaultKind="opening"
                today={today}
                triggerLabel="이월 미수 입력"
                triggerVariant="outline"
              />
              <PaymentDialog
                storeId={store.id}
                storeName={store.name}
                vendors={[]}
                fixedVendorId={vendor.id}
                today={today}
                suggestedAmount={summary?.balance}
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
              href={`/payables/${vendor.id}?store=${s.id}`}
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

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">현재 미수</p>
          <p className={cn("mt-1 text-2xl font-bold tabular-nums", (summary?.balance ?? 0) > 0 && "text-amber-700")}>
            {formatKRW(summary?.balance ?? 0)}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">이번 달 외상 매입</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{formatKRW(summary?.monthCredit ?? 0)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">이번 달 결제</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{formatKRW(summary?.monthPayments ?? 0)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">마지막 결제</p>
          <p className="mt-1 text-xl font-bold">{summary?.lastPaymentDate ? shortDateKo(summary.lastPaymentDate) : "기록 없음"}</p>
        </div>
      </div>

      <section aria-labelledby="ledger-h" className="mb-8">
        <h2 id="ledger-h" className="mb-2 text-sm font-semibold text-muted-foreground">
          날짜별 거래 ({store.name})
        </h2>
        {ledger.length === 0 ? (
          <EmptyState title="아직 거래 기록이 없습니다">
            [지출 입력]에서 이 거래처를 고르고 품목을 적거나, 남아 있는 미수를 [이월 미수 입력]으로 넣으세요.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b bg-muted/60 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">날짜</th>
                  <th className="px-3 py-2 text-left font-medium">내용</th>
                  <th className="px-3 py-2 text-right font-medium">외상 매입 (+)</th>
                  <th className="px-3 py-2 text-right font-medium">결제 (−)</th>
                  <th className="px-3 py-2 text-right font-medium">미수 잔액</th>
                  {isOwner && <th className="w-16 px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {ledger.map((e) => {
                  const pay = paymentById.get(e.refId);
                  const pur = purchaseById.get(e.refId);
                  return (
                    <tr key={e.key} className="border-b last:border-0">
                      <td className="px-3 py-2 whitespace-nowrap">{shortDateKo(e.date)}</td>
                      <td className="px-3 py-2">
                        {e.type === "opening" && <Badge variant="secondary">이월</Badge>}{" "}
                        {e.type === "purchase_paid" && <Badge variant="outline">바로 결제</Badge>} {e.label}
                        {e.type === "purchase_paid" && (
                          <span className="block text-xs text-muted-foreground">{formatKRW(e.paidNow)} (미수에 안 들어감)</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{won(e.increase)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{won(e.decrease)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatKRW(e.balance)}</td>
                      {isOwner && (
                        <td className="px-3 py-2 text-right">
                          {pay ? (
                            <PaymentDialog
                              storeId={store.id}
                              storeName={store.name}
                              vendors={[]}
                              today={today}
                              payment={{
                                id: pay.id,
                                vendorId: pay.vendorId,
                                date: pay.date,
                                kind: pay.kind,
                                amount: pay.amount,
                                method: pay.method,
                                memo: pay.memo,
                                updatedAt: pay.updatedAt ?? "",
                              }}
                              triggerLabel="수정"
                              triggerVariant="ghost"
                              triggerSize="sm"
                            />
                          ) : pur ? (
                            <Link
                              href={`/expenses?store=${store.id}&month=${pur.date.slice(0, 7)}&edit=${pur.id}`}
                              className={buttonVariants({ variant: "ghost", size: "sm" })}
                            >
                              수정
                            </Link>
                          ) : null}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="price-h" className="mb-8">
        <h2 id="price-h" className="mb-2 text-sm font-semibold text-muted-foreground">
          품목별 단가 (최근 기준)
        </h2>
        {prices.length === 0 ? (
          <EmptyState title="품목 기록이 없습니다">지출 입력 때 &apos;품목 적기&apos;로 품목·수량·단가를 적으면 여기서 단가 변동을 볼 수 있어요.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b bg-muted/60 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">품목</th>
                  <th className="px-3 py-2 text-right font-medium">최근 단가</th>
                  <th className="px-3 py-2 text-right font-medium">직전 단가</th>
                  <th className="px-3 py-2 text-right font-medium">변동</th>
                  <th className="px-3 py-2 text-right font-medium">산 횟수</th>
                </tr>
              </thead>
              <tbody>
                {prices.map((p) => {
                  const up = p.change.status === "ok" && p.change.value > 0;
                  const down = p.change.status === "ok" && p.change.value < 0;
                  return (
                    <tr key={p.key} className="border-b last:border-0">
                      <td className="px-3 py-2 font-medium">
                        {p.itemName} {p.unit && <span className="text-xs text-muted-foreground">/{p.unit}</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {p.latestPrice.toLocaleString("ko-KR")}원
                        <span className="block text-[11px] text-muted-foreground">{shortDateKo(p.latestDate)}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {p.previousPrice === null ? "-" : `${p.previousPrice.toLocaleString("ko-KR")}원`}
                        {p.previousDate && <span className="block text-[11px]">{shortDateKo(p.previousDate)}</span>}
                      </td>
                      <td className={cn("px-3 py-2 text-right font-semibold tabular-nums", up && "text-red-700", down && "text-emerald-700")}>
                        {p.change.status === "ok" ? `${up ? "▲" : down ? "▼" : ""} ${formatPercent({ status: "ok", value: Math.abs(p.change.value) })}` : "-"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{p.timesBought}번</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
