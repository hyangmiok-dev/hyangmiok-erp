"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Boxes,
  ClipboardCheck,
  CookingPot,
  History,
  Home,
  ReceiptText,
  Store,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavIcon, NavItem } from "@/lib/auth/roles";

const ICONS: Record<NavIcon, LucideIcon> = {
  home: Home,
  sales: ReceiptText,
  pnl: Wallet,
  staff: Users,
  checklist: ClipboardCheck,
  inventory: Boxes,
  recipe: CookingPot,
  compare: BarChart3,
  store: Store,
  users: UserCog,
  audit: History,
};

export interface NavLinkItem extends NavItem {
  ready: boolean;
}

export function NavLinks({ items, onNavigate }: { items: NavLinkItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const groups = ["업무", "분석", "관리"] as const;

  return (
    <nav className="flex flex-col gap-5" aria-label="주 메뉴">
      {groups.map((group) => {
        const groupItems = items.filter((i) => i.group === group);
        if (groupItems.length === 0) return null;
        return (
          <div key={group}>
            <p className="mb-1 px-3 text-xs font-medium text-muted-foreground">{group}</p>
            <ul className="flex flex-col gap-0.5">
              {groupItems.map((item) => {
                const Icon = ICONS[item.icon];
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                if (!item.ready) {
                  return (
                    <li key={item.href}>
                      <span
                        className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground/60"
                        title={`${item.stage}단계에서 제공 예정`}
                      >
                        <Icon className="size-4" />
                        <span className="flex-1">{item.label}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">준비 중</span>
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted",
                        active && "bg-muted font-semibold text-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
