"use client";

import { SchoolCertificateData } from "@/lib/academic/school-certificate";

interface SchoolCertificateA4Props {
  data: SchoolCertificateData;
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "—";
}

function studentFullName(d: SchoolCertificateData): string {
  const parts = [d.student.last_name, d.student.first_name].filter(Boolean);
  return parts.join(" ") || d.student.full_name || "—";
}

function isFeminine(d: SchoolCertificateData): boolean {
  const gender = (d.student.gender ?? "").toLowerCase();
  return gender === "f" || gender === "feminin" || gender === "féminin" || gender === "female";
}

function studentCivility(d: SchoolCertificateData): string {
  return isFeminine(d) ? "Madame" : "Monsieur";
}

export function SchoolCertificateA4({ data }: SchoolCertificateA4Props) {
  const inst = data.institution;
  const feminine = isFeminine(data);

  const ne = feminine ? "née" : "né";
  const immatricule = feminine ? "immatriculée" : "immatriculé";
  const inscrit = feminine ? "inscrite" : "inscrit";
  const etudiant = feminine ? "étudiante" : "étudiant";
  const pronoun = feminine ? "Elle" : "Il";

  return (
    <article className="school-cert-paper">
      {/* ---- Header: Republic / Ministry / Institution ---- */}
      <header className="school-cert-header">
        {inst.flag_url ? (
          <img src={inst.flag_url} alt="Drapeau" className="school-cert-flag" />
        ) : (
          <div className="school-cert-flag-placeholder">Drapeau</div>
        )}

        {inst.republic_name && <p className="school-cert-republic">{inst.republic_name}</p>}
        {inst.motto && <p className="school-cert-motto">{inst.motto}</p>}
        <hr className="school-cert-separator" />
        {inst.ministry && <p className="school-cert-inst-name">{inst.ministry}</p>}

        <div className="school-cert-inst-block">
          <p className="school-cert-inst-name">{inst.name}</p>
          {inst.short_name && <p className="school-cert-inst-short">{inst.short_name}</p>}
        </div>

        {inst.logo_url ? (
          <img src={inst.logo_url} alt="Logo" className="school-cert-logo" style={{ borderRadius: '0px', objectFit: 'contain' }}
            />
        ) : (
          <div className="school-cert-logo-placeholder">Logo</div>
        )}
      </header>

      {/* ---- Title ---- */}
      <div className="school-cert-title-block">
        <h1 className="school-cert-title">Certificat de Scolarité</h1>
        <hr className="school-cert-title-underline" />
      </div>

      {/* ---- Body ---- */}
      <div className="school-cert-body">
        <p style={{ textAlign: 'justify', textIndent: '0', textDecoration: 'none' }}>
          Je soussigné, <strong>{inst.director_name ?? "—"}</strong>, Directeur de l'<strong>{inst.name}</strong>, certifie et atteste par la présente que :
        </p>

        <p style={{ textAlign: 'justify', textIndent: '0', textDecoration: 'none' }}>
          <strong className="school-cert-field">{studentCivility(data)}</strong>{" "}
          <strong className="school-cert-field">{studentFullName(data)}</strong>, {ne} le <strong className="school-cert-field">{formatDate(data.student.birth_date)}</strong>{data.student.birth_place ? <> à <strong className="school-cert-field">{data.student.birth_place}</strong></> : null}, de nationalité <strong className="school-cert-field">{data.student.nationality ?? "—"}</strong>, {immatricule} sous le numéro <strong className="school-cert-field">{data.student.student_number}</strong>, est régulièrement {inscrit} en qualité d'{etudiant} au sein de notre établissement pour l'année académique <strong className="school-cert-field">{data.academic_year.name}</strong>.
        </p>

        {data.program?.name && (
          <p style={{ textAlign: 'justify', textIndent: '0' }}>
            {pronoun} poursuit ses études dans le programme : <strong className="school-cert-field">{data.program.name}</strong>{data.course?.name ? <> — formation <strong className="school-cert-field">{data.course.name}</strong></> : null}{data.class?.name ? <>, en classe de <strong className="school-cert-field">{data.class.name}</strong></> : null}.
          </p>
        )}

        {!data.program?.name && data.course?.name && (
          <p style={{ textAlign: 'justify', textIndent: '0' }}>
            {pronoun} poursuit ses études dans la formation : <strong className="school-cert-field">{data.course.name}</strong>{data.class?.name ? <>, en classe de <strong className="school-cert-field">{data.class.name}</strong></> : null}.
          </p>
        )}

        <p style={{ textAlign: 'justify', textIndent: '0' }} className="school-cert-closing">
          En foi de quoi, le présent certificat lui est délivré pour servir et valoir ce que de droit.
        </p>
      </div>

      {/* ---- Date / Place ---- */}
      <div className="school-cert-date-place">
        Fait à {data.issue_place || inst.city || "—"}, le {formatDate(data.issue_date)}
      </div>

      {/* ---- Signature zone ---- */}
      <div className="school-cert-signature-zone">
        <div className="school-cert-signature-block">
   {/* ---- <p className="school-cert-signature-label">Le Directeur / La Directrice</p> ---- */}

          {inst.signature_url && (
            <img src={inst.signature_url} alt="Signature" className="school-cert-signature-img" />
          )}

          {inst.stamp_url && (
            <img src={inst.stamp_url} alt="Cachet" className="school-cert-stamp" />
          )}

          {inst.director_name && <p className="school-cert-signatory-name">{inst.director_name}</p>}
          {inst.director_function && <p className="school-cert-signatory-function">{inst.director_function}</p>}
        </div>
      </div>
    </article>
  );
}
