import { Suspense } from "react";
import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { formatDateTimeKo } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "변경 이력" };

const TABLE_LABEL: Record<string, string> = {
  stores: "지점",
  profiles: "계정",
  store_members: "소속 지점",
};
const ACTION_LABEL: Record<string, string> = { INSERT: "추가", UPDATE: "수정", DELETE: "삭제" };

export default function AuditPage() {
  return (
    <Suspense fallback={<LoadingState rows={8} />}>
      <Audit />
    </Suspense>
  );
}

type Json = Record<string, unknown> | null;

/** 바뀐 필드만 요약 (updated_at 등 시스템 필드 제외) */
function summarize(oldData: Json, newData: Json): string {
  const skip = new Set(["updated_at", "created_at"]);
  if (oldData && newData) {
    const keys = Object.keys(newData).filter(
      (k) => !skip.has(k) && JSON.stringify(oldData[k]) !== JSON.stringify(newData[k]),
    );
    return keys.map((k) => `${k}: ${fmt(oldData[k])} → ${fmt(newData[k])}`).join(", ");
  }
  const row = newData ?? oldData ?? {};
  return Object.entries(row)
    .filter(([k]) => !skip.has(k))
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${fmt(v)}`)
    .join(", ");
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "없음";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

async function Audit() {
  await requireRole(["owner"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, occurred_at, actor_id, actor_role, action, table_name, record_id, old_data, new_data")
    .order("occurred_at", { ascending: false })
    .limit(200);

  if (error) return <ErrorState>{error.message}</ErrorState>;

  const actorIds = [...new Set((data ?? []).map((r) => r.actor_id).filter(Boolean))] as string[];
  const { data: actors } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", actorIds)
    : { data: [] as { id: string; full_name: string }[] };
  const actorName = new Map((actors ?? []).map((a) => [a.id, a.full_name]));

  return (
    <>
      <PageHeader title="변경 이력" description="지점·계정·권한의 중요한 변경 내역 (최근 200건, 수정·삭제 불가)" />
      {!data?.length ? (
        <EmptyState title="기록된 변경 내역이 없습니다" />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">일시</TableHead>
                <TableHead>수행자</TableHead>
                <TableHead>대상</TableHead>
                <TableHead>작업</TableHead>
                <TableHead>내용</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTimeKo(r.occurred_at)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.actor_id ? (actorName.get(r.actor_id) ?? "알 수 없음") : "시스템"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{TABLE_LABEL[r.table_name] ?? r.table_name}</TableCell>
                  <TableCell>{ACTION_LABEL[r.action] ?? r.action}</TableCell>
                  <TableCell className="max-w-xl text-xs text-muted-foreground">
                    {summarize(r.old_data as Json, r.new_data as Json)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
