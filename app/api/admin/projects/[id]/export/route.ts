import { json, route, badRequest } from "@/lib/http";
import { requireAdmin, requireProject, isUuid } from "@/lib/session";
import { buildExport, exportMarkdown, exportPdf, pdfSafe } from "@/lib/export";

type Ctx = { params: Promise<{ id: string }> };

function slug(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "lofn-export";
}

export const GET = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const p = await requireProject(admin.id, (await params).id);
  const sp = new URL(req.url).searchParams;
  const format = sp.get("format") || "json";
  const cycle = sp.get("cycle");
  const data = await buildExport(p.id, cycle && isUuid(cycle) ? cycle : null);
  const base = `${slug(p.name)}-${new Date().toISOString().slice(0, 10)}`;
  const disp = (ext: string) => ({ "Content-Disposition": `attachment; filename="${base}.${ext}"`, "Cache-Control": "no-store" });
  if (format === "json") return new Response(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", ...disp("json") } });
  if (format === "md") return new Response(exportMarkdown(data), { headers: { "Content-Type": "text/markdown; charset=utf-8", ...disp("md") } });
  if (format === "pdf") {
    const pdf = await exportPdf(pdfSafe(data));
    return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", ...disp("pdf") } });
  }
  throw badRequest("Format must be json, md or pdf.");
});
