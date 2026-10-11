import { json, route } from "@/lib/http";
import { requireAdmin } from "@/lib/session";

export const GET = route(async () => json({ admin: await requireAdmin() }));
