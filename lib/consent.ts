// Server side of participant consent: settings, versioning, enforcement, withdrawal (erasure) and data export.
import crypto from "node:crypto";
import { one, query, tx } from "./db";
import { forbidden, ApiError } from "./http";
import { aiForProject, statusOf } from "./ai/settings";
import { buildConsent, consentToText, DEFAULT_SETTINGS, type ConsentDocument, type ConsentSettings } from "./consent-text";
import { deleteMediaRows } from "./retention";
import { enqueue } from "./jobs";
import { publish } from "./events";
import type { ParticipantCtx } from "./session";

const LABEL: Record<string, string> = { huggingface: "Hugging Face", anthropic: "Anthropic", openai: "OpenAI" };

export async function consentSettings(projectId: string): Promise<{ settings: ConsentSettings; reviewed: boolean }> {
  const p = await one(
    `SELECT p.name, p.description, a.name AS owner_name, a.email AS owner_email, pc.settings, pc.reviewed
       FROM projects p JOIN admins a ON a.id=p.owner_id LEFT JOIN project_consent pc ON pc.project_id=p.id WHERE p.id=$1`,
    [projectId],
  );
  if (!p) throw new ApiError(404, "Project not found.");
  const defaults: ConsentSettings = {
    ...DEFAULT_SETTINGS,
    hosting: process.env.LOFN_HOSTING_DESCRIPTION || DEFAULT_SETTINGS.hosting,
    controllerName: p.owner_name || p.owner_email,
    controllerContact: p.owner_email,
    purpose: p.description?.trim()
      ? `${p.description.trim()} Your contributions are combined with your group's to produce shared answers for this purpose.`
      : `To collect and combine the views of participants in “${p.name}” into shared group answers.`,
  };
  return { settings: { ...defaults, ...(p.settings ?? {}) }, reviewed: !!p.reviewed };
}

export async function saveConsentSettings(projectId: string, settings: ConsentSettings) {
  await query(
    `INSERT INTO project_consent(project_id, settings, reviewed) VALUES ($1,$2,true)
     ON CONFLICT (project_id) DO UPDATE SET settings=EXCLUDED.settings, reviewed=true, updated_at=now()`,
    [projectId, JSON.stringify(settings)],
  );
}

export async function consentDocument(projectId: string): Promise<{ document: ConsentDocument; settings: ConsentSettings; reviewed: boolean }> {
  const { settings, reviewed } = await consentSettings(projectId);
  const p = await one(`SELECT name, media_retention_days FROM projects WHERE id=$1`, [projectId]);
  const st = statusOf(await aiForProject(projectId));
  const name = (prov: string, model: string | null) => (prov === "none" || !model ? null : `${LABEL[prov] ?? prov}, model ${model}`);
  const document = buildConsent(settings, {
    projectName: p.name,
    mediaRetentionDays: p.media_retention_days,
    ai: {
      synthesis: name(st.synthesisProvider, st.synthesisModel),
      vision: name(st.visionProvider, st.visionModel),
      video: name(st.videoProvider, st.videoModel),
      transcription: name(st.transcriptionProvider, st.transcriptionModel),
    },
  });
  return { document, settings, reviewed };
}

/** The version participants must agree to now. A new version is recorded whenever the wording changes. */
export async function currentConsentVersion(projectId: string) {
  const { document } = await consentDocument(projectId);
  const text = consentToText(document);
  const hash = crypto.createHash("sha256").update(text).digest("hex");
  const existing = await one(`SELECT id, version FROM consent_versions WHERE project_id=$1 AND text_sha256=$2`, [projectId, hash]);
  if (existing) return { id: existing.id as string, version: existing.version as number, document, text };
  const row = await one(
    `INSERT INTO consent_versions(project_id, version, document, text, text_sha256)
     SELECT $1, COALESCE(max(version),0)+1, $2, $3, $4 FROM consent_versions WHERE project_id=$1
     ON CONFLICT (project_id, text_sha256) DO UPDATE SET text_sha256=EXCLUDED.text_sha256
     RETURNING id, version`,
    [projectId, JSON.stringify(document), text, hash],
  );
  return { id: row!.id as string, version: row!.version as number, document, text };
}

export type ConsentChoices = { core: boolean; age: boolean; recordings: boolean; health: boolean; hipaa: boolean };

