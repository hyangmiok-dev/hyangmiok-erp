import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Phone } from "lucide-react";
import { requireRole } from "@/lib/auth/dal";
import { listAccessibleStores } from "@/lib/data/stores";
import { listCategories } from "@/lib/data/expenses";
import { listVendors } from "@/lib/data/vendors";
import { PageHeader } from "@/components/page-header";
import { EmptyState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { VendorDialog } from "./vendor-form";

export const metadata: Metadata = { title: "거래처 관리" };

export default function VendorsPage({ searchParams }: PageProps<"/admin/vendors">) {
  return (
    <Suspense fallback={<LoadingState rows={8} />}>
      <Vendors searchParams={searchParams} />
    </Suspense>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Vendors({ searchParams }: { searchParams: PageProps<"/admin/vendors">["searchParams"] }) {
  await requireRole(["owner"]);
  const sp = await searchParams;
  const [stores, categories, vendors] = await Promise.all([listAccessibleStores(), listCategories(), listVendors()]);
  const storeName = new Map(stores.map((s) => [s.id, s.name.replace("향미옥 ", "")]));
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const foodId = categories.find((c) => c.code === "food")?.id ?? null;

  const filter = first(sp.store);
  const q = (first(sp.q) ?? "").trim();
  const shown = vendors.filter(
    (v) =>
      (!filter || v.storeIds.includes(filter)) &&
      (!q || `${v.name} ${v.items ?? ""} ${v.memo ?? ""} ${v.contactName ?? ""}`.includes(q)),
  );
  const storeOpts = stores.filter((s) => s.isActive).map((s) => ({ id: s.id, name: s.name }));
  const catOpts = categories.map((c) => ({ id: c.id, name: c.name, section: c.section }));
  const toForm = (v: (typeof vendors)[number]) => ({
    id: v.id,
    name: v.name,
    items: v.items,
    defaultCategoryId: v.defaultCategoryId,
    contactName: v.contactName,
    phone: v.phone,
    memo: v.memo,
    isActive: v.isActive,
    storeIds: v.storeIds,
  });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="거래처 관리"
        description="재료를 사는 곳(매입처) 목록이에요. 처음 목록은 '2026 엠앤 향미옥 손익' 엑셀의 1·2호점 원재료 거래처로 채워 두었어요. 품목·담당자·전화번호는 직접 채워 주세요."
        actions={
          <>
            <Link href="/purchases" className={buttonVariants({ variant: "outline" })}>
              거래처별 매입 보기
            </Link>
            <VendorDialog vendor={null} stores={storeOpts} categories={catOpts} defaultCategoryId={foodId} />
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[{ id: undefined, name: "전체" }, ...storeOpts].map((s) => (
          <Link
            key={s.id ?? "all"}
            href={`/admin/vendors${s.id ? `?store=${s.id}` : ""}`}
            className={cn(
              "flex h-10 items-center rounded-full border px-4 text-sm",
              (filter ?? undefined) === s.id ? "border-foreground bg-foreground text-background" : "bg-background",
            )}
          >
            {s.name.replace("향미옥 ", "")}
          </Link>
        ))}
        <form action="/admin/vendors" className="ml-auto">
          {filter && <input type="hidden" name="store" value={filter} />}
          <input
            name="q"
            defaultValue={q}
            placeholder="이름·품목 검색"
            aria-label="검색"
            className="h-10 w-44 rounded-lg border bg-background px-3 text-base"
          />
        </form>
      </div>

      {shown.length === 0 ? (
        <EmptyState title={q ? "검색 결과가 없습니다" : "거래처가 없습니다"}>[새 거래처]로 추가하세요.</EmptyState>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {shown.map((v) => (
            <li key={v.id} className={cn("flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3", !v.isActive && "opacity-60")}>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {v.name}
                  {!v.isActive && <Badge variant="outline">거래 중지</Badge>}
                  {v.storeIds.length === 0 && <Badge variant="outline">거래 지점 없음</Badge>}
                  {v.storeIds.map((id) => (
                    <Badge key={id} variant="secondary">
                      {storeName.get(id) ?? "?"}
                    </Badge>
                  ))}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {v.items ? `품목: ${v.items}` : "품목 미입력"} · 기본 항목: {v.defaultCategoryId ? (catName.get(v.defaultCategoryId) ?? "?") : "없음"}
                  {v.contactName && ` · 담당 ${v.contactName}`}
                </p>
                {v.memo && <p className="mt-0.5 text-xs text-muted-foreground">{v.memo}</p>}
              </div>
              <div className="flex items-center gap-2">
                {v.phone && (
                  <a href={`tel:${v.phone.replace(/[^0-9+]/g, "")}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                    <Phone className="size-4" /> {v.phone}
                  </a>
                )}
                <VendorDialog vendor={toForm(v)} stores={storeOpts} categories={catOpts} defaultCategoryId={foodId} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        거래처 {vendors.length}곳 · 순서는 처음엔 엑셀 1~9월 매입액이 큰 순서예요. 지출 입력 화면의 거래처 버튼도 이 순서로 나와요.
      </p>
    </div>
  );
}
