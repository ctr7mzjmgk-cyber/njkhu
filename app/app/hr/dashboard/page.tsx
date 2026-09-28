"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { LoadingState } from "@/components/shared/loading-state";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase/client";
import { UsersRound, Building2, Briefcase, UserCheck } from "lucide-react";

export default function HRDashboardPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    staff: 0,
    departments: 0,
    positions: 0,
    activeAssignments: 0,
  });
  const [recentStaff, setRecentStaff] = useState<
    { id: string; staff_number: string; hire_date: string; status: string }[]
  >([]);

  const fetchDashboard = useCallback(async () => {
    if (!profile?.institution_id) return;
    setLoading(true);
    try {
      const instId = profile.institution_id;
      const [
        { count: staffCount },
        { count: deptCount },
        { count: posCount },
        { count: assignCount },
        { data: recent },
      ] = await Promise.all([
        supabase.from("hr_staff").select("*", { count: "exact", head: true }).eq("institution_id", instId),
        supabase.from("hr_departments").select("*", { count: "exact", head: true }).eq("institution_id", instId),
        supabase.from("hr_positions").select("*", { count: "exact", head: true }).eq("institution_id", instId),
        supabase.from("hr_assignments").select("*", { count: "exact", head: true }).is("end_date", null),
        supabase
          .from("hr_staff")
          .select("id, staff_number, hire_date, status")
          .eq("institution_id", instId)
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

      setStats({
        staff: staffCount ?? 0,
        departments: deptCount ?? 0,
        positions: posCount ?? 0,
        activeAssignments: assignCount ?? 0,
      });
      setRecentStaff(
        (recent as { id: string; staff_number: string; hire_date: string; status: string }[]) ?? [],
      );
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [profile?.institution_id]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Ressources Humaines" description="Vue d'ensemble du personnel" />
        <LoadingState />
      </div>
    );
  }

  const statusLabels: Record<string, string> = {
    active: "Actif",
    on_leave: "En congé",
    terminated: "Licencié",
    retired: "Retraité",
  };

  return (
    <div>
      <PageHeader
        title="Ressources Humaines"
        description="Vue d'ensemble du personnel administratif et support"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Personnel" value={stats.staff} icon={UsersRound} />
        <StatCard label="Directions & Services" value={stats.departments} icon={Building2} />
        <StatCard label="Postes & Fonctions" value={stats.positions} icon={Briefcase} />
        <StatCard label="Affectations actives" value={stats.activeAssignments} icon={UserCheck} />
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-foreground mb-3">Personnel récent</h2>
        {recentStaff.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Aucun membre du personnel enregistré pour le moment.
          </p>
        ) : (
          <div className="space-y-2">
            {recentStaff.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-lg border border-border p-3"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{s.staff_number}</span>
                  <Badge variant={s.status === "active" ? "default" : "secondary"}>
                    {statusLabels[s.status] ?? s.status}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  Embauché le {new Date(s.hire_date).toLocaleDateString("fr-FR")}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
