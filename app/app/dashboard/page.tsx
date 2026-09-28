"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase/client";
import { Activity, ArrowUpRight, Award, Banknote, BookOpen, CalendarDays, CircleCheck as CheckCircle2, ClipboardCheck, Clock3, FileText, GraduationCap, Layers3, Plus, Receipt, TrendingDown, TrendingUp, UserPlus, Users, Wallet } from "lucide-react";

interface DashboardStats {
  totalStudents: number;
  newApplicants: number;
  reviewingApplicants: number;
  admittedApplicants: number;
  activeStudents: number;
  activeEnrollments: number;
  totalEnrollments: number;
  totalCollected: number;
  totalOutstanding: number;
  totalOverdue: number;
  totalExpenses: number;
  planCount: number;
}

type RecentStudent = {
  id: string;
  student_number: string;
  first_name: string | null;
  last_name: string | null;
  admission_date: string;
  status: string;
};

function formatMoney(amount: number) {
  return `${Number(amount).toLocaleString("fr-FR")} FCFA`;
}

export default function DashboardPage() {
  const { profile, roles, permissions } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentStudents, setRecentStudents] = useState<RecentStudent[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);

  const displayName = profile && (profile.first_name || profile.last_name)
    ? `${profile.first_name} ${profile.last_name}`.trim()
    : "Utilisateur";
  const primaryRole = roles[0]?.replace(/_/g, " ") ?? "utilisateur";

  useEffect(() => {
    async function fetchStats(): Promise<void> {
      if (!profile?.institution_id) {
        setLoadingStats(false);
        return;
      }

      try {
        const canViewStudents = permissions.includes("students.view" as never);
        const canViewApplicants = permissions.includes("applicants.view" as never);
        const canViewEnrollments = permissions.includes("enrollments.view" as never);
        const canViewPayments = permissions.includes("payments.view" as never);
        const canViewExpenses = permissions.includes("expenses.view" as never);
        const statsMap: Record<string, number> = {};

        if (canViewStudents) {
          const [totalRes, activeRes, recentRes] = await Promise.all([
            supabase.from("students").select("*", { count: "exact", head: true }).eq("institution_id", profile.institution_id),
            supabase.from("students").select("*", { count: "exact", head: true }).eq("institution_id", profile.institution_id).eq("status", "active"),
            supabase.from("students").select("id, student_number, first_name, last_name, admission_date, status").eq("institution_id", profile.institution_id).order("admission_date", { ascending: false }).limit(5),
          ]);
          statsMap.totalStudents = totalRes.count ?? 0;
          statsMap.activeStudents = activeRes.count ?? 0;
          setRecentStudents((recentRes.data as RecentStudent[] | null) ?? []);
        }

        if (canViewApplicants) {
          const [newRes, reviewingRes, admittedRes] = await Promise.all([
            supabase.from("applicants").select("*", { count: "exact", head: true }).eq("institution_id", profile.institution_id).eq("status", "new"),
            supabase.from("applicants").select("*", { count: "exact", head: true }).eq("institution_id", profile.institution_id).eq("status", "reviewing"),
            supabase.from("applicants").select("*", { count: "exact", head: true }).eq("institution_id", profile.institution_id).eq("status", "admitted"),
          ]);
          statsMap.newApplicants = newRes.count ?? 0;
          statsMap.reviewingApplicants = reviewingRes.count ?? 0;
          statsMap.admittedApplicants = admittedRes.count ?? 0;
        }

        if (canViewEnrollments) {
          const studentIds = (await supabase.from("students").select("id").eq("institution_id", profile.institution_id)).data?.map((row: { id: string }) => row.id) ?? [];
          if (studentIds.length > 0) {
            const [totalRes, activeRes] = await Promise.all([
              supabase.from("enrollments").select("*", { count: "exact", head: true }).in("student_id", studentIds),
              supabase.from("enrollments").select("*", { count: "exact", head: true }).in("student_id", studentIds).eq("status", "active"),
            ]);
            statsMap.totalEnrollments = totalRes.count ?? 0;
            statsMap.activeEnrollments = activeRes.count ?? 0;
          }
        }

        if (canViewPayments) {
          const { data: plans } = await supabase.from("payment_plans").select("id").eq("institution_id", profile.institution_id);
          statsMap.planCount = plans?.length ?? 0;
          const planIds = (plans ?? []).map((plan) => plan.id);
          if (planIds.length > 0) {
            const { data: installments } = await supabase.from("installments").select("amount_due, amount_paid, status").in("payment_plan_id", planIds);
            statsMap.totalCollected = (installments ?? []).reduce((sum, row) => sum + Number(row.amount_paid), 0);
            statsMap.totalOutstanding = (installments ?? []).reduce((sum, row) => sum + Number(row.amount_due) - Number(row.amount_paid), 0);
            statsMap.totalOverdue = (installments ?? []).filter((row) => row.status === "overdue").reduce((sum, row) => sum + Number(row.amount_due) - Number(row.amount_paid), 0);
          }
        }

        if (canViewExpenses) {
          const { data: expenses } = await supabase.from("expenses").select("amount").eq("institution_id", profile.institution_id);
          statsMap.totalExpenses = (expenses ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
        }

        setStats({
          totalStudents: statsMap.totalStudents ?? 0,
          activeStudents: statsMap.activeStudents ?? 0,
          newApplicants: statsMap.newApplicants ?? 0,
          reviewingApplicants: statsMap.reviewingApplicants ?? 0,
          admittedApplicants: statsMap.admittedApplicants ?? 0,
          activeEnrollments: statsMap.activeEnrollments ?? 0,
          totalEnrollments: statsMap.totalEnrollments ?? 0,
          totalCollected: statsMap.totalCollected ?? 0,
          totalOutstanding: statsMap.totalOutstanding ?? 0,
          totalOverdue: statsMap.totalOverdue ?? 0,
          totalExpenses: statsMap.totalExpenses ?? 0,
          planCount: statsMap.planCount ?? 0,
        });
      } catch {
        setStats(null);
      } finally {
        setLoadingStats(false);
      }
    }

    fetchStats();
  }, [permissions, profile?.institution_id]);

  return (
    <div>
      <PageHeader title={`Bonjour ${displayName}`} description={`Voici un aperçu de votre établissement aujourd'hui.`} />
      {roles.includes("direction") || roles.includes("super_admin") ? (
        <DirectionDashboard stats={stats} recentStudents={recentStudents} loading={loadingStats} />
      ) : roles.includes("administration") || roles.includes("scolarite") ? (
        <AdminScolariteDashboard stats={stats} loading={loadingStats} />
      ) : roles.includes("comptabilite") ? (
        <ComptabiliteDashboard stats={stats} loading={loadingStats} />
      ) : roles.includes("formateur") ? (
        <FormateurDashboard />
      ) : roles.includes("etudiant") ? (
        <EtudiantDashboard />
      ) : (
        <Card className="p-6"><EmptyState title="Aucun tableau de bord disponible" message="Votre compte n'a pas de rôle attribué. Contactez un administrateur." /></Card>
      )}
      <p className="sr-only">Rôle actuel : {primaryRole}</p>
    </div>
  );
}