export async function participantConsent(ctx: ParticipantCtx) {
  const cur = await currentConsentVersion(ctx.project.id);
  const r = await one(
    `SELECT pc.id, pc.choices, pc.signed_name, pc.signed_at, pc.consent_version_id, cv.version, cv.text
       FROM participant_consents pc JOIN consent_versions cv ON cv.id=pc.consent_version_id
      WHERE pc.participant_id=$1 AND pc.withdrawn_at IS NULL ORDER BY pc.signed_at DESC LIMIT 1`,
    [ctx.participant.id],
  );
  return {
    current: cur,
    signed: r
      ? {
          id: r.id as string,
          choices: r.choices as ConsentChoices,
          signedName: r.signed_name as string,
          signedAt: new Date(r.signed_at).toISOString(),
          version: r.version as number,
          text: r.text as string,
          isCurrent: r.consent_version_id === cur.id,
        }
      : null,
  };
}

/** Throws unless the participant has agreed to the current form (and, for media, to recordings). */
export async function requireConsent(ctx: ParticipantCtx, need: "core" | "recordings" = "core") {
  const { signed } = await participantConsent(ctx);
  if (!signed || !signed.isCurrent) throw new ApiError(428, "Please read and sign the consent form first.", "consent_required");
  if (need === "recordings" && !signed.choices.recordings)
    throw forbidden("You haven't consented to sending recordings, photos or videos. You can still contribute in writing, or update your consent.");
  return signed;
}

