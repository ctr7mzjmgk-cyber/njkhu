"use client";

import { ArrowLeft, Award, GraduationCap, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getMention, type BulletinContext, type StudentBulletinData } from "@/lib/academic/bulletin-engine";

interface PrintableBulletinProps {
  bulletin: StudentBulletinData;
  context: BulletinContext;
  onBack?: () => void;
}

const MODULE_TONES = [
  { shell: "border-blue-300 bg-blue-50/70", heading: "bg-blue-100 text-blue-900" },
  { shell: "border-emerald-300 bg-emerald-50/70", heading: "bg-emerald-100 text-emerald-900" },
  { shell: "border-orange-300 bg-orange-50/70", heading: "bg-orange-100 text-orange-900" },
  { shell: "border-sky-300 bg-sky-50/70", heading: "bg-sky-100 text-sky-900" },
];

function formatScore(value: number): string {
  return value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("fr-FR") : "—";
}

export function PrintableBulletin({ bulletin, context, onBack }: PrintableBulletinProps) {
  const institution = context.institution;
  const studentName = `${bulletin.student.last_name ?? ""} ${bulletin.student.first_name ?? ""}`.trim() || "Étudiant";
  const logoUrl = institution?.logo_url ?? null;
  const signatureUrl = institution?.signature_url ?? null;
  const stampUrl = institution?.stamp_url ?? null;

  return (
    <div className="bulletin-screen-shell">
      <div className="no-print mb-4 flex items-center justify-between gap-3">
        {onBack ? (
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Retour
          </Button>
        ) : <span />}
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" /> Imprimer / PDF
        </Button>
      </div>

      <article className="bulletin-paper mx-auto bg-white text-slate-900 print-color-exact">
        {/* ── En-tête ── */}
        <header className="border-b-[3px] border-blue-700 pb-3">
          <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[1fr_auto] sm:gap-5">
            <div className="flex min-w-0 items-center gap-4">
              <div className="bulletin-logo-frame">
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo de l'établissement" className="h-full w-full object-contain" />
                ) : (
                  <GraduationCap className="h-12 w-12 text-blue-800" />
                )}
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-extrabold uppercase leading-tight tracking-tight text-blue-900 sm:text-2xl">
                  {institution?.name ?? "Établissement"}
                </h1>
                {institution?.motto && (
                  <p className="mt-1 text-sm italic text-blue-800">{institution.motto}</p>
                )}
              </div>
            </div>
            <dl className="border-t-2 border-blue-700 pt-3 text-xs leading-5 sm:min-w-[220px] sm:border-l-2 sm:border-t-0 sm:pl-5 sm:pt-0 sm:text-sm">
              <InfoLine label="Année académique" value={context.academicYear?.name ?? "—"} />
              <InfoLine label="Programme / Formation" value={context.program?.name ?? context.course?.name ?? "—"} />
              <InfoLine label="Classe" value={context.classItem?.name ?? "—"} />
              <InfoLine label="Période" value={context.termLabel} />
            </dl>
          </div>
        </header>

        {/* ── Titre ── */}
        <section className="mt-3 rounded-lg bg-blue-800 px-4 py-3 text-center text-white">
          <h2 className="text-2xl font-extrabold tracking-wide">BULLETIN DE NOTES</h2>
          <p className="text-base font-semibold">Étudiant</p>
        </section>

        {/* ── Informations étudiant ── */}
        <section className="mt-3 grid grid-cols-1 gap-4 rounded-lg bg-blue-50 p-4 sm:grid-cols-[1fr_auto] sm:gap-5">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <InfoLine label="Matricule" value={bulletin.student.student_number} />
            <InfoLine label="Nom" value={bulletin.student.last_name ?? "—"} />
            <InfoLine label="Prénom(s)" value={bulletin.student.first_name ?? "—"} />
            <InfoLine label="Date de naissance" value={formatDate(bulletin.student.birth_date)} />
          </dl>
          <div className="flex min-w-[150px] items-center justify-center gap-3 border-t-2 border-blue-300 pt-3 sm:flex-col sm:border-l-2 sm:border-t-0 sm:pl-5 sm:pt-0">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-4 border-blue-700 bg-white">
              {bulletin.studentAvatarUrl ? (
                <img src={bulletin.studentAvatarUrl} alt={studentName} className="h-full w-full object-cover" />
              ) : (
                <GraduationCap className="h-9 w-9 text-blue-800" />
              )}
            </div>
            <p className="text-xs font-semibold text-blue-900">{studentName}</p>
          </div>
        </section>

        {/* ── Tableau des résultats ── */}
        <section className="mt-3 overflow-hidden rounded-lg border border-blue-300">
          <div className="grid grid-cols-[minmax(0,1fr)_82px_104px_104px] bg-blue-800 text-[11px] font-bold uppercase text-white sm:text-xs">
            <div className="px-2 py-2">Module / Matière</div>
            <div className="border-l border-white/30 px-1 py-2 text-center">Coefficient</div>
            <div className="border-l border-white/30 px-1 py-2 text-center">Note × Coefficient</div>
            <div className="border-l border-white/30 px-1 py-2 text-center">Moyenne matière<br />/20</div>
          </div>
          {bulletin.modules.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-slate-500">Aucune note publiée pour cette période.</p>
          ) : (
            bulletin.modules.map((module, index) => {
              const tone = MODULE_TONES[index % MODULE_TONES.length];
              return (
                <div key={module.moduleId} className={`break-inside-avoid border-t ${tone.shell}`}>
                  <div className={`px-3 py-2 text-sm font-extrabold uppercase tracking-wide ${tone.heading}`}>
                    Module {index + 1} : {module.moduleName}{module.moduleCode ? ` (${module.moduleCode})` : ""}
                  </div>
                  {module.subjects.map((subject) => (
                    <div key={subject.subjectId} className="grid grid-cols-[minmax(0,1fr)_82px_104px_104px] border-t border-blue-200 bg-white/80 text-xs sm:text-sm">
                      <div className="px-2 py-2 font-medium">
                        {subject.subjectName}
                        {subject.subjectCode ? <span className="ml-1 text-[10px] text-slate-500">({subject.subjectCode})</span> : null}
                      </div>
                      <div className="border-l border-blue-200 px-1 py-2 text-center">{formatScore(subject.coefficient)}</div>
                      <div className="border-l border-blue-200 px-1 py-2 text-center">{formatScore(subject.average * subject.coefficient)}</div>
                      <div className="border-l border-blue-200 px-1 py-2 text-center">
                        {formatScore(subject.average)}
                        <span className="block text-[10px] text-slate-400">({subject.assessmentCount} éval.)</span>
                      </div>
                    </div>
                  ))}
                  <div className="grid grid-cols-[minmax(0,1fr)_82px_104px_104px] border-t border-blue-300 bg-white/50 text-xs font-bold sm:text-sm">
                    <div className="col-span-3 px-2 py-2 text-blue-900">Moyenne du {module.moduleName}</div>
                    <div className="border-l border-blue-300 px-1 py-2 text-center text-blue-900">{formatScore(module.moduleAverage)} /20</div>
                  </div>
                </div>
              );
            })
          )}
        </section>

        {/* ── Récapitulatif / Résultats / Signature ── */}
        <section className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1.15fr_1fr_0.75fr]">
          <SummaryBox title="RÉCAPITULATIF">
            <SummaryLine label="Total des coefficients" value={formatScore(bulletin.totalCoefficients)} />
            <SummaryLine label="Total des notes × coefficients" value={formatScore(bulletin.totalWeightedPoints)} />
            <div className="mt-2 flex items-center justify-between rounded-md bg-blue-100 px-3 py-3 font-bold text-blue-900">
              <span>Moyenne générale</span>
              <span>{formatScore(bulletin.generalAverage)} / 20</span>
            </div>
          </SummaryBox>
          <SummaryBox title="RÉSULTATS GLOBAUX">
            <SummaryLine label="Moyenne de classe" value={`${formatScore(bulletin.classAverage)} / 20`} />
            <SummaryLine label="Rang de l'étudiant" value={bulletin.rank === 0 ? "Non classé" : `${ordinalSuffix(bulletin.rank)} / ${bulletin.totalStudents}`} />
            <SummaryLine label="Mention" value={getMention(bulletin.generalAverage)} />
          </SummaryBox>
          <div className="flex min-h-[150px] flex-col items-center justify-between rounded-lg border border-blue-300 p-3 text-center text-xs text-blue-900">
            {institution?.motto && <p className="italic font-semibold">{institution.motto}</p>}
            {institution?.director_function && <p className="font-bold">{institution.director_function}</p>}
            <div className="flex h-14 w-14 items-center justify-center">
              {stampUrl ? (
                <img src={stampUrl} alt="Cachet" className="h-full w-full object-contain" />
              ) : signatureUrl ? (
                <img src={signatureUrl} alt="Signature" className="h-full w-full object-contain" />
              ) : logoUrl ? (
                <img src={logoUrl} alt="Logo" className="h-full w-full object-contain" />
              ) : (
                <Award className="h-12 w-12 text-blue-800" />
              )}
            </div>
            {institution?.director_name && <p className="font-semibold">{institution.director_name}</p>}
            <div className="w-full border-t border-blue-400 pt-1">Signature / Cachet</div>
          </div>
        </section>

        {/* ── Bas de page ── */}
        <footer className="mt-5 grid grid-cols-2 gap-8 text-xs text-slate-500">
          <div className="text-center">
            <p className="font-semibold text-slate-800">Responsable pédagogique</p>
            <div className="mt-10 border-t border-slate-400 pt-1">Signature</div>
          </div>
          <div className="text-center">
            <p className="font-semibold text-slate-800">Direction</p>
            <div className="mt-10 border-t border-slate-400 pt-1">Signature et cachet</div>
          </div>
        </footer>
      </article>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }): JSX.Element {
  return <div className="flex gap-2"><dt className="font-semibold text-blue-900">{label} :</dt><dd className="min-w-0 flex-1 border-b border-blue-300 text-slate-800">{value}</dd></div>;
}

function SummaryBox({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return <div className="overflow-hidden rounded-lg border border-blue-300"><h3 className="bg-blue-800 px-3 py-2 text-sm font-extrabold text-white">{title}</h3><div className="space-y-2 p-3">{children}</div></div>;
}

function SummaryLine({ label, value }: { label: string; value: string }): JSX.Element {
  return <div className="flex items-end justify-between gap-2 border-b border-blue-100 pb-1 text-xs sm:text-sm"><span>{label}</span><strong className="text-blue-900">{value}</strong></div>;
}

function ordinalSuffix(value: number): string {
  return value === 1 ? "1er" : `${value}e`;
}
