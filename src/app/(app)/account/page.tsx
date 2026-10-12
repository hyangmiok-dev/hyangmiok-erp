import { Suspense } from "react";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/dal";
import { ROLE_LABEL } from "@/lib/auth/roles";
import { passwordHintFor } from "@/lib/validation/users";
import { PageHeader } from "@/components/page-header";
import { LoadingState } from "@/components/states";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "내 계정" };

export default function AccountPage() {
  return (
    <Suspense fallback={<LoadingState rows={3} />}>
      <Account />
    </Suspense>
  );
}

async function Account() {
  const user = await requireUser();
  return (
    <>
      <PageHeader
        title="내 계정"
        description={`${user.fullName} · ${ROLE_LABEL[user.role]} · 아이디: ${user.loginId ?? user.email ?? ""}`}
      />
      <section className="rounded-lg border p-5">
        <h2 className="mb-4 font-semibold">비밀번호 변경</h2>
        <PasswordForm hint={passwordHintFor(user.role, "own")} numericOnly={user.role === "staff"} />
      </section>
    </>
  );
}
