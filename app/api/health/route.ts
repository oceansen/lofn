import { one } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await one(`SELECT 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
