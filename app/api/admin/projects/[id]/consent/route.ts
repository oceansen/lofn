import { z } from "zod";
import { body, json, route } from "@/lib/http";
import { requireAdmin, requireProject } from "@/lib/session";
import { query } from "@/lib/db";
import { consentDocument, currentConsentVersion, saveConsentSettings } from "@/lib/consent";

type Ctx = { params: Promise<{ id: string }> };

const Settings = z.object({
  controllerName: z.string().trim().min(2, "Name the data controller.").max(200),
  controllerContact: z.string().trim().min(3, "Give a contact for data requests.").max(300),
  dpoContact: z.string().trim().max(300).default(""),
  purpose: z.string().trim().min(10, "Describe the purpose.").max(3000),
  hosting: z.string().trim().min(3).max(500),
  transfers: z.string().trim().max(1500).default(""),
  retention: z.string().trim().min(3).max(1000),
  authority: z.string().trim().min(3).max(500),
  minAge: z.number().int().min(13).max(21),
  healthData: z.boolean(),
  hipaaExpiry: z.string().trim().max(300).default(""),
  extra: z.string().trim().max(5000).default(""),
});

async function view(projectId: string) {
  const { document, settings, reviewed } = await consentDocument(projectId);
  const current = await currentConsentVersion(projectId);
  const records = await query(
    `SELECT pc.id, pc.alias, pc.signed_name, pc.choices, pc.signed_at, pc.withdrawn_at, pc.erased_contributions, cv.version, g.name AS group_name,
            (pc.participant_id IS NULL) AS left_group
       FROM participant_consents pc JOIN consent_versions cv ON cv.id=pc.consent_version_id LEFT JOIN groups g ON g.id=pc.group_id
      WHERE pc.project_id=$1 ORDER BY pc.signed_at DESC LIMIT 1000`,
    [projectId],
  );
  return {
    settings,
    reviewed,
    document,
    version: current.version,
    records: records.map((r) => ({
      id: r.id,
      alias: r.alias,
      group: r.group_name,
      signedName: r.signed_name,
      choices: r.choices,
      signedAt: r.signed_at,
      withdrawnAt: r.withdrawn_at,
      erased: r.erased_contributions,
      version: r.version,
      superseded: !!r.withdrawn_at && r.erased_contributions === null,
    })),
  };
}

export const GET = route<Ctx>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const p = await requireProject(admin.id, (await params).id);
  return json(await view(p.id));
});

export const PUT = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const p = await requireProject(admin.id, (await params).id);
  const s = await body(req, Settings);
  await saveConsentSettings(p.id, s);
  return json(await view(p.id));
});