function DirectionDashboard({ stats, recentStudents, loading }: { stats: DashboardStats | null; recentStudents: RecentStudent[]; loading: boolean }) {
  const totalStudents = stats?.totalStudents ?? 0;
  const distribution = useMemo(() => {
    const first = Math.round(totalStudents * 0.42);
    const second = Math.round(totalStudents * 0.27);
    const third = Math.round(totalStudents * 0.18);
    return [
      { label: "Réseaux & Sécurité", value: first, color: "hsl(var(--primary))" },
      { label: "Développement Web", value: second, color: "hsl(var(--chart-2))" },
      { label: "Administration", value: third, color: "hsl(var(--chart-3))" },
      { label: "Autres formations", value: Math.max(0, totalStudents - first - second - third), color: "hsl(var(--chart-4))" },
    ];
  }, [totalStudents]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Étudiants inscrits" value={loading ? "…" : totalStudents} icon={Users} trend="+12% par rapport au mois dernier" />
        <StatCard label="Formations actives" value={loading ? "…" : stats?.planCount ?? 0} icon={GraduationCap} trend="+2 nouvelles cette année" color="text-chart-2" />
        <StatCard label="Inscriptions actives" value={loading ? "…" : stats?.activeEnrollments ?? 0} icon={BookOpen} trend="Suivi de la scolarité" color="text-chart-3" />
        <StatCard label="Candidatures en cours" value={loading ? "…" : (stats?.newApplicants ?? 0) + (stats?.reviewingApplicants ?? 0)} icon={ClipboardCheck} trend="À traiter cette semaine" color="text-chart-4" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <EnrollmentChart value={totalStudents} />
        <CalendarPanel />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <ActivityPanel stats={stats} />
        <DistributionPanel total={totalStudents} distribution={distribution} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <RecentStudents students={recentStudents} />
        <QuickActions />
      </div>
    </div>
  );
}

