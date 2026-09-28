"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { LoadingState } from "@/components/shared/loading-state";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { loading, session, signingOut } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("sidebar-collapsed");
    if (stored === "true") setCollapsed(true);
  }, []);

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("sidebar-collapsed", String(next));
  };

  if (loading || signingOut) {
    return <LoadingState message={signingOut ? "Déconnexion..." : "Chargement de votre espace..."} />;
  }

  if (!session) {
    return null;
  }

  return (
    <div className="h-screen flex overflow-hidden bg-background app-shell-root">
      <div className="hidden lg:block no-print app-shell-sidebar">
        <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} />
      </div>
      <div className="flex-1 flex flex-col overflow-hidden app-shell-main">
        <div className="no-print app-shell-header">
          <Header />
        </div>
        <main className="flex-1 overflow-y-auto p-5 sm:p-7 lg:p-8 bg-background app-shell-content">
          {children}
        </main>
      </div>
    </div>
  );
}
