"use client";

import { useState } from "react";
import { Menu, Search, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Sidebar } from "@/components/layout/sidebar";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { UserMenu } from "@/components/layout/user-menu";

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="h-[72px] border-b border-border/70 bg-card/95 backdrop-blur-sm flex items-center justify-between px-4 sm:px-7 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="lg:hidden">
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <Sidebar collapsed={false} onToggleCollapse={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
        <div className="hidden md:flex items-center w-[300px] lg:w-[390px] h-10 rounded-xl bg-muted/70 border border-border/70 px-3 gap-2 text-muted-foreground transition-colors focus-within:border-primary/40 focus-within:bg-card">
          <Search className="w-4 h-4 shrink-0" />
          <span className="text-xs truncate">Rechercher un parcours, un étudiant...</span>
        </div>
        <Breadcrumbs />
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        <button type="button" className="hidden sm:flex w-9 h-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" aria-label="Notifications">
          <Bell className="w-[18px] h-[18px]" />
        </button>
        <UserMenu />
      </div>
    </header>
  );
}