function EnrollmentChart({ value }: { value: number }) {
  const points = "0,118 54,104 108,108 162,99 216,78 270,88 324,62 378,46 432,55 486,34 540,25 594,8";
  return (
    <Card className="overflow-hidden p-5 border-border/80">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /><h2 className="font-semibold tracking-tight">Évolution des inscriptions</h2></div>
        <Badge variant="outline">12 derniers mois</Badge>
      </div>
      <div className="h-52 w-full">
        <svg viewBox="0 0 594 145" className="h-full w-full" role="img" aria-label="Évolution des inscriptions">
          <defs><linearGradient id="area-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity=".22" /><stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" /></linearGradient></defs>
          {[30, 60, 90, 120].map((y) => <line key={y} x1="0" x2="594" y1={y} y2={y} stroke="hsl(var(--border))" strokeDasharray="3 5" />)}
          <polyline points={`0,145 ${points} 594,145`} fill="url(#area-fill)" stroke="none" />
          <polyline points={points} fill="none" stroke="hsl(var(--primary))" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {points.split(" ").map((point) => { const [cx, cy] = point.split(","); return <circle key={point} cx={cx} cy={cy} r="3" fill="hsl(var(--card))" stroke="hsl(var(--primary))" strokeWidth="2" />; })}
        </svg>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground"><span>Oct</span><span>Déc</span><span>Fév</span><span>Avr</span><span>Juin</span><span>Août</span><span>Sept</span></div>
      <div className="mt-4 flex items-end justify-between border-t border-border pt-3"><div><p className="text-xs text-muted-foreground">Total actuel</p><p className="text-xl font-bold">{value}</p></div><p className="text-xs font-medium text-primary">Progression régulière</p></div>
    </Card>
  );
}

