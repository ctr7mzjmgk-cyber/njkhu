"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingState } from "@/components/shared/loading-state";
import { ErrorState } from "@/components/shared/error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/types/database";
import { getStaffDisplayName } from "@/lib/hr/staff-utils";
import { Plus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

type Assignment = Database["public"]["Tables"]["hr_assignments"]["Row"];

type AssignmentWithDetails = Assignment & {
  hr_staff: {
    staff_number: string;
    first_name: string | null;
    last_name: string | null;
    photo_url: string | null;
  } | null;
  hr_departments: { name: string; code: string } | null;
  hr_positions: { name: string; code: string } | null;
};

type StaffOption = {
  id: string;
  staff_number: string;
  first_name: string | null;
  last_name: string | null;
};
type DeptOption = { id: string; name: string; code: string };
type PosOption = { id: string; name: string; code: string };

function staffDisplayName(s: { first_name: string | null; last_name: string | null; staff_number: string }): string {
  const name = `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim();
  return name || s.staff_number;
}

export default function AssignmentsPage() {
  const { permissions, profile } = useAuth();
  const { toast } = useToast();

  const [assignments, setAssignments] = useState<AssignmentWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Assignment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Assignment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [deptOptions, setDeptOptions] = useState<DeptOption[]>([]);
  const [posOptions, setPosOptions] = useState<PosOption[]>([]);

  const canCreate = permissions.includes("hr.create" as never);
  const canUpdate = permissions.includes("hr.update" as never);
  const canDelete = permissions.includes("hr.delete" as never);

  const fetchAssignments = useCallback(async () => {
    if (!profile?.institution_id) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("hr_assignments")
        .select(`
          *,
          hr_staff(staff_number, first_name, last_name, photo_url),
          hr_departments(name, code),
          hr_positions(name, code)
        `)
        .order("start_date", { ascending: false });
      if (err) throw err;
      setAssignments((data as AssignmentWithDetails[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  }, [profile?.institution_id]);

  const fetchOptions = useCallback(async () => {
    if (!profile?.institution_id) return;
    try {
      const instId = profile.institution_id;
      const [staffRes, deptRes, posRes] = await Promise.all([
        supabase.from("hr_staff").select("id, staff_number, first_name, last_name").eq("institution_id", instId).eq("status", "active").order("staff_number"),
        supabase.from("hr_departments").select("id, name, code").eq("institution_id", instId).eq("is_active", true).order("name"),
        supabase.from("hr_positions").select("id, name, code").eq("institution_id", instId).eq("is_active", true).order("name"),
      ]);
      setStaffOptions((staffRes.data as StaffOption[]) ?? []);
      setDeptOptions((deptRes.data as DeptOption[]) ?? []);
      setPosOptions((posRes.data as PosOption[]) ?? []);
    } catch {
      // ignore
    }
  }, [profile?.institution_id]);

  useEffect(() => { fetchAssignments(); fetchOptions(); }, [fetchAssignments, fetchOptions]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error: err } = await supabase.from("hr_assignments").delete().eq("id", deleteTarget.id);
      if (err) throw err;
      toast({ title: "Affectation supprimée" });
      setDeleteTarget(null);
      fetchAssignments();
    } catch (err) {
      toast({ title: "Erreur", description: err instanceof Error ? err.message : "Une erreur est survenue.", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <div><PageHeader title="Affectations" description="Affectations du personnel" /><LoadingState /></div>;
  }
  if (error) {
    return <div><PageHeader title="Affectations" description="Affectations du personnel" /><ErrorState message={error} action={<Button variant="outline" size="sm" onClick={fetchAssignments}>Réessayer</Button>} /></div>;
  }

  return (
    <div>
      <PageHeader
        title="Affectations"
        description="Affectations du personnel aux directions et postes"
        action={canCreate && (
          <Button onClick={() => { setEditing(null); setFormOpen(true); }} disabled={staffOptions.length === 0 || deptOptions.length === 0}>
            <Plus className="w-4 h-4 mr-2" /> Nouvelle affectation
          </Button>
        )}
      />

      {staffOptions.length === 0 || deptOptions.length === 0 ? (
        <Card className="p-4 mb-4">
          <p className="text-sm text-muted-foreground">
            Vous devez créer au moins un membre du personnel et une direction avant d'effectuer une affectation.
          </p>
        </Card>
      ) : null}

      <Card className="p-4">
        {assignments.length === 0 ? (
          <EmptyState title="Aucune affectation" message="Aucune affectation enregistrée." action={canCreate && staffOptions.length > 0 && deptOptions.length > 0 && (
            <Button onClick={() => { setEditing(null); setFormOpen(true); }}><Plus className="w-4 h-4 mr-2" /> Ajouter</Button>
          )} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Personnel</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Poste</TableHead>
                  <TableHead>Début</TableHead>
                  <TableHead>Fin</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="w-[50px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((a) => {
                  const s = a.hr_staff;
                  const staffName = s ? staffDisplayName(s) : "—";
                  const isActive = !a.end_date;
                  return (
                    <TableRow key={a.id}>
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium">{staffName}</p>
                          <p className="text-xs text-muted-foreground">{s?.staff_number}</p>
                        </div>
                      </TableCell>
                      <TableCell>{a.hr_departments?.name ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{a.hr_positions?.name ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{new Date(a.start_date).toLocaleDateString("fr-FR")}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{a.end_date ? new Date(a.end_date).toLocaleDateString("fr-FR") : "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Badge variant={isActive ? "default" : "secondary"}>{isActive ? "En cours" : "Terminée"}</Badge>
                          {a.is_primary && <Badge variant="outline">Principale</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="w-4 h-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {canUpdate && <DropdownMenuItem onClick={() => { setEditing(a); setFormOpen(true); }}><Pencil className="w-4 h-4 mr-2" /> Modifier</DropdownMenuItem>}
                            {canDelete && <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(a)}><Trash2 className="w-4 h-4 mr-2" /> Supprimer</DropdownMenuItem>}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <AssignmentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        assignment={editing}
        staffOptions={staffOptions}
        deptOptions={deptOptions}
        posOptions={posOptions}
        onSaved={fetchAssignments}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette affectation ?</AlertDialogTitle>
            <AlertDialogDescription>Cette action est irréversible.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Supprimer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AssignmentFormDialog({
  open, onOpenChange, assignment, staffOptions, deptOptions, posOptions, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignment: Assignment | null;
  staffOptions: StaffOption[];
  deptOptions: DeptOption[];
  posOptions: PosOption[];
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [staffId, setStaffId] = useState("");
  const [deptId, setDeptId] = useState("");
  const [posId, setPosId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isPrimary, setIsPrimary] = useState(true);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setStaffId(assignment?.staff_id ?? "");
      setDeptId(assignment?.department_id ?? "");
      setPosId(assignment?.position_id ?? "");
      setStartDate(assignment?.start_date ?? new Date().toISOString().slice(0, 10));
      setEndDate(assignment?.end_date ?? "");
      setIsPrimary(assignment?.is_primary ?? true);
      setNotes(assignment?.notes ?? "");
    }
  }, [open, assignment]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffId || !deptId || !startDate) {
      toast({ title: "Champs requis", description: "Personnel, direction et date de début sont obligatoires.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        staff_id: staffId,
        department_id: deptId,
        position_id: posId || null,
        start_date: startDate,
        end_date: endDate || null,
        is_primary: isPrimary,
        notes: notes.trim() || null,
      };

      if (assignment) {
        const { error: err } = await supabase.from("hr_assignments").update(payload).eq("id", assignment.id);
        if (err) throw err;
        toast({ title: "Affectation mise à jour" });
      } else {
        const { error: err } = await supabase.from("hr_assignments").insert(payload);
        if (err) throw err;
        toast({ title: "Affectation créée" });
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Erreur", description: err instanceof Error ? err.message : "Une erreur est survenue.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{assignment ? "Modifier l'affectation" : "Nouvelle affectation"}</DialogTitle>
          <DialogDescription>Affectez un membre du personnel à une direction et un poste.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="asg-staff">Personnel *</Label>
            <Select value={staffId} onValueChange={setStaffId} disabled={saving}>
              <SelectTrigger id="asg-staff"><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
              <SelectContent>
                {staffOptions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {staffDisplayName(s)} ({s.staff_number})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="asg-dept">Direction / Service *</Label>
              <Select value={deptId} onValueChange={setDeptId} disabled={saving}>
                <SelectTrigger id="asg-dept"><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                <SelectContent>
                  {deptOptions.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="asg-pos">Poste</Label>
              <Select value={posId} onValueChange={setPosId} disabled={saving}>
                <SelectTrigger id="asg-pos"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {posOptions.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="asg-start">Date de début *</Label>
              <Input id="asg-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={saving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="asg-end">Date de fin</Label>
              <Input id="asg-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={saving} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="asg-primary" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} disabled={saving} className="rounded" />
            <Label htmlFor="asg-primary">Affectation principale</Label>
          </div>
          <div className="space-y-2">
            <Label htmlFor="asg-notes">Notes</Label>
            <Textarea id="asg-notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={saving} rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Annuler</Button>
            <Button type="submit" disabled={saving}>{saving ? "Enregistrement..." : assignment ? "Enregistrer" : "Créer"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
