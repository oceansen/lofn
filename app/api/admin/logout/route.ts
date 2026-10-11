import { json, route } from "@/lib/http";
import { destroyAdminSession } from "@/lib/session";

export const POST = route(async () => {
  await destroyAdminSession();
  return json({ ok: true });
});
