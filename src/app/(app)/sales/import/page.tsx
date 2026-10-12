import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/dal";
import { canManageStore } from "@/lib/auth/roles";
import { listAccessibleStores } from "@/lib/data/stores";
import { PageHeader } from "@/components/page-header";
import { LoadingState } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { ImportClient } from "./import-client";

export const metadata: Metadata = { title: "매출 CSV 올리기" };

export default function ImportPage() {
  return (
    <Suspense fallback={<LoadingState rows={4} />}>
      <Import />
    </Suspense>
  );
}

async function Import() {
  const user = await requireRole(["owner", "hq_manager", "store_manager"]);
  const stores = (await listAccessibleStores())
    .filter((s) => canManageStore(user, s.id))
    .map((s) => ({ id: s.id, code: s.code, name: s.name }));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="매출 CSV 올리기"
        description={
          user.role === "owner"
            ? "지난 매출을 엑셀로 한꺼번에 등록합니다."
            : "최근 7일 이내 매출만 등록할 수 있습니다. 그 이전은 대표에게 요청하세요."
        }
        actions={
          <Link href="/sales" className={buttonVariants({ variant: "outline", size: "sm" })}>
            매출 입력으로
          </Link>
        }
      />
      <ImportClient stores={stores} />
    </div>
  );
}
