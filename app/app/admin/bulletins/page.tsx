"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingState } from "@/components/shared/loading-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/lib/supabase/client";
import {
  computeClassBulletins,
  getMention,
  type BulletinContext,
  type StudentBulletinData,
} from "@/lib/academic/bulletin-engine";
import { PrintableBulletin } from "@/components/academic/printable-bulletin";
import { FileText } from "lucide-react";

const TERM_TYPE_LABELS: Record<string, string> = {
  semester: "Semestre",
  trimester: "Trimestre",
  custom: "Période",
};

export default function BulletinsPage() {
  const { permissions, profile } = useAuth();
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [academicYears, setAcademicYears] = useState<{ id: string; name: string }[]>([]);
  const [terms, setTerms] = useState<{ id: string; name: string; term_type: string }[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedTerm, setSelectedTerm] = useState("all");
  const [bulletins, setBulletins] = useState<StudentBulletinData[]>([]);
  const [context, setContext] = useState<BulletinContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasComputed, setHasComputed] = useState(false);
  const [selectedBulletin, setSelectedBulletin] = useState<StudentBulletinData | null>(null);

  const canView = permissions.includes("grades.view" as never) || permissions.includes("grades.validate" as never);

  useEffect(() => {
    if (profile?.institution_id) {
      supabase.from("classes").select("id, name").eq("institution_id", profile.institution_id).order("name")
        .then(({ data }) => setClasses(data ?? []));
      supabase.from("academic_years").select("id, name").eq("institution_id", profile.institution_id).order("start_date", { ascending: false })
        .then(({ data }) => setAcademicYears(data ?? []));
    }
  }, [profile?.institution_id]);

  useEffect(() => {
    if (selectedYear) {
      supabase.from("terms").select("id, name, term_type").eq("academic_year_id", selectedYear).order("start_date")
        .then(({ data }) => setTerms(data ?? []));
    } else {
      setTerms([]);
    }
    setSelectedTerm("all");
  }, [selectedYear]);

  const computeBulletins = useCallback(async () => {
    if (!selectedClass || !selectedYear) return;
    setLoading(true);
    setHasComputed(true);
    try {
      const { bulletins: results, context: ctx } = await computeClassBulletins(selectedClass, selectedYear, selectedTerm);
      setBulletins(results);
      setContext(ctx);
    } catch {
      setBulletins([]);
      setContext(null);
    } finally {
      setLoading(false);
    }
  }, [selectedClass, selectedYear, selectedTerm]);

  useEffect(() => {
    if (selectedClass && selectedYear) {
      computeBulletins();
    } else {
      setBulletins([]);
      setHasComputed(false);
    }
  }, [computeBulletins, selectedClass, selectedYear]);

  if (!canView) {
    return <div><PageHeader title="Bulletins" /><Card className="p-6"><EmptyState title="Accès refusé" message="Vous n'avez pas la permission d'accéder à cette section." /></Card></div>;
  }

  if (selectedBulletin && context) {
    return <PrintableBulletin bulletin={selectedBulletin} context={context} onBack={() => setSelectedBulletin(null)} />;
  }

  return (
    <div>
      <PageHeader title="Bulletins" description="Calcul des moyennes et classement" />

      <Card className="p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <Select value={selectedClass} onValueChange={setSelectedClass}>
            <SelectTrigger className="w-full sm:w-[200px]"><SelectValue placeholder="Sélectionner une classe" /></SelectTrigger>
            <SelectContent>
              {classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-full sm:w-[200px]"><SelectValue placeholder="Année académique" /></SelectTrigger>
            <SelectContent>
              {academicYears.map((ay) => <SelectItem key={ay.id} value={ay.id}>{ay.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={selectedTerm} onValueChange={setSelectedTerm} disabled={!selectedYear}>
            <SelectTrigger className="w-full sm:w-[200px]"><SelectValue placeholder="Toutes les périodes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Annuel (toutes périodes)</SelectItem>
              {terms.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name} ({TERM_TYPE_LABELS[t.term_type] ?? t.term_type})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {!selectedClass || !selectedYear ? (
        <Card className="p-4">
          <EmptyState title="Sélectionnez une classe et une année" message="Choisissez une classe et une année académique pour calculer les bulletins." />
        </Card>
      ) : loading ? (
        <LoadingState message="Calcul des moyennes..." />
      ) : bulletins.length === 0 ? (
        <Card className="p-4">
          <EmptyState title="Aucun bulletin disponible" message="Aucun bulletin disponible pour cette période. Aucune note publiée ou validée n'a été trouvée pour les critères sélectionnés." />
        </Card>
      ) : (
        <Card className="p-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rang</TableHead>
                  <TableHead>Matricule</TableHead>
                  <TableHead>Nom</TableHead>
                  <TableHead>Moyenne /20</TableHead>
                  <TableHead>Moyenne de classe</TableHead>
                  <TableHead>Mention</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {bulletins.map((b) => (
                  <TableRow key={b.student.id}>
                    <TableCell>
                      <Badge variant={b.rank === 1 ? "default" : "outline"}>{b.rank === 0 ? "—" : b.rank === 1 ? "1er" : `${b.rank}e`}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{b.student.student_number}</TableCell>
                    <TableCell className="text-muted-foreground">{`${b.student.last_name ?? ""} ${b.student.first_name ?? ""}`.trim() || "—"}</TableCell>
                    <TableCell className="font-bold">{b.generalAverage.toFixed(2)}</TableCell>
                    <TableCell className="text-muted-foreground">{b.classAverage.toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant={b.generalAverage >= 16 ? "default" : b.generalAverage >= 14 ? "secondary" : b.generalAverage >= 12 ? "secondary" : b.generalAverage >= 10 ? "outline" : "destructive"}>
                        {getMention(b.generalAverage)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => setSelectedBulletin(b)}>
                        <FileText className="w-4 h-4 mr-1" /> Bulletin
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
