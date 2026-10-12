import { Suspense } from "react";
import type { Metadata } from "next";
import { isEnvConfigured } from "@/lib/env";
import { EnvBanner } from "@/components/app-shell/env-banner";
import { SetupNotice } from "@/components/setup-notice";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "로그인" };

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      <EnvBanner />
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <p className="text-sm font-medium tracking-widest text-muted-foreground">香米屋</p>
            <h1 className="mt-1 text-2xl font-bold">향미옥 경영관리</h1>
          </div>
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            {isEnvConfigured() ? (
              <Suspense fallback={<div className="h-56" />}>
                <LoginForm />
              </Suspense>
            ) : (
              <SetupNotice />
            )}
          </div>
          <div className="mt-6 space-y-1 text-center text-xs text-muted-foreground">
            <p>한 번 로그인하면 이 휴대폰·컴퓨터에서는 로그아웃하기 전까지 자동으로 로그인됩니다.</p>
            <p>여러 사람이 같이 쓰는 컴퓨터에서는 사용 후 꼭 로그아웃하세요.</p>
            <p>계정 발급·비밀번호 초기화는 대표(관리자)에게 요청하세요.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
