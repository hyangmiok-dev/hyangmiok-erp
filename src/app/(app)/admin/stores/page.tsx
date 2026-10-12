import { Suspense } from "react";
import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/dal";
import { listAccessibleStores } from "@/lib/data/stores";
import { formatDateTimeKo } from "@/lib/format";
import { weeklyOperatingHours } from "@/lib/validation/stores";
import { PageHeader } from "@/components/page-header";
import { LoadingState } from "@/components/states";
import { StockReserveControl } from "@/components/food-cost/stock-reserve-control";
import { StoreForm } from "./store-form";

export const metadata: Metadata = { title: "지점 설정" };

export default function StoresPage() {
  return (
    <Suspense fallback={<LoadingState rows={6} />}>
      <Stores />
    </Suspense>
  );
}

async function Stores() {
  await requireRole(["owner"]);
  const stores = await listAccessibleStores();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="지점 설정"
        description="지점 이름·주소·좌석 수·운영시간. 확인되지 않은 정보는 비워두면 '미확인'으로 표시되고, 관련 지표는 '비교 불가'로 나옵니다."
      />
      <div className="space-y-6">
        {stores.map((s) => {
          const weekly = weeklyOperatingHours(s.businessHours);
          return (
            <section key={s.id} className="rounded-xl border bg-card p-4 sm:p-6">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold">{s.name}</h2>
                <p className="text-xs text-muted-foreground">
                  주간 운영 {weekly === null ? "미확인" : `${weekly}시간`} · 최종 수정 {formatDateTimeKo(s.updatedAt)}
                </p>
              </div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
                <span>
                  냉장고 재고 비율 <b>{s.stockReservePct}%</b>
                  <span className="block text-xs text-muted-foreground">월말 재고를 세지 않은 달은 식재료 매입에서 이만큼 빼고 원가율을 계산해요.</span>
                </span>
                <StockReserveControl storeId={s.id} storeName={s.name} value={s.stockReservePct} />
              </div>
              <StoreForm store={s} />
            </section>
          );
        })}
      </div>
    </div>
  );
}