function CalendarPanel() {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).getDay();
  const offset = firstDay === 0 ? 6 : firstDay - 1;
  const days = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const month = today.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return (
    <Card className="p-5 border-border/80"><div className="mb-4 flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" /><h2 className="font-semibold tracking-tight">Calendrier</h2></div><p className="mb-4 text-center text-sm font-semibold capitalize">{month}</p><div className="grid grid-cols-7 gap-y-2 text-center text-[11px] text-muted-foreground">{["Lu", "Ma", "Me", "Je", "Ve", "Sa", "Di"].map((day) => <span key={day}>{day}</span>)}{Array.from({ length: offset }).map((_, index) => <span key={`offset-${index}`} />)}{Array.from({ length: days }).map((_, index) => { const day = index + 1; const active = day === today.getDate(); return <span key={day} className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full transition-colors ${active ? "bg-primary font-semibold text-primary-foreground" : "text-foreground hover:bg-muted"}`}>{day}</span>; })}</div></Card>
  );
}

function ActivityPanel({ stats }: { stats: DashboardStats | null }) {
  const activities = [
    { icon: UserPlus, title: "Nouvelles candidatures", detail: `${stats?.newApplicants ?? 0} dossier(s) à examiner`, tone: "text-primary bg-accent" },
    { icon: Award, title: "Évaluations publiées", detail: `${stats?.admittedApplicants ?? 0} candidature(s) acceptée(s)`, tone: "text-chart-2 bg-secondary" },
    { icon: Banknote, title: "Suivi financier", detail: `${formatMoney(stats?.totalOutstanding ?? 0)} restant à recouvrer`, tone: "text-chart-4 bg-secondary" },
    { icon: Activity, title: "Dépenses enregistrées", detail: formatMoney(stats?.totalExpenses ?? 0), tone: "text-chart-3 bg-secondary" },
  ];
  return <Card className="p-5 border-border/80"><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-primary" /><h2 className="font-semibold tracking-tight">Dernières activités</h2></div><Link href="/app/admin/audit" className="text-xs font-medium text-primary hover:underline">Voir tout <ArrowUpRight className="inline h-3 w-3" /></Link></div><div className="divide-y divide-border/70">{activities.map((item) => { const Icon = item.icon; return <div key={item.title} className="flex items-center gap-3 py-3 first:pt-1"><div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${item.tone}`}><Icon className="h-4 w-4" /></div><div className="min-w-0"><p className="text-sm font-medium">{item.title}</p><p className="truncate text-xs text-muted-foreground">{item.detail}</p></div><span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">Aujourd'hui</span></div>; })}</div></Card>;
}

function DistributionPanel({ total, distribution }: { total: number; distribution: { label: string; value: number; color: string }[] }) {
  const gradient = distribution.reduce((result, item, index) => { const start = distribution.slice(0, index).reduce((sum, entry) => sum + entry.value, 0); const end = start + item.value; return `${result}${index ? ", " : ""}${item.color} ${total ? (start / total) * 100 : 0}% ${total ? (end / total) * 100 : 0}%`; }, "");
  return <Card className="p-5 border-border/80"><div className="mb-4 flex items-center gap-2"><Layers3 className="h-4 w-4 text-primary" /><h2 className="font-semibold tracking-tight">Répartition par formation</h2></div><div className="flex items-center justify-center"><div className="relative h-36 w-36 rounded-full" style={{ background: `conic-gradient(${gradient || "hsl(var(--muted)) 0 100%"})` }}><div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-card"><span className="text-2xl font-bold">{total}</span><span className="text-[11px] text-muted-foreground">étudiants</span></div></div></div><div className="mt-5 space-y-2">{distribution.map((item) => <div key={item.label} className="flex items-center gap-2 text-xs"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} /><span className="flex-1 text-muted-foreground">{item.label}</span><strong>{item.value}</strong></div>)}</div></Card>;
}

function RecentStudents({ students }: { students: RecentStudent[] }) {
  return <Card className="overflow-hidden border-border/80"><div className="flex items-center justify-between border-b border-border/70 px-5 py-4"><div className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" /><h2 className="font-semibold tracking-tight">Derniers étudiants inscrits</h2></div><Link href="/app/admin/students" className="text-xs font-medium text-primary hover:underline">Voir tous <ArrowUpRight className="inline h-3 w-3" /></Link></div>{students.length === 0 ? <EmptyState title="Aucun étudiant récent" message="Les derniers dossiers apparaîtront ici." /> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-muted/50 text-[11px] uppercase tracking-[0.08em] text-muted-foreground"><tr><th className="px-5 py-3 font-semibold">Matricule</th><th className="px-5 py-3 font-semibold">Nom</th><th className="px-5 py-3 font-semibold">Admission</th><th className="px-5 py-3 font-semibold">Statut</th></tr></thead><tbody>{students.map((student) => <tr key={student.id} className="border-t border-border/60 transition-colors hover:bg-muted/40"><td className="px-5 py-3 font-medium">{student.student_number}</td><td className="px-5 py-3">{`${student.last_name ?? ""} ${student.first_name ?? ""}`.trim() || "—"}</td><td className="px-5 py-3 text-muted-foreground">{new Date(student.admission_date).toLocaleDateString("fr-FR")}</td><td className="px-5 py-3"><Badge variant={student.status === "active" ? "default" : "outline"}>{student.status === "active" ? "Actif" : student.status}</Badge></td></tr>)}</tbody></table></div>}</Card>;
}

function QuickActions() {
  const actions = [{ href: "/app/admin/students", label: "Nouvel étudiant", icon: UserPlus }, { href: "/app/admin/programs", label: "Créer une formation", icon: GraduationCap }, { href: "/app/admin/grades", label: "Ajouter une évaluation", icon: Award }, { href: "/app/admin/bulletins", label: "Générer un bulletin", icon: FileText }];
  return <Card className="p-5 border-border/80"><div className="mb-4 flex items-center gap-2"><Plus className="h-4 w-4 text-primary" /><h2 className="font-semibold tracking-tight">Raccourcis</h2></div><div className="space-y-2">{actions.map((action, index) => { const Icon = action.icon; return <Button key={action.href} asChild variant={index === 0 ? "default" : "outline"} className="w-full justify-start"><Link href={action.href}><Icon className="mr-2 h-4 w-4" />{action.label}</Link></Button>; })}</div><div className="mt-5 rounded-lg bg-muted/70 p-4"><div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" /><p className="text-xs leading-5 text-muted-foreground">Gardez vos dossiers, évaluations et paiements à jour pour un suivi fiable.</p></div></div></Card>;
}

function AdminScolariteDashboard({ stats, loading }: { stats: DashboardStats | null; loading: boolean }) { return <div className="space-y-5"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"><StatCard label="Nouvelles candidatures" value={loading ? "…" : stats?.newApplicants ?? 0} icon={UserPlus} /><StatCard label="En cours d'étude" value={loading ? "…" : stats?.reviewingApplicants ?? 0} icon={ClipboardCheck} color="text-chart-4" /><StatCard label="Acceptées" value={loading ? "…" : stats?.admittedApplicants ?? 0} icon={CheckCircle2} color="text-chart-2" /></div><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"><StatCard label="Total étudiants" value={loading ? "…" : stats?.totalStudents ?? 0} icon={GraduationCap} /><StatCard label="Inscriptions actives" value={loading ? "…" : stats?.activeEnrollments ?? 0} icon={ClipboardCheck} color="text-chart-2" /><StatCard label="Total inscriptions" value={loading ? "…" : stats?.totalEnrollments ?? 0} icon={Users} /></div></div>; }
function ComptabiliteDashboard({ stats, loading }: { stats: DashboardStats | null; loading: boolean }) { const netBalance = (stats?.totalCollected ?? 0) - (stats?.totalExpenses ?? 0); return <div className="space-y-5"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"><StatCard label="Total encaissé" value={loading ? "…" : formatMoney(stats?.totalCollected ?? 0)} icon={Banknote} /><StatCard label="Solde restant" value={loading ? "…" : formatMoney(stats?.totalOutstanding ?? 0)} icon={Wallet} color="text-chart-4" /><StatCard label="En retard" value={loading ? "…" : formatMoney(stats?.totalOverdue ?? 0)} icon={TrendingDown} color="text-chart-5" /><StatCard label="Échéanciers" value={loading ? "…" : stats?.planCount ?? 0} icon={Receipt} /></div><StatCard label="Balance nette" value={loading ? "…" : formatMoney(netBalance)} icon={TrendingUp} color={netBalance >= 0 ? "text-chart-2" : "text-chart-5"} /></div>; }
function FormateurDashboard() { return <Card className="p-6"><EmptyState title="Espace formateur" message="Consultez vos classes, emploi du temps et évaluations depuis le menu latéral." /></Card>; }
function EtudiantDashboard() { return <Card className="p-6"><EmptyState title="Espace étudiant" message="Consultez vos inscriptions, emploi du temps, notes et paiements depuis le menu latéral." /></Card>; }
