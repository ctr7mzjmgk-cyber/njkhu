"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingState } from "@/components/shared/loading-state";
import { ErrorState } from "@/components/shared/error-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/types/database";
import { getStaffDisplayName, getStaffInitials } from "@/lib/hr/staff-utils";
import { Building2, Users, Briefcase, UserX } from "lucide-react";

type Dept = Database["public"]["Tables"]["hr_departments"]["Row"];
type Staff = Database["public"]["Tables"]["hr_staff"]["Row"];
type Position = Database["public"]["Tables"]["hr_positions"]["Row"];

type HolderInfo = {
  id: string;
  staff_number: string;
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  status: string;
};

type PositionWithHolder = Position & {
  holder: HolderInfo | null;
};

type StaffWithAssignment = Staff & {
  hr_assignments: {
    id: string;
    is_primary: boolean;
    end_date: string | null;
    department_id: string;
    position_id: string | null;
    hr_positions: { name: string } | null;
  }[];
};

type DeptNode = Dept & {
  children: DeptNode[];
  positions: PositionWithHolder[];
  staff: StaffWithAssignment[];
};

const LEVEL_LABELS: Record<number, string> = {
  1: "Direction générale",
  2: "Sous-direction",
  3: "Service",
  4: "Unité",
  5: "Cellule",
};