export async function signConsent(ctx: ParticipantCtx, versionId: string, signedName: string, choices: ConsentChoices) {
  const cur = await currentConsentVersion(ctx.project.id);
  if (versionId !== cur.id) throw new ApiError(409, "The consent form was just updated. Please read the new version.", "consent_changed");
  for (const c of cur.document.checks) if (c.required && !choices[c.id]) throw new ApiError(400, "Please tick every required box.", "consent_incomplete");
  const hasHealth = cur.document.checks.some((c) => c.id === "health");
  const clean: ConsentChoices = {
    core: true,
    age: true,
    recordings: !!choices.recordings,
    health: hasHealth && !!choices.health,
    hipaa: hasHealth && !!choices.hipaa,
  };
  await tx(async (db) => {
    // A new signature (e.g. for a new version, or changed choices) supersedes the previous one.
    await db.query(`UPDATE participant_consents SET withdrawn_at=now() WHERE participant_id=$1 AND withdrawn_at IS NULL`, [ctx.participant.id]);
    await db.query(
      `INSERT INTO participant_consents(project_id, group_id, participant_id, alias, consent_version_id, signed_name, choices)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [ctx.project.id, ctx.group.id, ctx.participant.id, ctx.participant.alias, cur.id, signedName, JSON.stringify(clean)],
    );
  });
  return clean;
}

/**
 * Erase a participant's contributions (all, or the given ids): text, media files, transcripts and descriptions.
 * The rows stay as hidden, empty placeholders so citation numbers stay stable; affected answers are rewritten.
 */
export async function eraseContributions(participantId: string, onlyIds?: string[]) {
  const contribs = await query(
    `SELECT id, cycle_id, group_id, question_id, project_id FROM contributions c
      WHERE participant_id=$1 ${onlyIds ? "AND id = ANY($2::uuid[])" : ""}
        AND (NOT hidden OR text_content <> '' OR EXISTS (SELECT 1 FROM media m WHERE m.contribution_id=c.id AND m.deleted_at IS NULL)
             OR EXISTS (SELECT 1 FROM derivations d WHERE d.contribution_id=c.id))`,
    onlyIds ? [participantId, onlyIds] : [participantId],
  );
  if (!contribs.length) return { erased: 0, contribs };
  const ids = contribs.map((c) => c.id);
  const media = await query(`SELECT id, storage_key FROM media WHERE contribution_id = ANY($1::uuid[]) AND deleted_at IS NULL`, [ids]);
  await deleteMediaRows(media);
  await tx(async (db) => {
    await db.query(`DELETE FROM derivations WHERE contribution_id = ANY($1::uuid[])`, [ids]);
    await db.query(
      `UPDATE contributions SET hidden=true, hidden_at=COALESCE(hidden_at, now()), text_content='', processing_error=NULL WHERE id = ANY($1::uuid[])`,
      [ids],
    );
  });
  const seen = new Set<string>();
  for (const c of contribs) {
    const a = await one(`SELECT id FROM answers WHERE cycle_id=$1 AND group_id=$2 AND question_id=$3`, [c.cycle_id, c.group_id, c.question_id]);
    if (a && !seen.has(a.id)) {
      seen.add(a.id);
      const cy = await one(`SELECT status FROM cycles WHERE id=$1`, [c.cycle_id]);
      await enqueue("synthesize", { answerId: a.id, trigger: cy?.status === "ended" ? "final" : "tick" }, { dedupeKey: `synth:${a.id}` });
    }
    await publish({ t: "contribution", projectId: c.project_id, groupId: c.group_id, cycleId: c.cycle_id, questionId: c.question_id, id: c.id });
  }
  return { erased: contribs.length, contribs };
}

/**
 * Withdraw consent: erase the participant's contributions, rewrite affected answers without them, and remove
 * the participant. The signed record is kept, marked withdrawn, as proof of what was agreed and when it was revoked.
 */
export async function withdrawParticipant(ctx: ParticipantCtx) {
  // Uploads never attached to a contribution go too.
  const loose = await query(`SELECT id, storage_key FROM media WHERE participant_id=$1 AND deleted_at IS NULL AND contribution_id IS NULL`, [ctx.participant.id]);
  await deleteMediaRows(loose);
  const { erased } = await eraseContributions(ctx.participant.id);
  await tx(async (db) => {
    await db.query(
      `UPDATE participant_consents SET withdrawn_at=COALESCE(withdrawn_at, now()), erased_contributions=$2
        WHERE id = (SELECT id FROM participant_consents WHERE participant_id=$1 ORDER BY signed_at DESC LIMIT 1)`,
      [ctx.participant.id, erased],
    );
    await db.query(`DELETE FROM participants WHERE id=$1`, [ctx.participant.id]);
  });
  return { erased };
}

/** Everything Lofn holds about this participant (GDPR access and portability). */
export async function participantData(ctx: ParticipantCtx) {
  const consent = await query(
    `SELECT cv.version, cv.text, pc.signed_name, pc.choices, pc.signed_at, pc.withdrawn_at
       FROM participant_consents pc JOIN consent_versions cv ON cv.id=pc.consent_version_id
      WHERE pc.participant_id=$1 ORDER BY pc.signed_at`,
    [ctx.participant.id],
  );
  const contributions = await query(
    `SELECT c.id, c.ref_no, c.kind, c.text_content, c.created_at, c.hidden, c.question_id, q.title AS question, cy.name AS round,
            (SELECT json_agg(json_build_object('type', d.type, 'content', d.content)) FROM derivations d WHERE d.contribution_id=c.id) AS derived,
            (SELECT json_agg(json_build_object('id', m.id, 'category', m.category, 'mime', m.mime, 'bytes', m.size_bytes, 'name', m.original_name, 'deleted', m.deleted_at IS NOT NULL)
               ORDER BY m.position) FROM media m WHERE m.contribution_id=c.id) AS media
       FROM contributions c JOIN questions q ON q.id=c.question_id JOIN cycles cy ON cy.id=c.cycle_id
      WHERE c.participant_id=$1 AND NOT (c.hidden AND c.text_content = '' AND NOT EXISTS (SELECT 1 FROM media m WHERE m.contribution_id=c.id AND m.deleted_at IS NULL))
      ORDER BY c.created_at`,
    [ctx.participant.id],
  );
  return {
    format: "lofn-participant/v1",
    exportedAt: new Date().toISOString(),
    projectId: ctx.project.id,
    project: ctx.project.name,
    group: ctx.group.name,
    you: { label: ctx.participant.alias, name: ctx.participant.display_name || null },
    consent,
    contributions: contributions.map((c) => ({
      ref: `C${c.ref_no}`,
      questionId: c.question_id,
      question: c.question,
      round: c.round,
      kind: c.kind,
      text: c.text_content,
      sentAt: c.created_at,
      removedByFacilitator: c.hidden,
      transcriptsAndDescriptions: c.derived ?? [],
      media: (c.media ?? []).map((m: any) => ({ ...m, file: m.deleted ? null : `media/${m.id}` })),
    })),
  };
}
