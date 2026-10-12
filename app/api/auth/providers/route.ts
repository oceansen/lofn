import { json, route } from "@/lib/http";
import { authInfo } from "@/lib/auth-info";

export const GET = route(async () => json(await authInfo()));