export default function OrgChartPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<DeptNode[]>([]);
  const [unassignedStaff, setUnassignedStaff] = useState<StaffWithAssignment[]>([]);

  const fetchOrgChart = useCallback(async () => {
    if (!profile?.institution_id) return;
    setLoading(true);
    setError(null);
    try {
      const instId = profile.institution_id;
      const [deptRes, staffRes, posRes, assignRes] = await Promise.all([
        supabase.from("hr_departments").select("*").eq("institution_id", instId).order("level", { ascending: true }).order("name", { ascending: true }),
        supabase
          .from("hr_staff")
          .select(`
            *,
            hr_assignments(
              id, is_primary, end_date, department_id, position_id,
              hr_positions(name)
            )
          `)
          .eq("institution_id", instId)
          .order("last_name", { ascending: true }),
        supabase.from("hr_positions").select("*").eq("institution_id", instId).eq("is_active", true).order("name", { ascending: true }),
        supabase
          .from("hr_assignments")
          .select("id, staff_id, position_id, is_primary, end_date")
          .is("end_date", null)
          .order("is_primary", { ascending: false }),
      ]);

      if (deptRes.error) throw deptRes.error;
      if (staffRes.error) throw staffRes.error;
      if (posRes.error) throw posRes.error;
      if (assignRes.error) throw assignRes.error;

      const departments = deptRes.data as Dept[];
      const allStaff = (staffRes.data as unknown as StaffWithAssignment[]) ?? [];
      const allPositions = (posRes.data as Position[]) ?? [];
      const allAssignments = (assignRes.data as { id: string; staff_id: string; position_id: string | null; is_primary: boolean; end_date: string | null }[]) ?? [];

      const staffMap = new Map<string, Staff>();
      allStaff.forEach((s) => staffMap.set(s.id, s));

      const positionHolders = new Map<string, string>();
      allAssignments.forEach((a) => {
        if (a.position_id && !positionHolders.has(a.position_id)) {
          positionHolders.set(a.position_id, a.staff_id);
        }
      });

      const deptMap = new Map<string, DeptNode>();
      departments.forEach((d) => {
        deptMap.set(d.id, { ...d, children: [], positions: [], staff: [] });
      });

      const roots: DeptNode[] = [];
      departments.forEach((d) => {
        const node = deptMap.get(d.id)!;
        if (d.parent_id && deptMap.has(d.parent_id)) {
          deptMap.get(d.parent_id)!.children.push(node);
        } else {
          roots.push(node);
        }
      });

      allPositions.forEach((p) => {
        if (p.department_id && deptMap.has(p.department_id)) {
          const holderId = positionHolders.get(p.id);
          const holderStaff = holderId ? staffMap.get(holderId) : null;
          deptMap.get(p.department_id)!.positions.push({
            ...p,
            holder: holderStaff
              ? {
                  id: holderStaff.id,
                  staff_number: holderStaff.staff_number,
                  first_name: holderStaff.first_name,
                  last_name: holderStaff.last_name,
                  photo_url: holderStaff.photo_url,
                  status: holderStaff.status,
                }
              : null,
          });
        }
      });

      const assignedIds = new Set<string>();
      allStaff.forEach((s) => {
        const activeAssignments = (s.hr_assignments ?? []).filter((a) => !a.end_date);
        activeAssignments.forEach((a) => {
          if (a.department_id && deptMap.has(a.department_id)) {
            deptMap.get(a.department_id)!.staff.push(s);
            assignedIds.add(s.id);
          }
        });
      });

      setTree(roots);
      setUnassignedStaff(allStaff.filter((s) => !assignedIds.has(s.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  }, [profile?.institution_id]);

  useEffect(() => { fetchOrgChart(); }, [fetchOrgChart]);

  if (loading) {
    return <div><PageHeader title="Organigramme" description="Vue arborescente de l'organisation" /><LoadingState /></div>;
  }
  if (error) {
    return <div><PageHeader title="Organigramme" description="Vue arborescente" /><ErrorState message={error} action={<Button variant="outline" size="sm" onClick={fetchOrgChart}>Réessayer</Button>} /></div>;
  }

  const hasData = tree.length > 0 || unassignedStaff.length > 0;

  return (
    <div>
      <PageHeader title="Organigramme" description="Arbre généalogique : Direction → Service → Postes & Personnel" />

      {!hasData ? (
        <Card className="p-4">
          <EmptyState title="Aucune organisation" message="Créez des directions et des postes pour visualiser l'organigramme." />
        </Card>
      ) : (
        <div className="space-y-6">
          {tree.length === 0 && unassignedStaff.length > 0 && (
            <Card className="p-4">
              <p className="text-sm text-muted-foreground mb-3">
                Aucune direction créée. Le personnel non affecté apparaît ci-dessous.
              </p>
            </Card>
          )}

          {tree.map((node) => (
            <TreeLevel key={node.id} nodes={[node]} isRoot={true} />
          ))}

          {unassignedStaff.length > 0 && (
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Personnel non affecté</h3>
                <Badge variant="secondary">{unassignedStaff.length}</Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {unassignedStaff.map((s) => (
                  <StaffCard key={s.id} staff={s} />
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function TreeLevel({ nodes, isRoot }: { nodes: DeptNode[]; isRoot: boolean }) {
  return (
    <div className="flex flex-col items-center gap-0">
      {/* Row of department nodes */}
      <div className="flex items-start justify-center gap-6 flex-wrap">
        {nodes.map((node) => (
          <TreeNode key={node.id} node={node} isRoot={isRoot} />
        ))}
      </div>
    </div>
  );
}

function TreeNode({ node, isRoot }: { node: DeptNode; isRoot: boolean }) {
  const hasChildren = node.children.length > 0;
  const hasPositions = node.positions.length > 0;
  const hasStaff = node.staff.length > 0;
  const vacantCount = node.positions.filter((p) => !p.holder).length;

  return (
    <div className="flex flex-col items-center">
      {/* Connector from parent to this node */}
      {!isRoot && (
        <div className="w-px h-6 bg-border" aria-hidden />
      )}

      {/* Department card */}
      <div className="flex flex-col items-center">
        <Card className="p-4 min-w-[220px] max-w-[300px] shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="w-5 h-5 text-primary shrink-0" />
            <span className="font-semibold text-sm">{node.name}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
            <Badge variant="outline" className="text-[10px]">{LEVEL_LABELS[node.level] ?? `Niveau ${node.level}`}</Badge>
            <span className="text-[10px] text-muted-foreground">{node.code}</span>
            {!node.is_active && <Badge variant="secondary" className="text-[10px]">Inactif</Badge>}
          </div>
          {(hasPositions || hasChildren) && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {hasPositions && <Badge variant="secondary" className="text-[10px]">{node.positions.length} poste{node.positions.length > 1 ? "s" : ""}</Badge>}
              {vacantCount > 0 && <Badge variant="outline" className="text-[10px] text-amber-600">{vacantCount} vacant{vacantCount > 1 ? "s" : ""}</Badge>}
              {hasChildren && <Badge variant="outline" className="text-[10px]">{node.children.length} sous.</Badge>}
            </div>
          )}
        </Card>

        {/* Positions and staff inside this structure */}
        {(hasPositions || hasStaff) && (
          <div className="mt-3 p-3 rounded-lg border border-dashed border-border bg-muted/20 min-w-[200px] max-w-[300px] space-y-2">
            {node.positions.map((p) => (
              <PositionCard key={p.id} position={p} />
            ))}
            {node.staff.map((s) => (
              <StaffCard key={s.id} staff={s} />
            ))}
          </div>
        )}
      </div>

      {/* Connector down to children */}
      {hasChildren && (
        <>
          <div className="w-px h-6 bg-border" aria-hidden />
          <div className="relative flex items-start justify-center gap-6 flex-wrap">
            {/* Horizontal connector bar above children */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 h-px bg-border"
              style={{
                width: "100%",
                maxWidth: "100%",
              }}
            />
            {node.children.map((child) => (
              <div key={child.id} className="flex flex-col items-center">
                <div className="w-px h-6 bg-border" aria-hidden />
                <TreeNode node={child} isRoot={false} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PositionCard({ position }: { position: PositionWithHolder }) {
  const { holder } = position;
  const isVacant = !holder;

  if (isVacant) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-amber-300 bg-amber-50/50 p-2">
        <div className="w-8 h-8 shrink-0 rounded-full bg-muted flex items-center justify-center">
          <UserX className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium truncate text-muted-foreground">Poste vacant</p>
          <p className="text-[10px] text-muted-foreground truncate">{position.name}</p>
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px] text-amber-600 border-amber-300">Vacant</Badge>
      </div>
    );
  }

  const displayName = getStaffDisplayName(holder!);
  const initials = getStaffInitials(holder!);

  const statusColors: Record<string, "default" | "secondary"> = {
    active: "default",
    on_leave: "secondary",
    terminated: "secondary",
    retired: "secondary",
  };

  return (
    <div className="flex items-center gap-2 rounded-md border border-border p-2 bg-card hover:shadow-sm transition-shadow">
      <Avatar className="w-8 h-8 shrink-0">
        {holder!.photo_url && <AvatarImage src={holder!.photo_url} alt={displayName} />}
        <AvatarFallback className="text-[10px] bg-primary text-white">{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">{displayName}</p>
        <p className="text-[10px] text-muted-foreground truncate flex items-center gap-0.5">
          <Briefcase className="w-2.5 h-2.5 shrink-0" />
          {position.name}
        </p>
      </div>
      <Badge variant={statusColors[holder!.status] ?? "secondary"} className="shrink-0 text-[10px]">
        {holder!.status === "active" ? "Actif" : holder!.status === "on_leave" ? "Congé" : holder!.status}
      </Badge>
    </div>
  );
}

function StaffCard({ staff }: { staff: StaffWithAssignment }) {
  const displayName = getStaffDisplayName(staff);
  const initials = getStaffInitials(staff);
  const primaryAssignment = (staff.hr_assignments ?? []).find((a) => a.is_primary && !a.end_date);
  const positionName = primaryAssignment?.hr_positions?.name;

  const statusColors: Record<string, "default" | "secondary"> = {
    active: "default",
    on_leave: "secondary",
    terminated: "secondary",
    retired: "secondary",
  };

  return (
    <div className="flex items-center gap-2 rounded-md border border-border p-2 bg-card hover:shadow-sm transition-shadow">
      <Avatar className="w-8 h-8 shrink-0">
        {staff.photo_url && <AvatarImage src={staff.photo_url} alt={displayName} />}
        <AvatarFallback className="text-[10px] bg-primary text-white">{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">{displayName}</p>
        <p className="text-[10px] text-muted-foreground truncate">
          {positionName ?? staff.staff_number}
          {positionName && ` · ${staff.staff_number}`}
        </p>
      </div>
      <Badge variant={statusColors[staff.status] ?? "secondary"} className="shrink-0 text-[10px]">
        {staff.status === "active" ? "Actif" : staff.status === "on_leave" ? "Congé" : staff.status}
      </Badge>
    </div>
  );
}
