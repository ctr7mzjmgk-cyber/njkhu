"use client";

import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { Database } from "@/lib/types/database";

type Module = Database["public"]["Tables"]["modules"]["Row"];
type Term = Database["public"]["Tables"]["terms"]["Row"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  module?: Module | null;
  programId: string;
  academicYearId?: string;
  onSaved?: () => void;
}

const TERM_TYPE_LABELS: Record<string, string> = {
  semester: "Semestre",
  trimester: "Trimestre",
  custom: "Période",
};

export function ModuleFormDialog({ open, onOpenChange, module, programId, academicYearId, onSaved }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [termId, setTermId] = useState("");
  const [semester, setSemester] = useState("1");
  const [orderIndex, setOrderIndex] = useState("0");
  const [terms, setTerms] = useState<(Term & { term_type: string })[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open && academicYearId) {
      supabase
        .from("terms")
        .select("*")
        .eq("academic_year_id", academicYearId)
        .order("start_date", { ascending: true })
        .then(({ data }) => setTerms(data ?? []));
    } else if (open && !academicYearId) {
      setTerms([]);
    }
  }, [open, academicYearId]);

  useEffect(() => {
    if (open) {
      setName(module?.name ?? "");
      setCode(module?.code ?? "");
      setTermId(module?.term_id ?? "");
      setSemester(String(module?.semester ?? "1"));
      setOrderIndex(String(module?.order_index ?? "0"));
      setErrors({});
    }
  }, [open, module]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Le nom est requis";
    if (!code.trim()) e.code = "Le code est requis";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const payload = {
        program_id: programId,
        name: name.trim(),
        code: code.trim(),
        term_id: termId || null,
        semester: parseInt(semester),
        order_index: parseInt(orderIndex),
      };

      if (module) {
        const { error } = await supabase
          .from("modules")
          .update(payload)
          .eq("id", module.id);
        if (error) throw error;
        toast({ title: "Module modifié" });
      } else {
        const { error } = await supabase.from("modules").insert(payload);
        if (error) throw error;
        toast({ title: "Module créé" });
      }
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Erreur", description: err instanceof Error ? err.message : "Une erreur est survenue.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{module ? "Modifier le module" : "Nouveau module"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mod-name">Nom *</Label>
              <Input id="mod-name" value={name} onChange={(e) => setName(e.target.value)} disabled={loading} autoFocus />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="mod-code">Code *</Label>
              <Input id="mod-code" value={code} onChange={(e) => setCode(e.target.value)} disabled={loading} />
              {errors.code && <p className="text-xs text-destructive">{errors.code}</p>}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mod-term">Période</Label>
            <Select value={termId} onValueChange={setTermId} disabled={loading || terms.length === 0}>
              <SelectTrigger id="mod-term"><SelectValue placeholder={terms.length === 0 ? "Aucune période définie" : "Sélectionner"} /></SelectTrigger>
              <SelectContent>
                {terms.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} ({TERM_TYPE_LABELS[t.term_type] ?? t.term_type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mod-semester">Numéro de période</Label>
              <Input id="mod-semester" type="number" min="1" max="10" value={semester} onChange={(e) => setSemester(e.target.value)} disabled={loading} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mod-order">Ordre</Label>
              <Input id="mod-order" type="number" min="0" value={orderIndex} onChange={(e) => setOrderIndex(e.target.value)} disabled={loading} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Annuler</Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {module ? "Enregistrer" : "Créer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
