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
import { Plus, Search, MoreHorizontal, Pencil, Trash2, Building2 } from "lucide-react";

type Dept = Database["public"]["Tables"]["hr_departments"]["Row"];

const LEVEL_LABELS: Record<number, string> = {
  1: "Direction générale",
  2: "Sous-direction",
  3: "Service",
  4: "Unité",
  5: "Cellule",
};

export default function DepartmentsPage() {
  const { permissions, profile } = useAuth();
  const { toast } = useToast();

  const [departments, setDepartments] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Dept | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Dept | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canCreate = permissions.includes("hr.create" as never);
  const canUpdate = permissions.includes("hr.update" as never);
  const canDelete = permissions.includes("hr.delete" as never);

  const fetchDepartments = useCallback(async () => {
    if (!profile?.institution_id) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("hr_departments")
        .select("*")
        .eq("institution_id", profile.institution_id)
        .order("level", { ascending: true })
        .order("name", { ascending: true });
      if (err) throw err;
      setDepartments(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  }, [profile?.institution_id]);

  useEffect(() => { fetchDepartments(); }, [fetchDepartments]);

  const filtered = departments.filter((d) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return d.name.toLowerCase().includes(q) || d.code.toLowerCase().includes(q);
  });

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error: err } = await supabase.from("hr_departments").delete().eq("id", deleteTarget.id);
      if (err) throw err;
      toast({ title: "Direction/Service supprimé" });
      setDeleteTarget(null);
      fetchDepartments();
    } catch (err) {
      toast({ title: "Erreur", description: err instanceof Error ? err.message : "Une erreur est survenue.", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <div><PageHeader title="Directions & Services" description="Organigramme hiérarchique" /><LoadingState /></div>;
  }
  if (error) {
    return <div><PageHeader title="Directions & Services" description="Organigramme hiérarchique" /><ErrorState message={error} action={<Button variant="outline" size="sm" onClick={fetchDepartments}>Réessayer</Button>} /></div>;
  }

  return (
    <div>
      <PageHeader
        title="Directions & Services"
        description="Gestion de l'organigramme hiérarchique"
        action={canCreate && (
          <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" /> Nouvelle direction
          </Button>
        )}
      />

      <Card className="p-4">
        <div className="flex gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Rechercher par nom ou code..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState title="Aucune direction" message="Créez votre première direction ou service." action={canCreate && (
            <Button onClick={() => { setEditing(null); setFormOpen(true); }}><Plus className="w-4 h-4 mr-2" /> Ajouter</Button>
          )} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Niveau</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Nom</TableHead>
                  <TableHead>Parent</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="w-[50px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => {
                  const parent = departments.find((p) => p.id === d.parent_id);
                  return (
                    <TableRow key={d.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">N{d.level}</span>
                          <Badge variant="outline">{LEVEL_LABELS[d.level] ?? `Niveau ${d.level}`}</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{d.code}</TableCell>
                      <TableCell>
                        <span style={{ paddingLeft: `${(d.level - 1) * 16}px` }}>{d.name}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{parent?.name ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={d.is_active ? "default" : "secondary"}>
                          {d.is_active ? "Actif" : "Inactif"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="w-4 h-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {canUpdate && <DropdownMenuItem onClick={() => { setEditing(d); setFormOpen(true); }}><Pencil className="w-4 h-4 mr-2" /> Modifier</DropdownMenuItem>}
                            {canDelete && <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(d)}><Trash2 className="w-4 h-4 mr-2" /> Supprimer</DropdownMenuItem>}
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

      <DepartmentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        department={editing}
        departments={departments}
        institutionId={profile?.institution_id ?? ""}
        onSaved={fetchDepartments}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette direction ?</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer « {deleteTarget?.name} » ? Les sous-directions seront détachées.
            </AlertDialogDescription>
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

function DepartmentFormDialog({
  open, onOpenChange, department, departments, institutionId, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  department: Dept | null;
  departments: Dept[];
  institutionId: string;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (open) {
      setCode(department?.code ?? "");
      setName(department?.name ?? "");
      setParentId(department?.parent_id ?? "none");
      setDescription(department?.description ?? "");
      setIsActive(department?.is_active ?? true);
    }
  }, [open, department]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim()) {
      toast({ title: "Champs requis", description: "Le code et le nom sont obligatoires.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        institution_id: institutionId,
        code: code.trim(),
        name: name.trim(),
        parent_id: parentId && parentId !== "none" ? parentId : null,
        description: description.trim() || null,
        is_active: isActive,
      };

      if (department) {
        const { error: err } = await supabase.from("hr_departments").update(payload).eq("id", department.id);
        if (err) throw err;
        toast({ title: "Direction mise à jour" });
      } else {
        const { error: err } = await supabase.from("hr_departments").insert(payload);
        if (err) throw err;
        toast({ title: "Direction créée" });
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Erreur", description: err instanceof Error ? err.message : "Une erreur est survenue.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const parentOptions = departments.filter((d) => d.id !== department?.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{department ? "Modifier la direction" : "Nouvelle direction"}</DialogTitle>
          <DialogDescription>Créez une direction, sous-direction ou service.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="dept-code">Code *</Label>
              <Input id="dept-code" value={code} onChange={(e) => setCode(e.target.value)} disabled={saving} placeholder="DG, SD-FIN, SER-RH..." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dept-name">Nom *</Label>
              <Input id="dept-name" value={name} onChange={(e) => setName(e.target.value)} disabled={saving} placeholder="Direction Générale" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dept-parent">Rattachement (parent)</Label>
            <Select value={parentId} onValueChange={setParentId} disabled={saving}>
              <SelectTrigger id="dept-parent"><SelectValue placeholder="Aucun (niveau racine)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Aucun (niveau racine)</SelectItem>
                {parentOptions.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Le niveau est calculé automatiquement selon le parent.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dept-desc">Description</Label>
            <Textarea id="dept-desc" value={description} onChange={(e) => setDescription(e.target.value)} disabled={saving} rows={3} />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="dept-active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} disabled={saving} className="rounded" />
            <Label htmlFor="dept-active">Actif</Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Annuler</Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Enregistrement..." : department ? "Enregistrer" : "Créer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
