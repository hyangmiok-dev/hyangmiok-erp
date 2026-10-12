import { Suspense } from "react";
import { requireUser } from "@/lib/auth/dal";
import { listAccessibleStores } from "@/lib/data/stores";
import { ROLE_LABEL, type SessionUser } from "@/lib/auth/roles";
import { formatDateKo, MISSING_LABEL } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { EmptyState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function HomePage() {
  return (
    <Suspense fallback={<LoadingState rows={5} />}>
      <Home />
    </Suspense>
  );
}

async function Home() {
  const user = await requireUser();
  const stores = await listAccessibleStores();
  const isExec = user.role === "owner" || user.role === "hq_manager";

  return (
    <>
      <PageHeader
        title={isExec ? "통합 경영 대시보드" : user.role === "staff" ? "내 업무" : "지점 홈"}
        description={
          <>
            {user.fullName} · {ROLE_LABEL[user.role]} · 기준일 {formatDateKo(new Date())} (한국시간)
          </>
        }
      />

      <StageNotice user={user} />

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
          {user.role === "owner" ? "전체 지점" : "담당 지점"}
        </h2>
        {stores.length === 0 ? (
          <EmptyState title="접근 가능한 지점이 없습니다">대표에게 소속 지점 지정을 요청하세요.</EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {stores.map((s) => (
              <Card key={s.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {s.name}
                    {!s.isActive && <Badge variant="secondary">운영중지</Badge>}
                  </CardTitle>
                  <CardDescription>{s.address ?? "주소 미입력"}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {user.role !== "staff" && (
                    <div className="rounded-md bg-muted/60 p-3">
                      <p className="text-xs text-muted-foreground">오늘 매출</p>
                      <p className="mt-1 text-2xl font-bold text-muted-foreground">{MISSING_LABEL}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">매출 입력 기능은 2단계에서 제공됩니다.</p>
                    </div>
                  )}
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <dt className="text-muted-foreground">좌석 수</dt>
                    <dd className="text-right">{s.seatCount === null ? "미확인" : `${s.seatCount}석`}</dd>
                    <dt className="text-muted-foreground">면적</dt>
                    <dd className="text-right">{s.areaPyeong === null ? "미확인" : `${s.areaPyeong}평`}</dd>
                  </dl>
                  {s.notes && <p className="text-xs text-muted-foreground">{s.notes}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function StageNotice({ user }: { user: SessionUser }) {
  const next =
    user.role === "staff"
      ? "근무 스케줄·출퇴근·체크리스트 기능은 4단계에서 제공됩니다."
      : "매출 입력과 지점별 매출·객수·객단가 대시보드는 2단계에서 제공됩니다.";
  return (
    <div className="rounded-lg border bg-muted/30 p-4 text-sm">
      <p className="font-medium">현재 1단계(로그인·권한·계정관리)까지 구축되었습니다.</p>
      <p className="mt-1 text-muted-foreground">{next} 숫자가 입력되기 전에는 0원이 아니라 &apos;미입력&apos;으로 표시합니다.</p>
    </div>
  );
}
