import fsp from "node:fs/promises";
import { ApiError, json, route } from "@/lib/http";
import { requireAdmin } from "@/lib/session";
import { ProjectFile, importProject } from "@/lib/project-import";
import { importProjectArchive } from "@/lib/project-archive";
import { isZip, requestToTempFile } from "@/lib/zip";

export const runtime = "nodejs";

/**
 * Create a project from either a full Lofn archive (.zip: all data and media, restored as a new project)
 * or a Lofn project file (.json: questions, images, groups with fresh codes, cycles).
 */
export const POST = route(async (req) => {
  const admin = await requireAdmin();
  const up = await requestToTempFile(req, Number(process.env.IMPORT_MAX_MB || 2048) * 1048576);
  try {
    if (await isZip(up.path)) {
      const r = await importProjectArchive(admin.id, up.path);
      return json({ id: r.id, restored: true, counts: r.counts, media: r.media }, { status: 201 });
    }
    if (up.size > 40_000_000) throw new ApiError(413, "Project files must be under 40 MB.");
    let raw: unknown;
    try {
      raw = JSON.parse(await fsp.readFile(up.path, "utf8"));
    } catch {
      throw new ApiError(400, "That file isn't a Lofn archive (.zip) or project file (.json).");
    }
    const file = ProjectFile.parse(raw);
    const id = await importProject(admin.id, file);
    return json({ id }, { status: 201 });
  } finally {
    await fsp.unlink(up.path).catch(() => {});
  }
});
