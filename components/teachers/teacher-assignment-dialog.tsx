"use client";

import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader as Loader2, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Subject = { id: string; name: string; code: string };
type ClassRow = { id: string; name: string };

interface TeacherAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teacherId: string;
  institutionId: string;
  onSaved?: () => void;
}

export function TeacherAssignmentDialog({ open, onOpenChange, teacherId, institutionId, onSaved }: TeacherAssignmentDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [classId, setClassId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && institutionId) {
      Promise.all([
        supabase.from("subjects").select("id, name, code").order("name"),
        supabase.from("classes").select("id, name").eq("institution_id", institutionId).order("name"),
      ]).then(([subjRes, classRes]) => {
        setSubjects(subjRes.data ?? []);
        setClasses(classRes.data ?? []);
      });
    }
    setSubjectId("");
    setClassId("");
    setError(null);
  }, [open, institutionId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjectId || !classId) { setError("Veuillez sélectionner une matière et une classe."); return; }
    setLoading(true);
    setError(null);
    try {
      const { error: insertError } = await supabase.from("teacher_assignments").insert({
        teacher_id: teacherId, subject_id: subjectId, class_id: classId, institution_id: institutionId,
      });
      if (insertError) {
        if (insertError.code === "23505") throw new Error("Cette affectation existe déjà.");
        throw insertError;
      }
      toast({ title: "Affectation créée", description: "Le formateur a été affecté à la matière et la classe." });
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Nouvelle affectation</DialogTitle>
          <DialogDescription>Affectez le formateur à une matière et une classe précises.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="assign-subject">Matière *</Label>
            <Select value={subjectId} onValueChange={setSubjectId} disabled={loading}>
              <SelectTrigger id="assign-subject"><SelectValue placeholder="Sélectionner une matière" /></SelectTrigger>
              <SelectContent>
                {subjects.map((s) => (<SelectItem key={s.id} value={s.id}>{s.name} ({s.code})</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="assign-class">Classe *</Label>
            <Select value={classId} onValueChange={setClassId} disabled={loading}>
              <SelectTrigger id="assign-class"><SelectValue placeholder="Sélectionner une classe" /></SelectTrigger>
              <SelectContent>
                {classes.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Annuler</Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Plus className="w-4 h-4 mr-2" /> Affecter
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
