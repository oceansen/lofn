import { ApiError, json, route } from "@/lib/http";
import { requireAdmin } from "@/lib/session";
import { ProjectFile, importProject } from "@/lib/project-import";

/** Create a project (questions, images, groups with fresh codes, cycles) from a Lofn project file. */
export const POST = route(async (req) => {
  const admin = await requireAdmin();
  const text = await req.text();
  if (text.length > 40_000_000) throw new ApiError(413, "Project files must be under 40 MB.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ApiError(400, "That file isn't valid JSON. Choose a Lofn project file (.json).");
  }
  const file = ProjectFile.parse(raw);
  const id = await importProject(admin.id, file);
  return json({ id }, { status: 201 });
});
