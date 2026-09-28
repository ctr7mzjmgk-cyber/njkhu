"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingState } from "@/components/shared/loading-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase/client";
import {
  fetchSchoolCertificate,
  type SchoolCertificateData,
} from "@/lib/academic/school-certificate";
import { SchoolCertificateA4 } from "@/components/certificates/school-certificate-a4";
import { ArrowLeft, Download, Printer, Save, FileText } from "lucide-react";

type Student = { id: string; student_number: string; first_name: string | null; last_name: string | null };
type AcademicYear = { id: string; name: string; is_active: boolean };

export default function SchoolCertificatesPage() {
  const { permissions, profile } = useAuth();
  const { toast } = useToast();

  const [students, setStudents] = useState<Student[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [selectedStudent, setSelectedStudent] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [certData, setCertData] = useState<SchoolCertificateData | null>(null);
  const [generating, setGenerating] = useState(false);
  const [persisting, setPersisting] = useState(false);

  const canCreate = permissions.includes("certificates.create" as never);
  const canView = permissions.includes("certificates.view" as never) || canCreate;

  useEffect(() => {
    if (certData) {
      document.body.classList.add("school-cert-print-mode");
    } else {
      document.body.classList.remove("school-cert-print-mode");
    }

    return () => document.body.classList.remove("school-cert-print-mode");
  }, [certData]);

  useEffect(() => {
    if (profile?.institution_id) {
      supabase
        .from("academic_years")
        .select("id, name, is_active")
        .eq("institution_id", profile.institution_id)
        .order("start_date", { ascending: false })
        .then(({ data }) => {
          setAcademicYears(data ?? []);
          const active = data?.find((y) => y.is_active);
          if (active) setSelectedYear(active.id);
        });

      supabase
        .from("students")
        .select("id, student_number, first_name, last_name")
        .eq("institution_id", profile.institution_id)
        .order("student_number")
        .then(({ data }) => setStudents(data ?? []));
    }
  }, [profile?.institution_id]);

  const filteredStudents = students.filter((s) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      s.student_number.toLowerCase().includes(q) ||
      `${s.last_name ?? ""} ${s.first_name ?? ""}`.toLowerCase().includes(q)
    );
  });

  const handleGenerate = useCallback(async () => {
    if (!selectedStudent || !selectedYear) return;
    setGenerating(true);
    setLoading(true);
    try {
      const { data, error } = await fetchSchoolCertificate(selectedStudent, selectedYear);
      if (error) {
        toast({
          title: "Erreur de génération",
          description: error,
          variant: "destructive",
        });
        setCertData(null);
      } else if (!data) {
        toast({
          title: "Erreur",
          description: "Aucune donnée retournée par la base de données.",
          variant: "destructive",
        });
        setCertData(null);
      } else {
        setCertData(data);
      }
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Une erreur est survenue lors de la génération.",
        variant: "destructive",
      });
      setCertData(null);
    } finally {
      setGenerating(false);
      setLoading(false);
    }
  }, [selectedStudent, selectedYear, toast]);

  const handlePersist = async () => {
    if (!certData || !selectedStudent || !selectedYear) return;
    setPersisting(true);
    try {
      const { data, error } = await supabase.rpc("persist_school_certificate", {
        p_student_id: selectedStudent,
        p_academic_year_id: selectedYear,
        p_certificate_number: certData.certificate_number,
        p_qr_token: certData.qr_token,
        p_issue_date: certData.issue_date,
      });

      if (error) throw error;

      toast({
        title: "Certificat émis",
        description: `Numéro: ${certData.certificate_number}`,
      });
      setCertData(null);
      setSelectedStudent("");
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Émission impossible.",
        variant: "destructive",
      });
    } finally {
      setPersisting(false);
    }
  };

  if (!canView) {
    return (
      <div>
        <PageHeader title="Certificats de scolarité" />
        <Card className="p-6">
          <EmptyState title="Accès refusé" message="Vous n'avez pas la permission d'accéder à cette section." />
        </Card>
      </div>
    );
  }

  if (certData) {
    return (
      <div className="school-cert-screen-shell">
        <div className="school-cert-actions no-print">
          <Button variant="outline" size="sm" onClick={() => setCertData(null)}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Retour
          </Button>
          <div className="flex gap-2">
            {canCreate && (
              <Button size="sm" onClick={handlePersist} disabled={persisting}>
                <Save className="w-4 h-4 mr-2" /> {persisting ? "Émission..." : "Émettre officiellement"}
              </Button>
            )}
            <Button size="sm" onClick={() => window.print()}>
              <Printer className="w-4 h-4 mr-2" /> Imprimer
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Download className="w-4 h-4 mr-2" /> Télécharger PDF
            </Button>
          </div>
        </div>
        <SchoolCertificateA4 data={certData} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Certificats de scolarité"
        description="Générer et émettre un certificat de scolarité officiel au format A4"
      />

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_200px_auto] gap-3 items-end">
          <div className="space-y-2">
            <Label>Étudiant</Label>
            <Select value={selectedStudent} onValueChange={setSelectedStudent}>
              <SelectTrigger><SelectValue placeholder="Sélectionner un étudiant" /></SelectTrigger>
              <SelectContent>
                <div className="p-2">
                  <Input
                    placeholder="Rechercher..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="mb-2"
                  />
                </div>
                {filteredStudents.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.student_number} — {s.last_name ?? ""} {s.first_name ?? ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Année académique</Label>
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
              <SelectContent>
                {academicYears.map((ay) => (
                  <SelectItem key={ay.id} value={ay.id}>
                    {ay.name}{ay.is_active ? " (active)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={handleGenerate} disabled={!selectedStudent || !selectedYear || generating}>
            <FileText className="w-4 h-4 mr-2" /> {generating ? "Génération..." : "Générer"}
          </Button>
        </div>
      </Card>

      {!selectedStudent || !selectedYear ? (
        <Card className="p-6">
          <EmptyState
            title="Sélectionnez un étudiant et une année"
            message="Choisissez un étudiant et une année académique pour générer un certificat de scolarité."
          />
        </Card>
      ) : loading ? (
        <LoadingState message="Génération du certificat..." />
      ) : (
        <Card className="p-6">
          <EmptyState
            title="Prêt à générer"
            message="Cliquez sur « Générer » pour prévisualiser le certificat de scolarité au format A4."
          />
        </Card>
      )}
    </div>
  );
}
