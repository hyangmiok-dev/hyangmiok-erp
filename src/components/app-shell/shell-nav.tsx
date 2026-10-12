import { getCurrentUser } from "@/lib/auth/dal";
import { isNavItemReady, navItemsFor, ROLE_LABEL } from "@/lib/auth/roles";
import { signOut } from "@/app/login/actions";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { NavLinks, type NavLinkItem } from "./nav-links";
import { MobileNav } from "./mobile-nav";

async function loadNav() {
  const user = await getCurrentUser();
  if (!user) return null;
  const items: NavLinkItem[] = navItemsFor(user.role).map((i) => ({ ...i, ready: isNavItemReady(i) }));
  return { user, items };
}

/** PC 좌측 사이드바 (세션을 읽으므로 Suspense 안에서 렌더) */
export async function SidebarNav() {
  const nav = await loadNav();
  if (!nav) return null;
  return (
    <div className="flex flex-1 flex-col justify-between gap-6 overflow-y-auto px-3 pb-4">
      <NavLinks items={nav.items} />
      <UserBox name={nav.user.fullName} roleLabel={ROLE_LABEL[nav.user.role]} />
    </div>
  );
}

/** 모바일 상단바 메뉴 */
export async function MobileNavLoader() {
  const nav = await loadNav();
  if (!nav) return null;
  return (
    <MobileNav items={nav.items} userBox={<UserBox name={nav.user.fullName} roleLabel={ROLE_LABEL[nav.user.role]} />} />
  );
}

function UserBox({ name, roleLabel }: { name: string; roleLabel: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="truncate text-sm font-semibold">{name}</p>
      <p className="text-xs text-muted-foreground">{roleLabel}</p>
      <div className="mt-3 flex gap-2">
        <Link href="/account" className={buttonVariants({ variant: "outline", size: "sm", className: "flex-1" })}>
          내 계정
        </Link>
        <form action={signOut} className="flex-1">
          <Button type="submit" variant="ghost" size="sm" className="w-full">
            로그아웃
          </Button>
        </form>
      </div>
    </div>
  );
}
