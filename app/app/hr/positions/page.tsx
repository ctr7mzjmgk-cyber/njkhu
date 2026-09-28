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
import { Plus, Search, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

type Position = Database["public"]["Tables"]["hr_positions"]["Row"];
type Dept = Database["public"]["Tables"]["hr_departments"]["Row"];

const CATEGORIES = [
  { value: "administratif", label: "Administratif" },
  { value: "technique", label: "Technique" },
  { value: "support", label: "Support" },
  { value: "direction", label: "Direction" },
  { value: "pedagogique", label: "Pédagogique" },
];

export default function PositionsPage() {
  const { permissions, profile } = useAuth();
  const { toast } = useToast();

  const [positions, setPositions] = useState<(Position & { hr_departments: { name: string } | null })[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Position | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Position | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canCreate = permissions.includes("hr.create" as never);
  const canUpdate = permissions.includes("hr.update" as never);
  const canDelete = permissions.includes("hr.delete" as never);

  const fetchDepartments = useCallback(async () => {
    if (!profile?.institution_id) return;
    const { data } = await supabase
      .from("hr_departments")
      .select("*")
      .eq("institution_id", profile.institution_id)
      .eq("is_active", true)
      .order("name", { ascending: true });
    setDepartments((data as Dept[]) ?? []);
  }, [profile?.institution_id]);

  const fetchPositions = useCallback(async () => {
    if (!profile?.institution_id) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("hr_positions")
        .select("*, hr_departments(name)")
        .eq("institution_id", profile.institution_id)
        .order("name", { ascending: true });
      if (err) throw err;
      setPositions((data as (Position & { hr_departments: { name: string } | null })[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  }, [profile?.institution_id]);

  useEffect(() => {
    fetchDepartments();
    fetchPositions();
  }, [fetchDepartments, fetchPositions]);

  const filtered = positions.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || (p.category ?? "").toLowerCase().includes(q) || (p.hr_departments?.name ?? "").toLowerCase().includes(q);
  });

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error: err } = await supabase.from("hr_positions").delete().eq("id", deleteTarget.id);
      if (err) throw err;
      toast({ title: "Poste supprimé" });
      setDeleteTarget(null);
      fetchPositions();
    } catch (err) {
      toast({ title: "Erreur", description: err instanceof Error ? err.message : "Une erreur est survenue.", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <div><PageHeader title="Postes & Fonctions" description="Gestion des postes" /><LoadingState /></div>;
  }
  if (error) {
    return <div><PageHeader title="Postes & Fonctions" description="Gestion des postes" /><ErrorState message={error} action={<Button variant="outline" size="sm" onClick={fetchPositions}>Réessayer</Button>} /></div>;
  }

  return (
    <div>
      <PageHeader
        title="Postes & Fonctions"
        description="Gestion des postes et fonctions rattachés aux structures"
        action={canCreate && (
          <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" /> Nouveau poste
          </Button>
        )}
      />

      <Card className="p-4">
        <div className="flex gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Rechercher par nom, code, catégorie ou structure..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState title="Aucun poste" message="Créez votre premier poste ou fonction." action={canCreate && (
            <Button onClick={() => { setEditing(null); setFormOpen(true); }}><Plus className="w-4 h-4 mr-2" /> Ajouter</Button>
          )} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Nom</TableHead>
                  <TableHead>Structure</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="w-[50px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.code}</TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell className="text-muted-foreground">{p.hr_departments?.name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{p.category ?? "—"}</TableCell>
                    <TableCell><Badge variant={p.is_active ? "default" : "secondary"}>{p.is_active ? "Actif" : "Inactif"}</Badge></TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="w-4 h-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canUpdate && <DropdownMenuItem onClick={() => { setEditing(p); setFormOpen(true); }}><Pencil className="w-4 h-4 mr-2" /> Modifier</DropdownMenuItem>}
                          {canDelete && <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(p)}><Trash2 className="w-4 h-4 mr-2" /> Supprimer</DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <PositionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        position={editing}
        departments={departments}
        institutionId={profile?.institution_id ?? ""}
        onSaved={fetchPositions}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce poste ?</AlertDialogTitle>
            <AlertDialogDescription>Êtes-vous sûr de vouloir supprimer « {deleteTarget?.name} » ?</AlertDialogDescription>
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

function PositionFormDialog({
  open, onOpenChange, position, departments, institutionId, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: Position | null;
  departments: Dept[];
  institutionId: string;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [departmentId, setDepartmentId] = useState("none");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (open) {
      setCode(position?.code ?? "");
      setName(position?.name ?? "");
      setDepartmentId(position?.department_id ?? "none");
      setCategory(position?.category ?? "");
      setDescription(position?.description ?? "");
      setIsActive(position?.is_active ?? true);
    }
  }, [open, position]);

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
        department_id: departmentId && departmentId !== "none" ? departmentId : null,
        category: category || null,
        description: description.trim() || null,
        is_active: isActive,
      };

      if (position) {
        const { error: err } = await supabase.from("hr_positions").update(payload).eq("id", position.id);
        if (err) throw err;
        toast({ title: "Poste mis à jour" });
      } else {
        const { error: err } = await supabase.from("hr_positions").insert(payload);
        if (err) throw err;
        toast({ title: "Poste créé" });
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
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{position ? "Modifier le poste" : "Nouveau poste"}</DialogTitle>
          <DialogDescription>Définissez un poste et rattachez-le à une structure.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pos-code">Code *</Label>
              <Input id="pos-code" value={code} onChange={(e) => setCode(e.target.value)} disabled={saving} placeholder="DIR, SEC, AGC..." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pos-name">Nom *</Label>
              <Input id="pos-name" value={name} onChange={(e) => setName(e.target.value)} disabled={saving} placeholder="Directeur Général" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pos-dept">Structure de rattachement</Label>
            <Select value={departmentId} onValueChange={setDepartmentId} disabled={saving}>
              <SelectTrigger id="pos-dept"><SelectValue placeholder="Aucune (niveau institution)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Aucune (niveau institution)</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Le poste apparaîtra dans cette structure dans l'organigramme. Un poste sans structure reste visible au niveau institutionnel.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pos-cat">Catégorie</Label>
            <Input id="pos-cat" value={category} onChange={(e) => setCategory(e.target.value)} disabled={saving} placeholder="administratif, technique, support..." />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pos-desc">Description</Label>
            <Textarea id="pos-desc" value={description} onChange={(e) => setDescription(e.target.value)} disabled={saving} rows={3} />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="pos-active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} disabled={saving} className="rounded" />
            <Label htmlFor="pos-active">Actif</Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Annuler</Button>
            <Button type="submit" disabled={saving}>{saving ? "Enregistrement..." : position ? "Enregistrer" : "Créer"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
