import { Suspense } from "react";
import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/dal";
import { listUsers } from "@/lib/data/users";
import { listAccessibleStores } from "@/lib/data/stores";
import { ROLE_LABEL } from "@/lib/auth/roles";
import { PageHeader } from "@/components/page-header";
import { EmptyState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CreateUserDialog, EditUserDialog, type StoreOption } from "./user-forms";

export const metadata: Metadata = { title: "계정 관리" };

export default function UsersPage() {
  return (
    <Suspense fallback={<LoadingState rows={6} />}>
      <Users />
    </Suspense>
  );
}

async function Users() {
  const me = await requireRole(["owner"]);
  const [users, stores] = await Promise.all([listUsers(), listAccessibleStores()]);
  const storeOptions: StoreOption[] = stores.map((s) => ({ id: s.id, name: s.name }));
  const storeName = new Map(stores.map((s) => [s.id, s.name]));

  const rows = users.map((u) => ({
    ...u,
    identifier: u.loginId ?? u.email ?? "-",
    storeNames: u.role === "owner" ? "전체 지점" : u.storeIds.map((id) => storeName.get(id) ?? "?").join(", ") || "없음",
  }));

  return (
    <>
      <PageHeader
        title="계정 관리"
        description="직원·관리자 계정 발급, 역할·소속 지점 지정, 사용 중지, 비밀번호 초기화"
        actions={<CreateUserDialog stores={storeOptions} />}
      />

      {rows.length === 0 ? (
        <EmptyState title="계정이 없습니다" />
      ) : (
        <>
          {/* PC: 표 */}
          <div className="hidden rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>이름</TableHead>
                  <TableHead>로그인</TableHead>
                  <TableHead>역할</TableHead>
                  <TableHead>소속 지점</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u) => (
                  <TableRow key={u.id} className={u.isActive ? undefined : "text-muted-foreground"}>
                    <TableCell className="font-medium">{u.fullName}</TableCell>
                    <TableCell>{u.identifier}</TableCell>
                    <TableCell>{ROLE_LABEL[u.role]}</TableCell>
                    <TableCell>{u.storeNames}</TableCell>
                    <TableCell>
                      <StatusBadge active={u.isActive} />
                    </TableCell>
                    <TableCell>
                      <EditUserDialog user={u} stores={storeOptions} isSelf={u.id === me.id} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* 모바일: 카드 */}
          <ul className="space-y-3 md:hidden">
            {rows.map((u) => (
              <li key={u.id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {u.fullName} <StatusBadge active={u.isActive} />
                    </p>
                    <p className="text-sm text-muted-foreground">{ROLE_LABEL[u.role]} · {u.storeNames}</p>
                    <p className="text-xs text-muted-foreground">{u.identifier}</p>
                  </div>
                  <EditUserDialog user={u} stores={storeOptions} isSelf={u.id === me.id} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return active ? <Badge variant="secondary">사용 중</Badge> : <Badge variant="outline">중지·승인대기</Badge>;
}
