"use client";

import { useState, useEffect, useCallback } from "react";
import { useStudentData } from "@/lib/hooks/use-student-data";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingState } from "@/components/shared/loading-state";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/types/database";
import { computeClassBulletins, getMention, type StudentBulletinData, type BulletinContext } from "@/lib/academic/bulletin-engine";
import { PrintableBulletin } from "@/components/academic/printable-bulletin";
import { Award, FileText } from "lucide-react";

type Term = Database["public"]["Tables"]["terms"]["Row"];

const TERM_TYPE_LABELS: Record<string, string> = {
  semester: "Semestre",
  trimester: "Trimestre",
  custom: "Période",
};

export default function StudentBulletinsPage() {
  const { student, enrollments, loading: studentLoading } = useStudentData();
  const [selectedEnrollment, setSelectedEnrollment] = useState("");
  const [terms, setTerms] = useState<Term[]>([]);
  const [selectedTerm, setSelectedTerm] = useState("all");
  const [bulletin, setBulletin] = useState<StudentBulletinData | null>(null);
  const [context, setContext] = useState<BulletinContext | null>(null);
  const [loading, setLoading] = useState(false);

  const activeEnrollments = enrollments.filter((e) => e.status === "active");

  useEffect(() => {
    if (activeEnrollments.length > 0 && !selectedEnrollment) {
      setSelectedEnrollment(activeEnrollments[0].id);
    }
  }, [activeEnrollments, selectedEnrollment]);

  const currentEnrollment = activeEnrollments.find((e) => e.id === selectedEnrollment);

  useEffect(() => {
    if (currentEnrollment?.academic_year_id) {
      supabase
        .from("terms")
        .select("*")
        .eq("academic_year_id", currentEnrollment.academic_year_id)
        .order("start_date", { ascending: true })
        .then(({ data }) => setTerms(data ?? []));
    } else {
      setTerms([]);
    }
    setSelectedTerm("all");
  }, [currentEnrollment?.academic_year_id]);

  const compute = useCallback(async () => {
    if (!currentEnrollment?.class_id || !currentEnrollment?.academic_year_id || !student) return;
    setLoading(true);
    try {
      const { bulletins, context: ctx } = await computeClassBulletins(
        currentEnrollment.class_id,
        currentEnrollment.academic_year_id,
        selectedTerm
      );
      const myBulletin = bulletins.find((b) => b.student.id === student.id) ?? null;
      setBulletin(myBulletin);
      setContext(ctx);
    } catch {
      setBulletin(null);
      setContext(null);
    } finally {
      setLoading(false);
    }
  }, [currentEnrollment?.class_id, currentEnrollment?.academic_year_id, selectedTerm, student]);

  useEffect(() => {
    if (currentEnrollment && student) {
      compute();
    } else {
      setBulletin(null);
      setContext(null);
    }
  }, [compute, currentEnrollment, student]);

  if (studentLoading) {
    return <div><PageHeader title="Mes bulletins" /><LoadingState /></div>;
  }

  if (activeEnrollments.length === 0) {
    return (
      <div>
        <PageHeader title="Mes bulletins" description="Synthèse de mes résultats par module" />
        <Card className="p-6">
          <EmptyState title="Aucune inscription active" message="Vous n'êtes inscrit à aucune formation active pour le moment." />
        </Card>
      </div>
    );
  }

  if (bulletin && context) {
    return <PrintableBulletin bulletin={bulletin} context={context} onBack={() => setBulletin(null)} />;
  }

  return (
    <div>
      <PageHeader title="Mes bulletins" description="Synthèse de mes résultats par module et période" />

      <Card className="p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <Select value={selectedEnrollment} onValueChange={setSelectedEnrollment}>
            <SelectTrigger className="w-full sm:w-[300px]">
              <SelectValue placeholder="Sélectionner une formation" />
            </SelectTrigger>
            <SelectContent>
              {activeEnrollments.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.courses?.name ?? "Formation"} — {e.classes?.name ?? "—"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedTerm} onValueChange={setSelectedTerm} disabled={terms.length === 0}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="Annuel" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Annuel (toutes périodes)</SelectItem>
              {terms.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name} ({TERM_TYPE_LABELS[t.term_type] ?? t.term_type})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {loading ? (
        <LoadingState message="Calcul de votre bulletin..." />
      ) : !bulletin ? (
        <Card className="p-6">
          <EmptyState title="Aucun bulletin disponible" message="Aucun bulletin disponible pour cette période. Vos bulletins apparaîtront dès que des notes seront publiées." />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Award className="w-4 h-4 text-primary" />
                <span className="text-sm text-muted-foreground">Moyenne générale</span>
              </div>
              <p className="text-2xl font-bold">{bulletin.generalAverage.toFixed(2)} / 20</p>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Award className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Moyenne de classe</span>
              </div>
              <p className="text-2xl font-bold text-muted-foreground">{bulletin.classAverage.toFixed(2)} / 20</p>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Award className="w-4 h-4 text-primary" />
                <span className="text-sm text-muted-foreground">Rang</span>
              </div>
              <p className="text-2xl font-bold">
                {bulletin.rank === 0 ? "Non classé" : bulletin.rank === 1 ? "1er" : `${bulletin.rank}e`}
                <span className="text-sm font-normal text-muted-foreground"> / {bulletin.totalStudents}</span>
              </p>
            </Card>
          </div>

          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Résumé par module</h3>
              <Button size="sm" variant="outline" onClick={() => window.print()}>
                <FileText className="w-4 h-4 mr-1" /> Imprimer
              </Button>
            </div>
            <div className="space-y-3">
              {bulletin.modules.map((mod) => (
                <div key={mod.moduleId} className="p-3 rounded-lg border">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-sm font-medium">{mod.moduleName}</p>
                      {mod.moduleCode && <p className="text-xs text-muted-foreground">{mod.moduleCode}</p>}
                    </div>
                    <Badge variant="outline">{mod.moduleAverage.toFixed(2)} / 20</Badge>
                  </div>
                  <div className="space-y-1">
                    {mod.subjects.map((s) => (
                      <div key={s.subjectId} className="flex items-center justify-between text-sm pl-4">
                        <span className="text-muted-foreground">
                          {s.subjectName}
                          <span className="text-xs ml-1">(coef. {s.coefficient})</span>
                        </span>
                        <span className="font-medium">{s.average.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 p-3 rounded-lg bg-primary/10 flex items-center justify-between">
              <span className="text-sm font-medium">Mention</span>
              <Badge variant={
                bulletin.generalAverage >= 16 ? "default" :
                bulletin.generalAverage >= 14 ? "secondary" :
                bulletin.generalAverage >= 12 ? "secondary" :
                bulletin.generalAverage >= 10 ? "outline" : "destructive"
              }>
                {getMention(bulletin.generalAverage)}
              </Badge>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
