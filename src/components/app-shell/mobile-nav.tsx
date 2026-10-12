"use client";

import { useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NavLinks, type NavLinkItem } from "./nav-links";

export function MobileNav({ items, userBox }: { items: NavLinkItem[]; userBox: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="icon-lg" aria-label="메뉴 열기" />}>
        <Menu className="size-5" />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>향미옥 경영관리</SheetTitle>
        </SheetHeader>
        <div className="flex flex-1 flex-col justify-between gap-6 px-3 pb-4">
          <NavLinks items={items} onNavigate={() => setOpen(false)} />
          {userBox}
        </div>
      </SheetContent>
    </Sheet>
  );
}
