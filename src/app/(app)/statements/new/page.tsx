import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireRole } from "@/lib/auth/dal";
import { canManageStore } from "@/lib/auth/roles";
import { listAccessibleStores } from "@/lib/data/stores";
import { vendorOptionsForStore } from "@/lib/data/statements";
import { seoulDateKey } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { EmptyState, LoadingState } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { UploadFlow } from "./upload-flow";

export const metadata: Metadata = { title: "거래명세표 사진 올리기" };

export default function NewStatementPage({ searchParams }: PageProps<"/statements/new">) {
  return (
    <Suspense fallback={<LoadingState rows={6} />}>
      <NewStatement searchParams={searchParams} />
    </Suspense>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function NewStatement({ searchParams }: { searchParams: PageProps<"/statements/new">["searchParams"] }) {
  const user = await requireRole(["owner", "hq_manager", "store_manager"]);
  const sp = await searchParams;
  const stores = (await listAccessibleStores()).filter((s) => s.isActive && canManageStore(user, s.id));
  if (!stores.length) return <EmptyState title="거래명세표를 올릴 수 있는 지점이 없습니다" />;
  const store = stores.find((s) => s.id === first(sp.store)) ?? stores[0];
  const vendors = await vendorOptionsForStore(store.id);

  return (
    <div className="mx-auto max-w-xl">
      <Link href={`/statements?store=${store.id}`} className={buttonVariants({ variant: "ghost", size: "sm", className: "mb-2" })}>
        <ArrowLeft className="size-4" /> 거래명세표 목록
      </Link>
      <PageHeader title="거래명세표 사진 올리기" description="① 거래처 고르기 → ② 사진 찍기 → ③ AI가 읽은 내용을 사진과 비교해 확인" />

      {stores.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="지점">
          {stores.map((s) => (
            <Link
              key={s.id}
              href={`/statements/new?store=${s.id}`}
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
        <UploadFlow key={store.id} storeId={store.id} storeName={store.name} vendors={vendors} monthKey={seoulDateKey().slice(0, 7)} />
      )}
    </div>
  );
}
