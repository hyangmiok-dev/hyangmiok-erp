import { Suspense } from "react";
import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { requireUser } from "@/lib/auth/dal";
import { listAccessibleStores } from "@/lib/data/stores";
import { ROLE_LABEL, type SessionUser } from "@/lib/auth/roles";
import { formatDateKo } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { EmptyState, LoadingState } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dashboard } from "@/components/dashboard/dashboard";

export default function HomePage({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<LoadingState rows={6} />}>
      <Home searchParams={searchParams} />
    </Suspense>
  );
}

async function Home({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const user = await requireUser();
  if (user.role === "staff") return <StaffHome user={user} />;

  const sp = await searchParams;
  const isExec = user.role === "owner" || user.role === "hq_manager";
  return (
    <>
      <PageHeader
        title={isExec ? "통합 경영 대시보드" : "지점 대시보드"}
        description={`${user.fullName} · ${ROLE_LABEL[user.role]} · 기준일 ${formatDateKo(new Date())} (한국시간)`}
        actions={
          <Link href="/sales" className={buttonVariants({ size: "lg" })}>
            <ReceiptText className="size-4" /> 매출 입력
          </Link>
        }
      />
      <Dashboard searchParams={sp} user={user} />
    </>
  );
}

async function StaffHome({ user }: { user: SessionUser }) {
  const stores = await listAccessibleStores();
  return (
    <>
      <PageHeader title="내 업무" description={`${user.fullName} · ${ROLE_LABEL[user.role]} · ${formatDateKo(new Date())}`} />
      <div className="rounded-lg border bg-muted/30 p-4 text-sm">
        근무 스케줄·출퇴근·오픈/마감 체크리스트는 4단계에서 이 화면에 추가됩니다.
      </div>
      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">소속 지점</h2>
        {stores.length === 0 ? (
          <EmptyState title="소속 지점이 없습니다">대표에게 소속 지점 지정을 요청하세요.</EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {stores.map((s) => (
              <Card key={s.id}>
                <CardHeader>
                  <CardTitle>{s.name}</CardTitle>
                  <CardDescription>{s.address ?? "주소 미입력"}</CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">{s.notes}</CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
