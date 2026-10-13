import { Suspense } from "react";
import Link from "next/link";
import { EnvBanner } from "@/components/app-shell/env-banner";
import { MobileNavLoader, SidebarNav } from "@/components/app-shell/shell-nav";
import { Skeleton } from "@/components/ui/skeleton";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <EnvBanner />
      <div className="flex flex-1">
        {/* PC: 좌측 사이드바 */}
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-sidebar lg:flex">
          <Brand />
          <Suspense fallback={<NavSkeleton />}>
            <SidebarNav />
          </Suspense>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* 모바일: 상단바 */}
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-2 backdrop-blur lg:hidden">
            <Suspense fallback={<div className="size-9" />}>
              <MobileNavLoader />
            </Suspense>
            <Link href="/" className="font-bold">
              향미옥 경영관리
            </Link>
          </header>
          {/* 아래 여백: 무료 넷리파이의 'Powered by Netlify' 표시(오른쪽 아래)에 마지막 내용이 가려지지 않게 */}
          <main className="flex-1 px-4 pt-5 pb-24 lg:px-8 lg:pt-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="block px-6 py-5">
      <p className="text-[11px] font-medium tracking-widest text-muted-foreground">香米屋</p>
      <p className="text-lg font-bold">향미옥 경영관리</p>
    </Link>
  );
}

function NavSkeleton() {
  return (
    <div className="space-y-2 px-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}
