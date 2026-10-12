import { route } from "@/lib/http";
import { requireAdmin, requireProject } from "@/lib/session";
import { query } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };
const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Consent register (proof of consent, GDPR Art. 7(1)) as CSV, plus every form version's full text. */
export const GET = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const p = await requireProject(admin.id, (await params).id);
  const which = new URL(req.url).searchParams.get("what");
  if (which === "versions") {
    const vs = await query(`SELECT version, created_at, text_sha256, text FROM consent_versions WHERE project_id=$1 ORDER BY version`, [p.id]);
    const out = vs.map((v) => `=== Version ${v.version} (${new Date(v.created_at).toISOString()}, sha256 ${v.text_sha256}) ===\n\n${v.text}`).join("\n\n\n");
    return new Response(out, { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="consent-versions.txt"` } });
  }
  const rows = await query(
    `SELECT pc.alias, g.name AS group_name, pc.signed_name, cv.version, cv.text_sha256, pc.choices, pc.signed_at, pc.withdrawn_at, pc.erased_contributions
       FROM participant_consents pc JOIN consent_versions cv ON cv.id=pc.consent_version_id LEFT JOIN groups g ON g.id=pc.group_id
      WHERE pc.project_id=$1 ORDER BY pc.signed_at`,
    [p.id],
  );
  const head = ["participant", "group", "signed_name", "form_version", "form_sha256", "consent", "age_confirmed", "recordings", "health_data", "hipaa_authorization", "signed_at", "withdrawn_at", "status", "contributions_erased"];
  const lines = rows.map((r) =>
    [
      r.alias, r.group_name, r.signed_name, r.version, r.text_sha256, r.choices.core, r.choices.age, r.choices.recordings, r.choices.health, r.choices.hipaa,
      r.signed_at, r.withdrawn_at,
      r.withdrawn_at ? (r.erased_contributions === null ? "superseded by a later signature" : "withdrawn") : "active",
      r.erased_contributions ?? "",
    ].map(cell).join(","),
  );
  return new Response([head.join(","), ...lines].join("\n") + "\n", {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="consent-register.csv"` },
  });
});
