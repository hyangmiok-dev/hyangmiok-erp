import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/dal";
import { passwordHintFor } from "@/lib/validation/users";
import { EnvBanner } from "@/components/app-shell/env-banner";
import { LoadingState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/login/actions";
import { PasswordForm } from "@/app/(app)/account/password-form";

export const metadata: Metadata = { title: "비밀번호 정하기" };

/** 계정 생성·비밀번호 초기화 후 첫 로그인 시 반드시 거치는 화면 */
export default function ChangePasswordPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      <EnvBanner />
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
          <Suspense fallback={<LoadingState rows={3} />}>
            <FirstPassword />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

async function FirstPassword() {
  const user = await requireUser({ allowPendingPassword: true });
  if (!user.mustChangePassword) redirect("/");
  const isStaff = user.role === "staff";

  return (
    <>
      <h1 className="text-xl font-bold">{user.fullName}님, 환영합니다 👋</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        처음 받은 비밀번호{isStaff ? "(생년월일)" : ""}는 다른 사람도 알 수 있어요.
        <br />
        <b className="text-foreground">나만 아는 비밀번호</b>로 바꿔야 시작할 수 있어요.
      </p>
      <div className="mt-6">
        <PasswordForm firstTime hint={passwordHintFor(user.role, "own")} numericOnly={isStaff} />
      </div>
      <form action={signOut} className="mt-4 text-center">
        <Button type="submit" variant="link" size="sm" className="text-muted-foreground">
          나중에 하기 (로그아웃)
        </Button>
      </form>
    </>
  );
}
